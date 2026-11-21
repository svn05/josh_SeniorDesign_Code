// san vo, nov 21 2026
const el = (id) => document.getElementById(id);
let recorder,
  microphone,
  camera,
  recordingTimer,
  textCamera,
  nameText = "",
  outputLanguage = "fr";
let talkBusy = false,
  signBusy = false,
  textBusy = false;
let sourceLanguage = "en",
  otherLanguage = "fr"; // one side is always english
// english + the 10 competition languages: label and which browser voice to ask for
const LANGUAGES = {
  en: ["English", "en-CA"],
  ar: ["Arabic · العربية", "ar"],
  fr: ["French · Français", "fr-CA"],
  hi: ["Hindi · हिन्दी", "hi-IN"],
  zh: ["Mandarin · 中文", "zh-CN"],
  pt: ["Portuguese · Português", "pt-BR"],
  pa: ["Punjabi · ਪੰਜਾਬੀ", "pa-IN"],
  es: ["Spanish · Español", "es-MX"],
  tl: ["Tagalog", "fil-PH"],
  uk: ["Ukrainian · Українська", "uk-UA"],
  ur: ["Urdu · اردو", "ur-PK"],
};
const languageNames = Object.fromEntries(
  Object.entries(LANGUAGES).map(([code, entry]) => [code, entry[0]]),
);
const targetLanguage = () => (sourceLanguage === "en" ? otherLanguage : "en");
const googleKey = () =>
  el("mode").value === "google" ? el("key").value.trim() : "";

function openSettings(open) {
  el("settings").hidden = !open;
  el("settingsToggle").setAttribute("aria-expanded", String(open));
}

function readyToTranslate() {
  if (el("mode").value === "google" && !el("key").value.trim()) {
    openSettings(true);
    el("talkStatus").textContent =
      "Enter your Google API key or choose Offline rehearsal.";
    el("key").focus();
    return false;
  }
  return true;
}

el("settingsToggle").onclick = () => openSettings(el("settings").hidden);
el("phrase").oninput = () => {
  el("translate").disabled = talkBusy || !el("phrase").value.trim();
};

el("swap").onclick = () => {
  const phrase = el("phrase");
  if (
    !el("result").hidden &&
    (!phrase.value.trim() || phrase.value.trim() === el("original").textContent)
  ) {
    phrase.value = el("translation").textContent;
  }
  sourceLanguage = targetLanguage();
  showLanguages();
};
function showLanguages() {
  const target = targetLanguage();
  el("fromLang").textContent = languageNames[sourceLanguage];
  el("toLang").textContent = languageNames[target];
  el("fromLang").lang = el("phrase").lang = sourceLanguage;
  el("toLang").lang = target;
  el("phraseLabel").textContent = "Phrase in " + languageNames[sourceLanguage];
  el("sample").hidden = !["en", "fr"].includes(sourceLanguage); // only have sample recordings for these two
  el("result").hidden = true;
  el("talkStatus").textContent = "";
  el("phrase").oninput();
}
for (const id of ["language", "textTarget"]) {
  for (const [code, [label]] of Object.entries(LANGUAGES)) {
    if (id === "textTarget" || code !== "en")
      el(id).add(new Option(label, code));
  }
}
el("language").value = otherLanguage;
el("textTarget").value = "fr";
el("language").onchange = () => {
  if (sourceLanguage !== "en") sourceLanguage = el("language").value;
  otherLanguage = el("language").value;
  showLanguages();
};

// speaking the result. with a google key the server sends back a google voice clip,
// that covers all 11 languages. if not (or it fails) a voice on this computer is used
const player = new Audio();
let clip = {};
window.speechSynthesis?.getVoices(); // starts loading the voice list
async function say(text, language) {
  window.speechSynthesis?.cancel();
  player.pause();
  stopBoardVoice();
  let note = "",
    aside = "";
  if (googleKey()) {
    try {
      if (clip.text !== text || clip.language !== language) {
        const data = new FormData();
        data.set("text", text);
        data.set("language", language);
        data.set("key", googleKey());
        const response = await fetch("/speak", {
          method: "POST",
          headers: { "X-UTEK-Demo": "1" },
          body: data,
        });
        if (!response.ok)
          throw Error(
            (await response.json().catch(() => ({}))).error ||
              "The Google voice is unavailable.",
          );
        if (clip.url) URL.revokeObjectURL(clip.url);
        const blob = await response.blob();
        clip = { text, language, blob, url: URL.createObjectURL(blob) };
      }
      if (el("speakerSource").value === "board") {
        try {
          await playOnBoard(clip.blob);
          return "";
        } catch (e) {
          aside = "Played on this computer: " + e.message; // board speaker didnt work, use the mac
        }
      }
      player.src = clip.url;
      try {
        await player.play();
      } catch (e) {
        if (e.name !== "NotAllowedError") throw e;
        return "Press Speak translation to hear it.";
      }
      return aside;
    } catch (e) {
      note = " (" + e.message + ")";
    }
  }
  const wanted = LANGUAGES[language][1].split("-")[0];
  const voices = window.speechSynthesis?.getVoices() || [];
  const installed = voices.some((v) =>
    new RegExp("^" + (wanted === "fil" ? "(fil|tl)" : wanted), "i").test(
      v.lang,
    ),
  );
  if (!window.speechSynthesis || (voices.length && !installed)) {
    throw Error(
      "No " +
        languageNames[language].split(" · ")[0] +
        " voice on this computer" +
        note +
        ".",
    );
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANGUAGES[language][1];
  window.speechSynthesis.speak(utterance);
  if (el("speakerSource").value === "board" && !note)
    return "The ESP32 speaker only plays the Google voice, so this computer spoke.";
  return note && "Spoken with this computer's voice" + note + ".";
}
// speak without blocking the page, anything worth knowing goes in that tabs status line
function speakOut(text, language, statusId) {
  const add = (message) => {
    const shown = el(statusId).textContent;
    if (message && !shown.includes(message))
      el(statusId).textContent = [shown, message].filter(Boolean).join(" · ");
  };
  say(text, language).then(add, (e) => add(e.message));
}
function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

// ask for the mic or camera and turn browser errors into something useful
async function openMedia(constraints, device) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Error(
      "This browser will not give this page " +
        device +
        " access. Open http://localhost:" +
        location.port +
        " in Chrome.",
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    if (e.name === "NotAllowedError" || e.name === "SecurityError") {
      throw Error(
        "Access to the " +
          device +
          " was blocked. Allow it in the browser prompt and in System Settings → Privacy & Security, then reload.",
      );
    }
    if (e.name === "NotFoundError")
      throw Error("No " + device + " was found on this Mac.");
    if (e.name === "NotReadableError")
      throw Error("The " + device + " is in use by another app.");
    throw e;
  }
}

