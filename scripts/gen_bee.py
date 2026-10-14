"""Spelling Bee puzzles: word list = an-array-of-english-words (MIT) filtered by wordfreq zipf >= 2.9."""
import json, random, sys
from wordfreq import zipf_frequency as z
words = json.load(open("../node_modules/an-array-of-english-words/index.json"))
BLOCK = set(open("bee_block.txt").read().split())
W = [w for w in words if w.isalpha() and w.islower() and len(w) >= 4 and "s" not in w and len(set(w)) <= 7 and w not in BLOCK and z(w, "en") >= 2.9]
print(len(W), "eligible words")
rng = random.Random(7); out = []; seen = set()
pangrams = [w for w in W if len(set(w)) == 7]; rng.shuffle(pangrams)
for p in pangrams:
    letters = "".join(sorted(set(p)))
    if letters in seen: continue
    for center in rng.sample(letters, 7):
        ans = sorted(w for w in W if center in w and set(w) <= set(letters))
        if 18 <= len(ans) <= 55:
            seen.add(letters)
            outer = [c for c in letters if c != center]; rng.shuffle(outer)
            score = sum((1 if len(w) == 4 else len(w)) + (7 if len(set(w)) == 7 else 0) for w in ans)
            out.append({"center": center, "outer": "".join(outer), "answers": ans, "pangrams": [w for w in ans if len(set(w)) == 7], "max": score}); break
    if len(out) >= int(sys.argv[1] if len(sys.argv) > 1 else 90): break
json.dump(out, open("../src/data/bee.json", "w")); print(len(out), "puzzles")
