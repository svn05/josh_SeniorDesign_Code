# san vo, nov 21 2026
"""run the mediapipe hand landmarker over the roboflow asl letters photos

    python extract_landmarks.py <dataset folder with train/ valid/ test/> ../web/hand_landmarker.task roboflow_landmarks.json

needs: pip install mediapipe pillow numpy
the dataset is the multi-class export of
https://public.roboflow.com/object-detection/american-sign-language-letters (public domain)
"""
import csv
import json
import os
import sys

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision
from PIL import Image

source, task, out = sys.argv[1:4]
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
finder = vision.HandLandmarker.create_from_options(
    vision.HandLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_path=task), num_hands=1))

records, seen = [], 0
for split in ("train", "valid", "test"):
    folder = os.path.join(source, split)
    for row in list(csv.reader(open(os.path.join(folder, "_classes.csv"))))[1:]:
        seen += 1
        image = Image.open(os.path.join(folder, row[0].strip())).convert("RGB")
        found = finder.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(np.asarray(image))))
        if found.hand_landmarks:
            records.append({"label": ALPHABET[[int(v) for v in row[1:]].index(1)], "w": image.width, "h": image.height,
                            "lm": [[round(p.x, 5), round(p.y, 5), round(p.z, 5)] for p in found.hand_landmarks[0]]})
finder.close()
json.dump(records, open(out, "w"))
print(f"found a hand in {len(records)} of {seen} photos")