function wavBlob(samples, rate, gain) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset, s) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(
      44 + i * 2,
      Math.max(-1, Math.min(1, samples[i] * gain)) * 32767,
      true,
    );
  }
  return new Blob([view], { type: "audio/wav" });
}

// convert the browser recording (webm or mp4) to mono wav, same format as the sample
async function recordingToWav(blob) {
  if (!blob.size)
    throw Error("Nothing was recorded. Check the microphone and try again.");
  let decoded, context;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    try {
      context = new Context({ sampleRate: 16000 });
    } catch {
      context = new Context();
    }
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    return blob; // let the server try the original recording
  } finally {
    context?.close();
  }
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < mono.length; i++)
      mono[i] += data[i] / decoded.numberOfChannels;
  }
  let peak = 0;
  for (let i = 0; i < mono.length; i++)
    peak = Math.max(peak, Math.abs(mono[i]));
  if (peak < 0.003) {
    throw Error(
      "The microphone recorded silence. Check the input device in System Settings → Sound and the browser's microphone permission.",
    );
  }
  return wavBlob(mono, decoded.sampleRate, 0.9 / peak);
}

function showTab(name) {
  for (const id of ["talk", "text", "sign"]) {
    el(id).hidden = id !== name;
    el("show" + id[0].toUpperCase() + id.slice(1)).setAttribute(
      "aria-pressed",
      String(id === name),
    );
  }
  if (name === "sign") loadHands().catch(() => {}); // warm up, start camera reports it if this fails
  if (name !== "text" && textCamera) {
    stopTracks(textCamera);
    textCamera = null;
    el("textVideo").srcObject = null;
    el("textCapture").disabled = true;
    el("textCamera").disabled = false;
    el("textCamera").hidden = false;
    el("textStatus").textContent = "";
  }
  if (name !== "sign" && camera) {
    stopTracks(camera);
    camera = null;
    el("video").srcObject = null;
    el("capture").disabled = true;
    el("camera").disabled = false;
    el("camera").hidden = false;
    el("signStatus").textContent = "";
    showLive(null);
  }
}
el("showTalk").onclick = () => showTab("talk");
el("showText").onclick = () => showTab("text");
el("showSign").onclick = () => showTab("sign");
el("mode").onchange = () =>
  (el("keyRow").hidden = el("listenRow").hidden =
    el("mode").value !== "google");
async function post(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "X-UTEK-Demo": "1" },
    body: data,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Error(
      result.error ||
        "The request failed. Check the demo terminal for details.",
    );
  return result;
}
function controls(busy, recording = false) {
  talkBusy = busy;
  for (const id of [
    "swap",
    "mode",
    "key",
    "record",
    "sample",
    "settingsToggle",
    "language",
    "listen",
    "micSource",
    "speakerSource",
    "cameraSource",
    "showText",
    "showSign",
  ])
    el(id).disabled = busy;
  el("phrase").readOnly = busy;
  el("translate").disabled = busy || !el("phrase").value.trim();
  if (recording) el("record").disabled = false;
}
async function translate(audio) {
  controls(true);
  const source = sourceLanguage,
    mode = el("mode").value;
  try {
    const data = new FormData();
    const target = targetLanguage();
    data.set("source", source);
    data.set("target", target);
    data.set("mode", mode);
    if (mode === "google") {
      data.set("key", el("key").value.trim());
      data.set("listen", el("listen").value);
    }
    if (audio && el("keep").checked) {
      data.set("keep", "1");
      data.set("mic", lastMic);
    }
    if (audio) data.set("audio", audio, "phrase");
    else data.set("text", el("phrase").value);
    el("talkStatus").textContent = audio
      ? "Listening to the recording and translating…"
      : "Translating…";
    const result = await post("/translate", data);
    el("original").textContent = result.original;
    el("translation").textContent = result.translation;
    outputLanguage = target;
    el("translation").lang = outputLanguage;
    el("original").lang = source;
    el("resultLang").textContent = languageNames[outputLanguage];
    el("originalLang").textContent = languageNames[source] + " ·";
    el("result").hidden = false;
    el("talkStatus").textContent = [
      mode === "google" ? "Google Cloud Translation" : "Offline rehearsal",
      result.heard,
      result.seconds + " s processing",
      result.note && "Google speech recognition was skipped: " + result.note,
    ]
      .filter(Boolean)
      .join(" · ");
    speakOut(result.translation, outputLanguage, "talkStatus");
  } catch (error) {
    el("talkStatus").textContent = error.message;
  } finally {
    controls(false);
  }
}
el("translate").onclick = () => {
  if (readyToTranslate()) translate();
};
el("read").onclick = () =>
  speakOut(el("translation").textContent, outputLanguage, "talkStatus");
