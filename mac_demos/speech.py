# san vo, nov 21 2026
"""speech recognition, translation, voice output and sign reading for the utek demos"""
import base64
import html
import io
import json
import os
from functools import lru_cache
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import av
import numpy as np
import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, WhisperForConditionalGeneration, WhisperProcessor

CACHE = Path(os.environ.get("HF_HUB_CACHE", Path.home() / ".cache/huggingface/hub"))
# english + the 10 competition languages
# each entry is: name, nllb code (offline mode), then the google codes for translate / speech / voice
# the key is also the whisper language code
LANGUAGES = {
    "en": ("English", "eng_Latn", "en", "en-US", "en-US"),
    "ar": ("Arabic", "arb_Arab", "ar", "ar-SA", "ar-XA"),
    "fr": ("French", "fra_Latn", "fr", "fr-CA", "fr-CA"),
    "hi": ("Hindi", "hin_Deva", "hi", "hi-IN", "hi-IN"),
    "zh": ("Mandarin", "zho_Hans", "zh-CN", "cmn-Hans-CN", "cmn-CN"),
    "pt": ("Portuguese", "por_Latn", "pt", "pt-BR", "pt-BR"),
    "pa": ("Punjabi", "pan_Guru", "pa", "pa-Guru-IN", "pa-IN"),
    "es": ("Spanish", "spa_Latn", "es", "es-US", "es-US"),
    "tl": ("Tagalog", "tgl_Latn", "tl", "fil-PH", "fil-PH"),
    "uk": ("Ukrainian", "ukr_Cyrl", "uk", "uk-UA", "uk-UA"),
    "ur": ("Urdu", "urd_Arab", "ur", "ur-PK", "ur-IN"),
}
LANG = {code: entry[1] for code, entry in LANGUAGES.items()}
torch.set_num_threads(min(4, os.cpu_count() or 1))


def snapshot(repository, filename):
    return next(p for p in (CACHE / repository / "snapshots").iterdir() if (p / filename).is_file())


@lru_cache(maxsize=1)
def recognizer():
    path = snapshot("models--openai--whisper-small", "preprocessor_config.json")
    return WhisperProcessor.from_pretrained(path), WhisperForConditionalGeneration.from_pretrained(path).eval()


@lru_cache(maxsize=1)
def translator():
    repo = "models--facebook--nllb-200-distilled-600M"
    path = snapshot(repo, "config.json")
    return AutoTokenizer.from_pretrained(path), AutoModelForSeq2SeqLM.from_pretrained(path).eval()


def decode_audio(data):
    with av.open(io.BytesIO(data)) as container:
        resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
        pieces = []
        total = 0
        for frame in container.decode(audio=0):
            for sample in resampler.resample(frame):
                total += sample.samples
                if total > 16000 * 30:
                    raise ValueError("Record one phrase of up to 30 seconds.")
                pieces.append(sample.to_ndarray().reshape(-1))
        pieces.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(None))
    if not pieces:
        raise ValueError("The recording contains no audio.")
    samples = np.concatenate(pieces)
    if samples.size < 1600 or np.max(np.abs(samples)) < 0.001:
        raise ValueError("The recording is silent or too short. Check your microphone.")
    return samples


@torch.inference_mode()
def transcribe(data, language):
    audio = decode_audio(data)
    processor, model = recognizer()
    inputs = processor(audio, sampling_rate=16000, return_tensors="pt", return_attention_mask=True)
    ids = model.generate(**inputs, language=language, task="transcribe", max_new_tokens=300)
    return processor.batch_decode(ids, skip_special_tokens=True)[0].strip()


@torch.inference_mode()
def translate_offline(text, source, target):
    tokenizer, model = translator()
    tokens = tokenizer.encode(text, add_special_tokens=False)
    language_id = tokenizer.convert_tokens_to_ids
    # setting the language tokens by hand works with the cached tokenizer too
    ids = torch.tensor([[language_id(LANG[source]), *tokens, tokenizer.eos_token_id]])
    output = model.generate(input_ids=ids, forced_bos_token_id=language_id(LANG[target]),
                            max_new_tokens=400, num_beams=1)
    return tokenizer.decode(output[0], skip_special_tokens=True).strip()


last_reply = {}  # last answer from google speech, kept for troubleshooting


