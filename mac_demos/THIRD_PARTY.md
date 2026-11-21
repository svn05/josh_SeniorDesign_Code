# Third-party components

| What | Where it is | Source | Licence |
|---|---|---|---|
| MediaPipe Tasks Vision 1.2.3 (JavaScript and WebAssembly) | `web/mediapipe_vision.js`, `web/vision_wasm_internal.js`, `web/vision_wasm_internal.wasm` | npm package `@mediapipe/tasks-vision` | Apache-2.0 |
| MediaPipe Hand Landmarker model (float16) | `web/hand_landmarker.task` | https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task | Apache-2.0 |
| ASLNow fingerspelling landmarks (training data) | not stored here; used by `training/train_letters.py` | https://huggingface.co/datasets/sid220/asl-now-fingerspelling | MIT |
| American Sign Language Letters photos by David Lee (training data and the two sample photos) | `examples/a.png`, `examples/n.png`; the rest is not stored here | https://public.roboflow.com/object-detection/american-sign-language-letters | Public domain |

`web/asl_letters.json` is the letter network trained for this project by `training/train_letters.py` from the two data sets above.

Accuracy was checked on two further photo sets that were not used for training: `ronibandini/AmericanSignLanguage` (MIT) and `Marxulia/asl_sign_languages_alphabets_v03` (no licence stated), both on Hugging Face.

The sample photos were resized from the dataset's 416 x 416 export to 364 x 416 to undo its square stretch.

## Translation and sign reading

These run as services or from the Hugging Face cache on the Mac. None of them is stored in this folder.

| What | Used for | Source |
|---|---|---|
| Google Cloud Translation Basic v2 | translation | https://translation.googleapis.com/language/translate/v2 |
| Google Cloud Speech-to-Text v1 | speech recognition | https://speech.googleapis.com/v1/speech:recognize |
| Google Cloud Text-to-Speech v1 | spoken output | https://texttospeech.googleapis.com/v1/text:synthesize |
| Google Cloud Vision v1 | reading signs | https://vision.googleapis.com/v1/images:annotate |
| OpenAI Whisper small | speech recognition on the Mac | `openai/whisper-small` on Hugging Face |
| Meta NLLB-200 distilled 600M | offline rehearsal translation | `facebook/nllb-200-distilled-600M` on Hugging Face |