el("sample").onclick = async () => {
  if (!readyToTranslate()) return;
  controls(true);
  try {
    const res = await fetch("/examples/bank-" + sourceLanguage + ".wav");
    if (!res.ok) throw Error("Sample recording unavailable.");
    await translate(await res.blob());
  } catch (e) {
    el("talkStatus").textContent = e.message;
    controls(false);
  }
};
// esp32 mic over usb (web serial so chrome only). the board runs esp32_mic.ino and
// sends packets nonstop: 4 magic letters, a flags byte (bit 0 button held, bit 1 right slot),
// how many bad samples the board replaced, a 16 bit count, then that many 16 bit samples
// hold the button to record, let go to translate
const BOARD_RATE = 16000; // has to match the sample rate in esp32_mic.ino
const BOARD_BAUD = 921600; // has to match the baud in esp32_mic.ino
let lastMic = "computer"; // which mic made the recording thats being translated
let board,
  boardReader,
  boardChunks = null, // samples of the recording in progress
  boardRecent = [], // last quarter second, so the recording keeps the moment the button went down
  boardDown = null,
  boardHeard = 0,
  boardGlitches = 0, // bad samples the board replaced during this recording
  boardSlot = "",
  boardNoMic = false, // board says its mic is sending nothing
  boardWiring = 0, // which wiring the board found the mic on (0 is the normal one)
  boardDeaf = 0, // packets in this recording with no mic behind them
  boardPackets = 0,
  boardHeardAt = 0,
  boardLevel = 0,
  boardMeter,
  boardSeen = false, // the board has worked at least once on this page
  boardConnecting = null;

// quiet = reconnect to a port chrome already allows, no asking and dont forget it if it fails
function connectBoard(quiet = false) {
  if (board) return Promise.resolve();
  boardConnecting ??= openBoard(quiet).finally(() => (boardConnecting = null));
  return boardConnecting;
}

