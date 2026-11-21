# san vo, nov 21 2026
"""run the utek mac demos on loopback"""
import json
import os
import threading
import time
import webbrowser
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory
from werkzeug.serving import make_server

import speech

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024
lock = threading.Lock()


@app.before_request
def local_only():
    if request.host.split(":")[0] not in {"127.0.0.1", "localhost"}:
        return "Use the local demo address.", 403
    if request.method == "POST" and request.headers.get("X-UTEK-Demo") != "1":
        return "Use the local demo page.", 403


@app.get("/")
def home():
    return send_from_directory(ROOT / "web", "index.html")


@app.get("/web/<name>")
def web_asset(name):
    return send_from_directory(ROOT / "web", name)


@app.get("/examples/<name>")
def example(name):
    return send_from_directory(ROOT / "examples", name)


@app.post("/translate")
def translate():
    source, target = request.form.get("source"), request.form.get("target")
    mode = request.form.get("mode")
    if (source not in speech.LANGUAGES or target not in speech.LANGUAGES or source == target
            or mode not in {"offline", "google"}):
        return jsonify(error="Select two different languages and a translation service."), 400
    key = request.form.get("key", "").strip()
    started = time.monotonic()
    heard = note = ""
    try:
        with lock:
            if "audio" in request.files:
                audio = request.files["audio"].read()
                original = ""
                keep = request.form.get("keep") == "1"  # for troubleshooting, leaves the recording on disk
                mic = "board" if request.form.get("mic") == "board" else "computer"
                if keep:
                    (ROOT / f"last_recording_{mic}.wav").write_bytes(audio)
                    speech.last_reply.clear()
                if mode == "google" and request.form.get("listen") != "whisper":
                    try:
                        original, heard = speech.transcribe_google(audio, source, key), "Google speech recognition"
                    except ValueError as exc:
                        note = str(exc)  # google didnt work so use the local one
                if not original:
                    original, heard = speech.transcribe(audio, source), "Whisper on this Mac"
                if keep:
                    (ROOT / f"last_recording_{mic}.json").write_text(json.dumps(
                        {"source": source, "heard_by": heard, "transcript": original, "note": note,
                         "google_speech_reply": speech.last_reply.get("speech")}, ensure_ascii=False, indent=1))
            else:
                original = request.form.get("text", "").strip()
            if not original or len(original) > 1200:
                raise ValueError("Enter or record a phrase of up to 1200 characters.")
            if mode == "offline":
                result = speech.translate_offline(original, source, target)
            else:
                result, _ = speech.translate_google(original, source, target, key)
        return jsonify(original=original, translation=result, heard=heard, note=note,
                       seconds=round(time.monotonic()-started, 2))
    except (ValueError, OSError, EOFError) as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        app.logger.exception("Translation failed")
        return jsonify(error=f"{type(exc).__name__}: {exc}"), 500


@app.post("/speak")
def speak():
    language, text = request.form.get("language"), request.form.get("text", "").strip()
    if language not in speech.LANGUAGES or not text or len(text) > 1500:
        return jsonify(error="Nothing to speak."), 400
    try:
        audio = speech.speak_google(text, language, request.form.get("key", "").strip())
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        app.logger.exception("Speech output failed")
        return jsonify(error=f"{type(exc).__name__}: {exc}"), 500
    return Response(audio, mimetype="audio/mpeg")


@app.post("/read")
def read():
    target = request.form.get("target")
    if target not in speech.LANGUAGES or "image" not in request.files:
        return jsonify(error="Capture a sign and choose a language."), 400
    key = request.form.get("key", "").strip()
    started = time.monotonic()
    try:
        original = speech.read_google(request.files["image"].read(), key)
        translation, source = speech.translate_google(original[:1500], None, target, key)
        return jsonify(original=original, translation=translation, source=source,
                       seconds=round(time.monotonic()-started, 2))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        app.logger.exception("Sign reading failed")
        return jsonify(error=f"{type(exc).__name__}: {exc}"), 500


if __name__ == "__main__":
    server = make_server("127.0.0.1", int(os.getenv("UTEK_PORT", "8765")), app, threaded=True)
    address = f"http://127.0.0.1:{server.server_port}"
    print(f"UTEK demos are running at {address}", flush=True)
    webbrowser.open(address)
    server.serve_forever()
