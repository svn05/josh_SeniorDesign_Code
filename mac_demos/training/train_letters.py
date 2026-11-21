# san vo, nov 21 2026
"""train the letter network (../web/asl_letters.json) from hand landmarks

    python train_letters.py <asl-now-fingerspelling folder> roboflow_landmarks.json ../web/asl_letters.json

needs: pip install scikit-learn numpy
training data:
  - aslnow fingerspelling landmarks, lots of signers on webcams (mit license)
    https://huggingface.co/datasets/sid220/asl-now-fingerspelling
  - landmarks from extract_landmarks.py (one signer, public domain photos)
the feature order in features() has to match the feature function in ../web/demo.js
"""
import glob
import json
import os
import sys

import numpy as np
from sklearn.neural_network import MLPClassifier

aslnow, roboflow, out = sys.argv[1:4]
LETTERS = "ABCDEFGHIKLMNOPQRSTUVWXY"  # j and z need motion so skip them
FINGERS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]]
TIPS = [4, 8, 12, 16, 20]
ASLNOW_ASPECT = 4 / 3      # aslnow stores x and y as fractions of a 4:3 webcam frame
ROBOFLOW_ASPECT = 0.87     # the roboflow export stretched every photo to a square, this undoes it


def unit(v):
    return v / max(np.linalg.norm(v), 1e-9)


def features(P):
    """the hand is 21 x 3 landmarks in real image proportions (x and z already multiplied by the aspect ratio)"""
    P = P - P[0]
    reach = max(np.linalg.norm(P[9, :2]), 1e-9)
    cos, sin = -P[9, 1] / reach, P[9, 0] / reach
    upright = P @ np.array([[cos, -sin, 0], [sin, cos, 0], [0, 0, 1]]).T  # rotate so wrist to middle knuckle points up
    upright = upright / max(np.linalg.norm(upright[:, :2], axis=1).max(), 1e-6)
    bends = [np.dot(unit(P[b] - P[a]), unit(P[c] - P[b])) for f in FINGERS for a, b, c in zip(f, f[1:], f[2:])]
    palm = max(np.mean([np.linalg.norm(P[i]) for i in (5, 9, 13, 17)]), 1e-6)
    gaps = [np.linalg.norm(P[TIPS[i]] - P[TIPS[j]]) / palm for i in range(5) for j in range(i + 1, 5)]
    gaps += [np.linalg.norm(P[4] - P[j]) / palm for j in (5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19)]
    gaps += [np.linalg.norm(P[t]) / palm for t in TIPS]
    return np.concatenate([upright.ravel(), [sin, cos], bends, gaps])


def vary(P, rng):
    """one random variation of a recorded hand: other hand, tilt, aspect + depth error, a bit of noise"""
    P = P - P[0]
    if rng.random() < 0.5:
        P = P * [-1, 1, 1]
    t = np.radians(rng.uniform(-20, 20))
    P = P @ np.array([[np.cos(t), -np.sin(t), 0], [np.sin(t), np.cos(t), 0], [0, 0, 1]]).T
    P = P * [np.exp(rng.uniform(-0.10, 0.10)), 1, np.exp(rng.uniform(-0.25, 0.25))]
    return P + rng.normal(0, 0.012 * np.linalg.norm(P[:, :2], axis=1).max(), P.shape)


hands = []
for letter in LETTERS:
    for path in sorted(glob.glob(os.path.join(aslnow, letter, "*.json"))):
        try:
            P = np.array([[p["x"], p["y"], p["z"]] for p in json.load(open(path))])
        except Exception:
            continue
        if P.shape == (21, 3):
            hands.append((P * [ASLNOW_ASPECT, 1, ASLNOW_ASPECT], LETTERS.index(letter)))
for record in json.load(open(roboflow)):
    if record["label"] in LETTERS:
        aspect = record["w"] / record["h"] * ROBOFLOW_ASPECT
        hands.append((np.array(record["lm"]) * [aspect, 1, aspect], LETTERS.index(record["label"])))

rng = np.random.default_rng(0)
X = np.array([features(vary(P, rng)) for P, _ in hands for _ in range(12)])
y = np.array([label for _, label in hands for _ in range(12)])
mean, std = X.mean(0), X.std(0)
std = np.where(std < 1e-4, 1.0, std)  # the wrist and the upright axis never move so dont divide by ~0
network = MLPClassifier((128, 64), alpha=1e-3, max_iter=150, early_stopping=True, n_iter_no_change=8, random_state=0)
network.fit((X - mean) / std, y)
print(f"{len(hands)} recorded hands, {len(X)} training samples, validation accuracy {network.best_validation_score_:.4f}")

rounded = lambda values: [round(float(v), 5) for v in values]
json.dump({"letters": LETTERS, "features": "f3", "mean": rounded(mean), "std": rounded(std),
           "layers": [{"w": [rounded(row) for row in W.T], "b": rounded(b)} for W, b in zip(network.coefs_, network.intercepts_)]},
          open(out, "w"), separators=(",", ":"))