async function openBoard(quiet) {
  if (!navigator.serial) {
    throw Error(
      "The ESP32 microphone needs Chrome. Open http://localhost:" +
        location.port +
        " in Chrome.",
    );
  }
  let port = (await navigator.serial.getPorts())[0]; // a port that was allowed before
  if (!port && quiet) throw Error("The ESP32 is not connected.");
  try {
    port ??= await navigator.serial.requestPort();
  } catch {
    throw Error(
      "No ESP32 was chosen. Plug it in, press Record again and pick its serial port.",
    );
  }
  // another tab or program might still be letting go of the port so try for a few seconds
  for (let attempt = 1; ; attempt++) {
    try {
      await port.open({ baudRate: BOARD_BAUD, bufferSize: 1 << 20 });
      break;
    } catch (e) {
      if (attempt === 8) {
        throw Error(
          "The ESP32 port is in use. Close any other tab showing this demo and the Arduino serial monitor, then press Record a phrase. (" +
            e.message +
            ")",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await port
    .setSignals({ dataTerminalReady: false, requestToSend: false })
    .catch(() => {});
  board = port;
  boardDown = null;
  const before = boardHeard;
  readBoard(port);
  for (let waited = 0; boardHeard === before && waited < 4000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (boardHeard === before) {
    board = null;
    await boardReader?.cancel().catch(() => {});
    // probably the wrong port, let go of it so the next try asks which one
    if (!quiet) await port.forget?.().catch(() => {});
    throw Error(
      "No audio is arriving from the ESP32. Check that esp32_mic.ino is uploaded, the right port was picked and the Arduino serial monitor is closed.",
    );
  }
}

// keep the board connected. reopen after an unplug or if the stream stalls (only while something on it is chosen)
setInterval(() => {
  if (!boardWanted()) return;
  if (board && performance.now() - boardHeardAt > 3000 && !boardConnecting) {
    board = null; // stream went quiet, drop it and open a fresh one below
    boardReader?.cancel().catch(() => {});
  }
  if (!board && !boardConnecting && navigator.serial && boardSeen) {
    if (!talkBusy)
      el("talkStatus").textContent = "ESP32 not connected. Reconnecting…";
    connectBoard(true)
      .then(() =>
        el("micSource").value === "board" ? boardReport() : "ESP32 connected.",
      )
      .then(
        (report) => {
          if (!talkBusy) el("talkStatus").textContent = report;
        },
        () => {},
      );
  }
}, 2000);

// runs as long as the board is plugged in, samples only kept while recording
async function readBoard(port) {
  let pending = new Uint8Array(0),
    faults = 0;
  // a serial read can fail without the board being gone (buffer overrun, framing or break error)
  // the port gives a fresh stream after that so just take a new reader and keep going
  while (port.readable && board === port && faults < 50) {
    const reader = (boardReader = port.readable.getReader());
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          faults = Infinity; // cancelled on purpose
          break;
        }
        faults = 0;
        const bytes = new Uint8Array(pending.length + value.length);
        bytes.set(pending);
        bytes.set(value, pending.length);
        let at = 0;
        for (;;) {
          while (
            at + 4 <= bytes.length &&
            !(
              bytes[at] === 85 &&
              bytes[at + 1] === 84 &&
              bytes[at + 2] === 69 &&
              (bytes[at + 3] === 75 || bytes[at + 3] === 67)
            ) // the 4 magic letters. UTEK is sound, UTEC is a piece of the camera's stream
          )
            at++;
          if (at + 8 > bytes.length) break;
          if (bytes[at + 3] === 67) {
            const size = bytes[at + 4] | (bytes[at + 5] << 8);
            if (!size || size > 2048) {
              at += 4; // not a real packet header
              continue;
            }
            if (at + 6 + size > bytes.length) break;
            camFeed(bytes.subarray(at + 6, at + 6 + size));
            at += 6 + size;
            boardHeardAt = performance.now();
            continue;
          }
          const count = bytes[at + 6] | (bytes[at + 7] << 8);
          if (bytes[at + 4] > 63 || !count || count > 2048) {
            at += 4; // not a real packet header
            continue;
          }
          if (at + 8 + count * 2 > bytes.length) break;
          const down = (bytes[at + 4] & 1) === 1;
          const view = new DataView(bytes.buffer, at + 8, count * 2);
          const samples = new Int16Array(count);
          let peak = 0;
          for (let i = 0; i < count; i++) {
            samples[i] = view.getInt16(i * 2, true);
            peak = Math.max(peak, Math.abs(samples[i]));
          }
          if (boardChunks) boardGlitches += bytes[at + 5];
          boardNoMic = (bytes[at + 4] & 4) !== 0;
          boardWiring = bytes[at + 4] >> 4;
          boardNew = (bytes[at + 4] & 8) !== 0;
          if (boardChunks) {
            boardPackets++;
            if (boardNoMic) boardDeaf++;
          }
          boardSlot = bytes[at + 4] & 2 ? "right" : "left";
          at += 8 + count * 2;
          boardHeard += count;
          boardHeardAt = performance.now();
          boardSeen = true;
          boardLevel = Math.max(peak / 32768, boardLevel * 0.9);
          boardChunks?.push(samples);
          boardRecent.push(samples);
          if (boardRecent.length > 16) boardRecent.shift();
          if (boardDown !== null && down !== boardDown) boardButton(down);
          boardDown = down;
        }
        pending = bytes.slice(at);
      }
    } catch {
      faults++;
      pending = new Uint8Array(0); // the packet in flight is lost, the next header resyncs it
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      reader.releaseLock();
    }
  }
  // really gone: unplugged, cancelled, or failing over and over
  await port.close().catch(() => {});
  if (board === port) board = null;
  if (boardChunks) finishBoardRecording(); // mid phrase, use what arrived
}

const BOARD_DEAF =
  "The ESP32 is connected but its microphone is sending nothing. Check the microphone's wires (VDD to 3V3, GND to GND, SD to D22, SCK to D26, WS to D25) and that its header pins are soldered, not just pushed in.";
const boardNote = () =>
  [
    "",
    " Its SCK and WS wires are swapped; the board is working around that.",
    " Its SD wire is on D23, not D22; the board is working around that.",
    " Its SCK and WS wires are swapped and SD is on D23; the board is working around that.",
  ][boardWiring] || "";
// after connecting give the board a moment to find its mic, then say how it went
async function boardReport() {
  for (let waited = 0; boardNoMic && waited < 3500; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return boardNoMic
    ? BOARD_DEAF
    : "ESP32 microphone connected. Hold its button to talk, or use Record a phrase." +
        boardNote();
}

function startBoardRecording(lead = []) {
  boardChunks = [...lead];
  boardGlitches = boardDeaf = boardPackets = 0;
  el("record").classList.add("recording");
  controls(true, true);
  el("record").textContent = "Stop and translate";
  boardMeter = setInterval(() => {
    // 10 steps of 6 db, normal speech near the mic lights 3 to 6
    const steps = Math.max(
      0,
      Math.min(10, Math.round((20 * Math.log10(boardLevel || 1e-6) + 60) / 6)),
    );
    el("talkStatus").textContent =
      "Recording from the ESP32… " + "▮".repeat(steps) + "▯".repeat(10 - steps);
  }, 200);
  recordingTimer = setTimeout(
    () => boardChunks && finishBoardRecording(),
    29000,
  );
}

// the button on the board: hold to talk, let go to translate
function boardButton(down) {
  if (!down) {
    if (boardChunks) finishBoardRecording();
    return;
  }
  if (
    boardChunks ||
    talkBusy ||
    el("talk").hidden ||
    el("micSource").value !== "board"
  )
    return;
  if (readyToTranslate()) startBoardRecording(boardRecent);
}

async function recordFromBoard() {
  if (boardChunks) {
    finishBoardRecording();
    return;
  }
  if (talkBusy || !readyToTranslate()) return;
  controls(true);
  try {
    el("talkStatus").textContent = "Connecting to the ESP32 microphone…";
    await connectBoard();
    startBoardRecording();
  } catch (e) {
    el("talkStatus").textContent = e.message;
    controls(false);
  }
}

async function finishBoardRecording() {
  clearTimeout(recordingTimer);
  clearInterval(boardMeter);
  const chunks = boardChunks;
  boardChunks = null;
  el("record").textContent = "Record a phrase";
  el("record").classList.remove("recording");
  controls(true);
  try {
    const samples = new Float32Array(
      chunks.reduce((total, chunk) => total + chunk.length, 0),
    );
    let at = 0;
    for (const chunk of chunks)
      for (const sample of chunk) samples[at++] = sample / 32768;
    if (samples.length < BOARD_RATE * 0.6)
      throw Error("That was too short. Hold the button for the whole phrase.");
    if (boardDeaf * 2 > boardPackets) throw Error(BOARD_DEAF);
    // set the volume from the loudest speech and not from one click like the button itself
    // so use the level only 1 in 1000 samples goes over and clip the few above it
    const sizes = Array.from(samples, Math.abs).sort((x, y) => x - y);
    const loud = sizes[Math.floor(sizes.length * 0.999)];
    if (loud < 0.0015) {
      throw Error(
        "The ESP32 microphone recorded silence. Check the SCK, WS and SD wires against the pin numbers in esp32_mic.ino.",
      );
    }
    el("talkStatus").textContent = "Preparing the recording…";
    lastMic = "board";
    const unreadable = (100 * boardGlitches) / samples.length;
    await translate(wavBlob(samples, BOARD_RATE, 0.9 / loud));
    if (unreadable > 0.5 || el("keep").checked) {
      el("talkStatus").textContent +=
        " · ESP32 " +
        boardSlot +
        " slot, " +
        unreadable.toFixed(1) +
        "% of samples unreadable" +
        (unreadable > 0.5 ? ": check the microphone wires" : "");
    }
  } catch (e) {
    el("talkStatus").textContent = e.message;
    controls(false);
  }
}

el("micSource").onchange = async () => {
  if (el("micSource").value !== "board") return;
  try {
    el("talkStatus").textContent = "Connecting to the ESP32 microphone…";
    await connectBoard();
    el("talkStatus").textContent = await boardReport();
  } catch (e) {
    el("talkStatus").textContent = e.message;
  }
};
el("record").onclick = async () => {
  if (el("micSource").value === "board" || boardChunks)
    return recordFromBoard();
  if (recorder?.state === "recording") {
    recorder.stop();
    return;
  }
  if (talkBusy || !readyToTranslate()) return;
  controls(true);
  try {
    microphone = await openMedia(
      {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
      "microphone",
    );
    recorder = new MediaRecorder(microphone);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      clearTimeout(recordingTimer);
      stopTracks(microphone);
      el("record").textContent = "Record a phrase";
      el("record").classList.remove("recording");
      controls(true);
      try {
        el("talkStatus").textContent = "Preparing the recording…";
        lastMic = "computer";
        await translate(
          await recordingToWav(new Blob(chunks, { type: recorder.mimeType })),
        );
      } catch (e) {
        el("talkStatus").textContent = e.message;
        controls(false);
      }
    };
    recorder.start();
    el("record").classList.add("recording");
    controls(true, true);
    el("record").textContent = "Stop and translate";
    el("talkStatus").textContent = "Recording… Speak one short phrase.";
    recordingTimer = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 29000);
  } catch (e) {
    stopTracks(microphone);
    el("talkStatus").textContent = e.message;
    controls(false);
  }
};
// the rest of the board: a speaker (max98357a amp) and a camera (an esp32-cam wired to the
// main esp32). both need esp32_board.ino on the main board, it sets bit 3 of the flags byte.
// packets to the board: "UT", a type letter, a 16 bit length, then that many bytes
// S is sound for the speaker, X stops the speaker, C gets passed on to the camera
let boardNew = false, // the board runs esp32_board.ino and not the mic only sketch
  boardWrites = Promise.resolve(), // one packet at a time
  boardVoice = 0; // goes up with every clip so a new one stops the one before
const boardWanted = () =>
  ["micSource", "speakerSource", "cameraSource"].some(
    (id) => el(id).value === "board",
  );
const OLD_SKETCH =
  "The ESP32 is running the microphone-only sketch. Upload esp32_board/esp32_board.ino to use its speaker and camera.";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boardWrite(type, payload = new Uint8Array(0)) {
  const port = board;
  const packet = new Uint8Array(5 + payload.length);
  packet.set([
    85,
    84,
    type.charCodeAt(0),
    payload.length & 255,
    payload.length >> 8,
  ]);
  packet.set(payload, 5);
  const sent = boardWrites.then(async () => {
    if (!port?.writable || port !== board)
      throw Error("the ESP32 is not connected.");
    const writer = port.writable.getWriter();
    try {
      await writer.write(packet);
    } finally {
      writer.releaseLock();
    }
  });
  boardWrites = sent.catch(() => {});
  return sent;
}

function stopBoardVoice() {
  boardVoice++;
  if (board && boardNew && el("speakerSource").value === "board")
    boardWrite("X").catch(() => {});
}

// play 16 bit samples (at BOARD_RATE) on the board. they go down the cable 0.4 s ahead of
// real time, the board holds 1.5 s at most. comes back as soon as the sound has started
async function boardSound(samples) {
  await connectBoard(true).catch(() => {
    throw Error("the ESP32 is not connected.");
  });
  if (!boardNew) throw Error(OLD_SKETCH);
  const mine = ++boardVoice;
  await boardWrite("X");
  (async () => {
    const started = performance.now();
    for (let sent = 0; sent < samples.length && mine === boardVoice; ) {
      const due = Math.min(
        samples.length,
        Math.floor(
          ((performance.now() - started) / 1000 + 0.4) * BOARD_RATE,
        ),
      );
      while (sent < due) {
        const count = Math.min(1024, due - sent);
        await boardWrite(
          "S",
          new Uint8Array(
            samples.buffer,
            samples.byteOffset + sent * 2,
            count * 2,
          ),
        );
        sent += count;
      }
      await pause(40);
    }
  })().catch(() => {});
}

// a google voice clip (mp3) -> mono samples at the board's rate -> the board
async function playOnBoard(blob) {
  const Context = window.AudioContext || window.webkitAudioContext;
  let context, decoded;
  try {
    try {
      context = new Context({ sampleRate: BOARD_RATE });
    } catch {
      context = new Context();
    }
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    context?.close();
  }
  const step = decoded.sampleRate / BOARD_RATE; // 1 unless the browser refused 16 khz
  const samples = new Int16Array(Math.floor(decoded.length / step));
  const channels = [];
  for (let c = 0; c < decoded.numberOfChannels; c++)
    channels.push(decoded.getChannelData(c));
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    for (const data of channels) sum += data[Math.floor(i * step)];
    samples[i] = Math.max(-1, Math.min(1, sum / channels.length)) * 32767;
  }
  await boardSound(samples);
}

// short beep, so picking the speaker in settings shows right away if its wired
function boardBeep() {
  const samples = new Int16Array(BOARD_RATE * 0.4);
  for (let i = 0; i < samples.length; i++) {
    const fade = Math.min(1, i / 400, (samples.length - i) / 400);
    samples[i] = 9000 * fade * Math.sin((2 * Math.PI * 660 * i) / BOARD_RATE);
  }
  return boardSound(samples);
}

// camera. the esp32-cam sends jpegs nonstop: "UCAM", a letter (v small preview, s full size
// still, e the camera itself is not answering), a 32 bit length, then the jpeg. previews
// are drawn on a canvas and the canvas is handed out as a camera stream, so the rest of
// the page uses it the same way as the mac's camera
const camCanvas = document.createElement("canvas");
const camInk = camCanvas.getContext("2d");
let camPending = new Uint8Array(0),
  camBytes = 0,
  camFrames = 0,
  camShown = 0,
  camOrder = 0,
  camDrawn = 0,
  camFault = false, // the esp32-cam says its camera is not answering
  camOpening = false,
  camStream = null,
  stillWaiter = null;
const camLive = () => camStream?.getVideoTracks()[0]?.readyState === "live";

function camFeed(chunk) {
  camBytes += chunk.length;
  const bytes = new Uint8Array(camPending.length + chunk.length);
  bytes.set(camPending);
  bytes.set(chunk, camPending.length);
  let at = 0;
  for (;;) {
    while (
      at + 4 <= bytes.length &&
      !(
        bytes[at] === 85 &&
        bytes[at + 1] === 67 &&
        bytes[at + 2] === 65 &&
        bytes[at + 3] === 77
      )
    )
      at++;
    if (at + 9 > bytes.length) break;
    const kind = bytes[at + 4];
    const size =
      (bytes[at + 5] |
        (bytes[at + 6] << 8) |
        (bytes[at + 7] << 16) |
        (bytes[at + 8] << 24)) >>>
      0;
    if (kind === 101 && size === 0) {
      camFault = true;
      at += 9;
      continue;
    }
    // a preview is a few kb, a still around 100 kb. anything else is not a real header
    if (
      !(kind === 118 && size >= 64 && size <= 80000) &&
      !(kind === 115 && size >= 64 && size <= 700000)
    ) {
      at += 4;
      continue;
    }
    if (at + 9 + size > bytes.length) break;
    const jpeg = bytes.slice(at + 9, at + 9 + size);
    at += 9 + size;
    if (jpeg[0] === 255 && jpeg[1] === 216) camFrame(kind, jpeg);
  }
  camPending = bytes.slice(at);
}

function camFrame(kind, jpeg) {
  camFrames++;
  camFault = false;
  const blob = new Blob([jpeg], { type: "image/jpeg" });
  if (kind === 115) {
    stillWaiter?.(blob);
    return;
  }
  if (!camOpening && !camLive()) return; // nobody is watching
  const mine = ++camOrder;
  createImageBitmap(blob).then(
    (picture) => {
      if (mine > camDrawn) {
        camDrawn = mine;
        if (
          camCanvas.width !== picture.width ||
          camCanvas.height !== picture.height
        ) {
          camCanvas.width = picture.width;
          camCanvas.height = picture.height;
        }
        camInk.drawImage(picture, 0, 0);
        camShown++;
      }
      picture.close();
    },
    () => {}, // a damaged picture, the next one is along in a moment
  );
}

function camProblem(bytesBefore) {
  if (camFault)
    return "The ESP32-CAM is running but its camera is not answering. Reseat the camera's ribbon cable and press the reset button on the ESP32-CAM.";
  if (camBytes === bytesBefore)
    return "Nothing is arriving from the ESP32-CAM. Check that esp32_cam.ino is uploaded to it, that it has power (5V and GND) and that its U0T pin is wired to RX2 (D16) on the main ESP32.";
  return "The ESP32-CAM is sending data but no pictures. Check that CAM_BAUD is the same in both sketches and that the wire from U0T is pushed in.";
}

async function boardCamera() {
  await connectBoard();
  if (!boardNew) throw Error(OLD_SKETCH);
  const bytesBefore = camBytes,
    shownBefore = camShown;
  camOpening = true;
  try {
    for (let waited = 0; camShown === shownBefore && waited < 5000; waited += 100)
      await pause(100);
  } finally {
    camOpening = false;
  }
  if (camShown === shownBefore) throw Error(camProblem(bytesBefore));
  camStream = camCanvas.captureStream();
  return camStream;
}

const openCamera = (constraints) =>
  el("cameraSource").value === "board"
    ? boardCamera()
    : openMedia(constraints, "camera");

// ask the esp32-cam for one full size picture. the preview stops for about 3 s while it comes
function boardStill() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stillWaiter = null;
      reject(Error("No full-size picture arrived."));
    }, 9000);
    stillWaiter = (blob) => {
      clearTimeout(timer);
      stillWaiter = null;
      resolve(blob);
    };
    boardWrite("C", new Uint8Array([33, 115])).catch(() => {}); // "!s"
  });
}

