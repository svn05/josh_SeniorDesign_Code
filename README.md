# josh_SeniorDesign_Code
for utek 2026

## Mac demos

Double-click **Start-UTEK-Demos.command** in Finder. Leave its Terminal window open while presenting. The browser opens at **http://127.0.0.1:8765**. To stop the server, press Control-C in that Terminal window.

### Translation

The Translation tab works between English and Arabic, French, Hindi, Mandarin, Portuguese, Punjabi, Spanish, Tagalog, Ukrainian or Urdu. Open **Settings** and enter your Google Cloud key in the masked field. Pick the other language in **Language**. Use **⇄** to switch which side is speaking. Choose **Record a phrase**, speak, then choose **Stop and translate**. A recording can be up to 30 seconds. You can also type a sentence, or select **Try sample audio** for English and French. The page shows the transcript and the translation and speaks the translation. **Speak translation** replays it.

The Google Cloud project behind the key needs four APIs enabled: Cloud Translation, Cloud Speech-to-Text, Cloud Text-to-Speech and Cloud Vision. The status line under the buttons names what handled each phrase and says which API to enable if Google refuses one.

- **Speech recognition** uses Cloud Speech-to-Text. If Google refuses or hears nothing, Whisper on the Mac recognises the phrase instead. **Settings** can force Whisper.
- **Translation** uses Cloud Translation Basic v2.
- **Spoken output** uses Cloud Text-to-Speech. If Google refuses, a voice installed on the computer speaks instead. This Mac has no Punjabi, Tagalog or Urdu voice, so those three need Google.

With a key entered, the recording, the transcript and the text to speak go to Google. The key stays in the open page and is passed through the local server with each request. Refreshing the page clears it. In **Settings**, select **Offline rehearsal** to recognise and translate with the locally cached models and speak with the computer's voices. First use loads the models and can take longer.

### ESP32 microphone

The Translation tab can record from an INMP441 microphone on an ESP32 instead of the Mac's microphone, with a push-to-talk button on the board. This needs Chrome, because the page reads the board over USB with Web Serial.

1. Wire the INMP441 to the ESP32: VDD to 3V3, GND to GND, L/R to GND, SCK to D26, WS to D25 and SD to D22. Wire the button between D27 and GND.
2. Double-click `esp32_mic/flash.command` to upload the prebuilt firmware (`esp32_mic.merged.bin`). Or open `esp32_mic/esp32_mic.ino` in the Arduino IDE, choose the board **ESP32 Dev Module** and upload. Close the serial monitor afterwards. If the wiring differs, change the pin numbers at the top of the sketch and upload from the IDE.
3. In the demo, open **Settings** and set **Microphone** to **ESP32 over USB**. Pick the board's serial port the first time Chrome asks.

Hold the button on the board while speaking and let go to translate. **Record a phrase** on the page also records from the board. Use **⇄** to change who is speaking.

**Status on Nov 21:** the firmware uploads and the push-to-talk button works, but on our board the microphone was not sending any data yet, so recordings from the ESP32 came out silent. The page says so when that happens. The Mac's microphone works. `esp32_mic/original_test/` has a compiled copy of the first microphone test sketch and a script that uploads it. Its source is `Hardware Testing Scripts/Microphone/Microphone.ino`.

While recording, the status line shows a ten-step level bar. Speech close to the microphone should light three to six steps. If it stays empty, check the three signal wires against the pin numbers in the sketch. The board sends raw sound with no noise suppression, so hold the microphone close to the speaker's mouth in a loud room.

### Troubleshooting a recording

In **Settings**, tick **Keep the last recording on this Mac for troubleshooting** to save the last phrase as `mac_demos/last_recording_board.wav` or `last_recording_computer.wav`, with a small `.json` beside it. These files are ignored by git. A link can preset the settings: `?mic=board` picks the ESP32, `?mode=offline` skips Google and `?keep=1` ticks that box.

### Read a sign

Select **Read a sign** and **Start camera**. Hold the sign flat and facing the camera so it fills as much of the picture as possible. Choose the language under **Translate into**, then **Read and translate**. Cloud Vision reads the text in any of the languages, Cloud Translation detects its language and translates it, and the page shows and speaks the result. This tab needs the Google key and has no offline mode.

### ASL fingerspelling

Select **ASL fingerspelling** and **Start camera**. Hold one hand up with the palm toward the camera. The hand can be anywhere in the frame and the background does not need to be plain. The preview draws the tracked hand and shows the letter it reads in the top-left corner. Choose **Capture letter** when that letter is right, once per intended character. Capture the same sign twice for a doubled letter. Use **Undo letter** to remove a misread and **Speak name** to hear the finished name. **Try sample images** reads two fixture photos and replaces the displayed name with A-N-N-A.

The browser finds 21 hand landmarks with MediaPipe and a small network reads the letter from their geometry. Both run in the page, so no camera image leaves the browser. It reads 24 static letters. J and Z require motion. When no hand is in view or the sign is not steady, **Capture letter** adds nothing and says why.

On photos of signers the network was not trained on, it read about 9 letters in 10 correctly (346 of 379 across many signers, 104 of 119 for one further signer). Closed-fist letters (M, N, S, T) and the pairs I/Y, K/P, P/Q and U/R are the ones it confuses most. Rehearse each letter of the demo name with the person who will present.

### Local files

- `mac_demos/web/` contains the browser interface, including the fingerspelling reader in `demo.js`.
- `mac_demos/app.py` serves requests on loopback.
- `mac_demos/speech.py` runs Whisper and NLLB and makes the Google requests for translation, speech recognition, spoken output and sign reading.
- `mac_demos/web/mediapipe_vision.js`, `vision_wasm_internal.*` and `hand_landmarker.task` are the MediaPipe hand tracker. `asl_letters.json` holds the letter network.
- `mac_demos/training/` contains the scripts that produced `asl_letters.json`.
- `mac_demos/examples/` contains the audio and hand-image fixtures.
- `esp32_mic/esp32_mic.ino` is the microphone firmware for the ESP32.

The launcher uses the existing Anaconda Python and Hugging Face model cache on San’s Mac. The fingerspelling files are all in `mac_demos/web/` and need no network. Sources and licences for the hand tracker, the training data and the sample photos are listed in `mac_demos/THIRD_PARTY.md`.

[MediaPipe Hand Landmarker](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) · [Google Cloud Translation v2](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate)