def google(service, url, payload, key):
    """post one json request to a google cloud api using the key from the page"""
    if not key:
        raise ValueError("Enter your Google Cloud key in Settings.")
    req = Request(url, data=json.dumps(payload).encode(),
                  headers={"Content-Type": "application/json", "X-Goog-Api-Key": key})
    try:
        with urlopen(req, timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        try:
            error = json.load(exc)["error"]
            reasons = {d.get("reason") for d in error.get("details", [])}
            message = str(error.get("message", ""))
        except Exception:
            reasons, message = set(), ""
        if "SERVICE_DISABLED" in reasons or "has not been used" in message or "is disabled" in message:
            hint = f"Enable the {service} API in the key's Google Cloud project."
        elif "API_KEY_SERVICE_BLOCKED" in reasons or "are blocked" in message:
            hint = f"The key's API restrictions do not allow {service}."
        elif "API_KEY_INVALID" in reasons or "API key not valid" in message:
            hint = "The key is not valid."
        else:  # otherwise just pass along what google said
            codes = ", ".join(sorted(str(r) for r in reasons if r))
            hint = (" ".join(message.split())[:220] or "Check the key, API restrictions, billing and quota.")
            hint += f" [{codes}]" if codes else ""
        raise ValueError(f"Google {service} returned HTTP {exc.code}. {hint}") from None
    except (URLError, TimeoutError):
        raise ValueError("Google could not be reached. Check the connection or select offline rehearsal.") from None


def translate_google(text, source, target, key):
    """translate text. if no source is given google detects it. returns (translation, source code)"""
    payload = {"q": text, "target": LANGUAGES[target][2], "format": "text"}
    if source:
        payload["source"] = LANGUAGES[source][2]
    result = google("Cloud Translation", "https://translation.googleapis.com/language/translate/v2",
                    payload, key)["data"]["translations"][0]
    return html.unescape(result["translatedText"]), source or result.get("detectedSourceLanguage", "")


def transcribe_google(data, language, key):
    """recognise one phrase with google speech to text"""
    pcm = (np.clip(decode_audio(data), -1, 1) * 32767).astype("<i2").tobytes()
    reply = google("Cloud Speech-to-Text", "https://speech.googleapis.com/v1/speech:recognize",
                   {"config": {"encoding": "LINEAR16", "sampleRateHertz": 16000, "languageCode": LANGUAGES[language][3]},
                    "audio": {"content": base64.b64encode(pcm).decode()}}, key)
    last_reply["speech"] = reply
    text = " ".join(r["alternatives"][0].get("transcript", "").strip()
                    for r in reply.get("results", []) if r.get("alternatives")).strip()
    if not text:
        raise ValueError("Google Cloud Speech-to-Text heard no speech.")
    return text


def speak_google(text, language, key):
    """get mp3 audio of the text in a google voice for that language"""
    code = LANGUAGES[language][4]
    # ask for a named wavenet voice first. if google picks one itself it can pick a preview voice that refuses
    for voice in ({"languageCode": code, "name": code + "-Wavenet-A"}, {"languageCode": code}):
        try:
            reply = google("Cloud Text-to-Speech", "https://texttospeech.googleapis.com/v1/text:synthesize",
                           {"input": {"text": text}, "voice": voice, "audioConfig": {"audioEncoding": "MP3"}}, key)
            return base64.b64decode(reply["audioContent"])
        except ValueError as exc:
            failure = exc
            if "HTTP 400" not in str(exc):  # only retry if the voice got rejected
                break
    raise failure


def read_google(image, key):
    """read the text in a photo with google vision"""
    reply = google("Cloud Vision", "https://vision.googleapis.com/v1/images:annotate",
                   {"requests": [{"image": {"content": base64.b64encode(image).decode()},
                                  "features": [{"type": "TEXT_DETECTION"}]}]}, key)["responses"][0]
    if "error" in reply:
        raise ValueError("Google Cloud Vision could not read the picture: " + str(reply["error"].get("message", "")))
    found = reply.get("textAnnotations") or [{}]
    text = (reply.get("fullTextAnnotation", {}).get("text") or found[0].get("description", "")).strip()
    if not text:
        raise ValueError("No text was found. Move the sign closer or hold it steadier and try again.")
    return " ".join(text.split())