// pressed is the change event. its missing when a link preset picks the speaker, no beep then
el("speakerSource").onchange = async (pressed) => {
  if (el("speakerSource").value !== "board") {
    boardVoice++;
    if (board && boardNew) boardWrite("X").catch(() => {});
    return;
  }
  try {
    el("talkStatus").textContent = "Connecting to the ESP32 speaker…";
    await connectBoard();
    if (!boardNew) throw Error(OLD_SKETCH);
    if (pressed) await boardBeep();
    el("talkStatus").textContent =
      "ESP32 speaker connected." +
      (pressed
        ? " It should have just beeped. If it stayed silent, check the amp's wires: BCLK to D12, LRC to D14, DIN to D13, VIN to 5V, GND to GND."
        : "");
  } catch (e) {
    el("talkStatus").textContent = e.message;
  }
};
el("cameraSource").onchange = async () => {
  if (el("cameraSource").value !== "board") return;
  try {
    el("talkStatus").textContent = "Connecting to the ESP32-CAM…";
    await connectBoard();
    if (!boardNew) throw Error(OLD_SKETCH);
    const framesBefore = camFrames,
      bytesBefore = camBytes;
    for (let waited = 0; camFrames === framesBefore && waited < 3000; waited += 100)
      await pause(100);
    el("talkStatus").textContent =
      camFrames === framesBefore
        ? camProblem(bytesBefore)
        : "ESP32-CAM connected. Use Start camera on Read a sign or ASL fingerspelling.";
  } catch (e) {
    el("talkStatus").textContent = e.message;
  }
};

// read a sign: take a picture, google vision reads the text, then translate + speak it
let textLanguage = "fr";
el("textCamera").onclick = async () => {
  el("textCamera").disabled = true;
  try {
    textCamera = await openCamera({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (el("text").hidden) {
      stopTracks(textCamera);
      textCamera = null;
      el("textCamera").disabled = false;
      return;
    }
    el("textVideo").srcObject = textCamera;
    await el("textVideo").play();
    el("textCamera").hidden = true;
    el("textCapture").disabled = false;
    el("textStatus").textContent = "";
  } catch (e) {
    stopTracks(textCamera);
    textCamera = null;
    el("textCamera").disabled = false;
    el("textStatus").textContent = e.message;
  }
};
el("textCapture").onclick = async () => {
  if (textBusy) return;
  if (!googleKey()) {
    el("textStatus").textContent =
      "Reading a sign uses Google Cloud. Enter your Google API key under Translation, Settings.";
    return;
  }
  const video = el("textVideo");
  if (!video.videoWidth) {
    el("textStatus").textContent = "Wait for the camera preview.";
    return;
  }
  textBusy = true;
  el("textCapture").disabled = el("textTarget").disabled = true;
  let aside = "";
  try {
    // the esp32-cam preview is small so ask it for one full size picture to read
    let picture = null;
    if (textCamera === camStream) {
      el("textStatus").textContent =
        "Taking a full-size picture with the ESP32-CAM…";
      picture = await boardStill().catch(() => null);
      if (!picture)
        aside =
          " · The ESP32-CAM sent no full-size picture, so the small preview was read. Check the wire from TX2 (D17) to its U0R pin.";
    }
    if (!picture) {
      const frame = document.createElement("canvas");
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      frame.getContext("2d").drawImage(video, 0, 0);
      picture = await new Promise((resolve) =>
        frame.toBlob(resolve, "image/jpeg", 0.92),
      );
    }
    const data = new FormData();
    data.set("image", picture, "sign.jpg");
    data.set("target", el("textTarget").value);
    data.set("key", googleKey());
    el("textStatus").textContent = "Reading the sign and translating…";
    const result = await post("/read", data);
    textLanguage = el("textTarget").value;
    const from = Object.keys(LANGUAGES).find(
      (code) => result.source === code || result.source.startsWith(code + "-"),
    );
    el("textOriginal").textContent = result.original;
    el("textTranslation").textContent = result.translation;
    el("textTranslation").lang = textLanguage;
    el("textLang").textContent = languageNames[textLanguage];
    el("textOriginalLang").textContent =
      (result.source === "fil"
        ? languageNames.tl
        : languageNames[from] || result.source || "Sign") + " ·";
    el("textResult").hidden = false;
    el("textStatus").textContent =
      "Google Cloud Vision and Translation · " +
      result.seconds +
      " s processing" +
      aside;
    speakOut(result.translation, textLanguage, "textStatus");
  } catch (e) {
    el("textStatus").textContent = e.message + aside;
  } finally {
    textBusy = false;
    el("textCapture").disabled = !textCamera;
    el("textTarget").disabled = false;
  }
};
el("textSpeak").onclick = () =>
  speakOut(el("textTranslation").textContent, textLanguage, "textStatus");

// asl fingerspelling. mediapipe finds 21 hand landmarks in the browser and a small
// network (asl_letters.json) reads the letter from their shape. no image leaves the page
const FINGERS = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];
const TIPS = [4, 8, 12, 16, 20];
const SURE = 0.6; // lowest probability that counts as a reading
const WINDOW_MS = 450; // a letter has to hold this long before it can be captured
let hands,
  letterNet,
  handsLoading,
  recent = [],
  steady = null;

function loadHands() {
  handsLoading ??= (async () => {
    const [vision, net] = await Promise.all([
      import("/web/mediapipe_vision.js"),
      fetch("/web/asl_letters.json").then((r) => {
        if (!r.ok) throw Error("asl_letters.json is missing");
        return r.json();
      }),
    ]);
    const files = await vision.FilesetResolver.forVisionTasks("/web");
    hands = await vision.HandLandmarker.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: "/web/hand_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      numHands: 1,
    });
    letterNet = net;
  })().catch((e) => {
    handsLoading = null;
    throw Error(
      "The hand tracker could not load (" + e.message + "). Reload the page.",
    );
  });
  return handsLoading;
}

// describe the hand so it doesnt matter where it is, how big, or how tilted
// order of the values has to match the training script that made asl_letters.json
function letterFeatures(hand, aspect) {
  const P = hand.map((p) => [
    (p.x - hand[0].x) * aspect,
    p.y - hand[0].y,
    (p.z - hand[0].z) * aspect,
  ]);
  const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // turn the hand so the wrist to middle knuckle line points up
  const reach = Math.hypot(P[9][0], P[9][1]) || 1e-9;
  const cos = -P[9][1] / reach,
    sin = P[9][0] / reach;
  const upright = P.map(([x, y, z]) => [
    cos * x - sin * y,
    sin * x + cos * y,
    z,
  ]);
  const extent = Math.max(1e-6, ...upright.map((q) => Math.hypot(q[0], q[1])));
  const out = [];
  for (const q of upright)
    out.push(q[0] / extent, q[1] / extent, q[2] / extent);
  out.push(sin, cos);
  // how bent each finger joint is
  for (const finger of FINGERS) {
    for (let i = 0; i + 2 < finger.length; i++) {
      const a = P[finger[i]],
        b = P[finger[i + 1]],
        c = P[finger[i + 2]];
      const u = gap(a, b) || 1e-9,
        v = gap(b, c) || 1e-9;
      out.push(
        ((b[0] - a[0]) * (c[0] - b[0]) +
          (b[1] - a[1]) * (c[1] - b[1]) +
          (b[2] - a[2]) * (c[2] - b[2])) /
          (u * v),
      );
    }
  }
  // fingertip spacing compared to palm size
  const palm = Math.max(
    1e-6,
    [5, 9, 13, 17].reduce((sum, i) => sum + gap(P[i], P[0]), 0) / 4,
  );
  for (let i = 0; i < 5; i++)
    for (let j = i + 1; j < 5; j++)
      out.push(gap(P[TIPS[i]], P[TIPS[j]]) / palm);
  for (const j of [5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19])
    out.push(gap(P[4], P[j]) / palm);
  for (const tip of TIPS) out.push(gap(P[tip], P[0]) / palm);
  return out;
}

function letterProbabilities(features) {
  let x = features.map((v, i) => (v - letterNet.mean[i]) / letterNet.std[i]);
  letterNet.layers.forEach((layer, depth) => {
    x = layer.w.map((row, k) => {
      let sum = layer.b[k];
      for (let i = 0; i < row.length; i++) sum += row[i] * x[i];
      return depth < letterNet.layers.length - 1 ? Math.max(0, sum) : sum;
    });
  });
  const top = Math.max(...x);
  const e = x.map((v) => Math.exp(v - top));
  const total = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / total);
}

// find a hand in a video frame or image and read its letter
function readLetter(source, width, height) {
  const hand = hands.detect(source).landmarks[0];
  if (!hand) return { hand: null };
  const p = letterProbabilities(letterFeatures(hand, width / height));
  const best = p.indexOf(Math.max(...p));
  return { hand, letter: letterNet.letters[best], sure: p[best] };
}

function showLive(seen) {
  const canvas = el("overlay"),
    ink = canvas.getContext("2d");
  ink.clearRect(0, 0, canvas.width, canvas.height);
  el("live").hidden = !seen;
  if (!seen) {
    recent = [];
    steady = null;
    return;
  }
  el("live").textContent = steady || (seen.hand ? "?" : "No hand");
  el("live").classList.toggle("found", Boolean(steady));
  if (!seen.hand) return;
  const at = (i) => [
    seen.hand[i].x * canvas.width,
    seen.hand[i].y * canvas.height,
  ];
  ink.lineWidth = Math.max(2, canvas.width / 200);
  ink.strokeStyle = ink.fillStyle = "#fff";
  for (const line of [...FINGERS, [5, 9, 13, 17]]) {
    ink.beginPath();
    line.forEach((i, k) => (k ? ink.lineTo(...at(i)) : ink.moveTo(...at(i))));
    ink.stroke();
  }
  for (let i = 0; i < 21; i++) {
    ink.beginPath();
    ink.arc(...at(i), ink.lineWidth * 1.4, 0, 2 * Math.PI);
    ink.fill();
  }
}

function watchHand() {
  if (!camera) return;
  const video = el("video");
  if (video.videoWidth && video.readyState >= 2) {
    const canvas = el("overlay");
    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    let seen;
    try {
      seen = readLetter(video, video.videoWidth, video.videoHeight);
    } catch (e) {
      el("signStatus").textContent = "The hand tracker stopped: " + e.message;
      return;
    }
    const now = performance.now();
    recent.push({
      now,
      letter: seen.hand && seen.sure >= SURE ? seen.letter : "",
    });
    // keep the last bit of readings (or the last 3 if frames come in slow)
    while (recent.length > 3 && now - recent[0].now > WINDOW_MS) recent.shift();
    recent = recent.filter((r) => now - r.now <= 2000);
    // steady = window is nearly full and at least 3/4 of it agrees
    const votes = recent.filter(
      (r) => r.letter && r.letter === seen.letter,
    ).length;
    const full = recent.length >= 3 && now - recent[0].now >= WINDOW_MS * 0.6;
    steady = full && votes >= recent.length * 0.75 ? seen.letter : null;
    showLive(seen);
  }
  requestAnimationFrame(watchHand);
}

function renderName() {
  el("spelling").hidden = !nameText;
  el("word").textContent = nameText;
  el("undo").disabled = !nameText || signBusy;
  el("speakName").disabled = !nameText || signBusy;
}
el("undo").onclick = () => {
  nameText = nameText.slice(0, -1);
  renderName();
};
el("speakName").onclick = () => speakOut(nameText, "en", "signStatus");
el("camera").onclick = async () => {
  el("camera").disabled = true;
  try {
    el("signStatus").textContent = "Loading the hand tracker…";
    await loadHands();
    camera = await openCamera({ video: { facingMode: "user" } });
    if (el("sign").hidden) {
      stopTracks(camera);
      camera = null;
      el("camera").disabled = false;
      return;
    }
    el("video").srcObject = camera;
    await el("video").play();
    el("camera").hidden = true;
    el("capture").disabled = false;
    el("signStatus").textContent =
      "Hold one hand up, palm toward the camera. Capture when the letter on the preview is right.";
    requestAnimationFrame(watchHand);
  } catch (e) {
    stopTracks(camera);
    camera = null;
    el("camera").disabled = false;
    el("signStatus").textContent = e.message;
  }
};
async function spell(action) {
  if (signBusy) return;
  signBusy = true;
  el("capture").disabled = true;
  el("anna").disabled = true;
  renderName();
  try {
    await action();
  } catch (e) {
    el("signStatus").textContent = e.message;
  } finally {
    signBusy = false;
    el("capture").disabled = !camera;
    el("anna").disabled = false;
    renderName();
  }
}
el("capture").onclick = () =>
  spell(async () => {
    if (!steady) {
      throw Error(
        recent.some((r) => r.letter)
          ? "That sign is not steady yet. Hold it still and capture again."
          : "No letter recognised. Hold one hand up, palm toward the camera.",
      );
    }
    nameText += steady;
    el("signStatus").textContent = "Captured " + steady + ".";
  });
el("anna").onclick = () =>
  spell(async () => {
    el("signStatus").textContent = "Reading the sample images…";
    await loadHands();
    let result = "";
    for (const file of ["a", "n", "n", "a"]) {
      const response = await fetch("/examples/" + file + ".png");
      if (!response.ok) throw Error("Sample image unavailable.");
      const image = await createImageBitmap(await response.blob());
      const seen = readLetter(image, image.width, image.height);
      image.close();
      if (!seen.hand)
        throw Error("No hand was found in sample " + file + ".png.");
      result += seen.letter;
    }
    nameText = result;
    el("signStatus").textContent = "Read four sample images.";
  });

// links can preset the settings: ?mic=board picks the esp32, ?mode=offline skips google, ?keep=1 keeps recordings
// ?speaker=board and ?camera=board pick the esp32 speaker and the esp32-cam, ?board=1 picks all three
// the google key is never taken from a link
const preset = new URLSearchParams(location.search);
if (preset.get("mode") === "offline") {
  el("mode").value = "offline";
  el("mode").onchange();
}
if (preset.get("keep") === "1") el("keep").checked = true;
const wholeBoard = preset.get("board") === "1";
if (wholeBoard || preset.get("mic") === "board") {
  el("micSource").value = "board";
  el("micSource").onchange();
}
if (wholeBoard || preset.get("speaker") === "board") {
  el("speakerSource").value = "board";
  el("speakerSource").onchange();
}
if (wholeBoard || preset.get("camera") === "board") {
  el("cameraSource").value = "board";
  el("cameraSource").onchange();
}
