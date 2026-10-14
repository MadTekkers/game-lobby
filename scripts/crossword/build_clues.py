"""Builds a clue database from WordNet 3.x (Princeton WordNet license, permissive) and
word frequencies from `wordfreq` (Apache-2.0 code; data CC-BY-SA 4.0). Output: clues.json"""
import json, re, sys, os
from wordfreq import zipf_frequency
D = sys.argv[1]  # path to wordnet dict dir
BLOCK = set("""sex anal rape nazi slut porn shit fuck cunt dick cock tits piss whore bitch bastard nigger negro fag faggot""".split())
data = {}
for pos in ["noun", "verb", "adj", "adv"]:
    for line in open(os.path.join(D, "data." + pos), encoding="latin-1"):
        if line.startswith("  "): continue
        head, _, gloss = line.partition("|")
        p = head.split(); off = p[0]; n = int(p[3], 16)
        words = [p[4 + 2 * i] for i in range(n)]
        data[(pos, off)] = (words, gloss.strip())
out = {}
for pos in ["noun", "verb", "adj", "adv"]:
    for line in open(os.path.join(D, "index." + pos), encoding="latin-1"):
        if line.startswith("  "): continue
        p = line.split(); lemma = p[0]
        if not re.fullmatch(r"[a-z]{3,15}", lemma) or lemma in BLOCK: continue
        synset_cnt = int(p[2]); offs = p[-synset_cnt:]
        words, gloss = data[(pos, offs[0])]
        orig = next((w for w in words if w.lower() == lemma), None)
        if orig is None or orig != lemma: continue  # skip proper nouns (capitalized in WordNet)
        words = [w.lower() for w in words if w.islower()]
        parts = [g.strip() for g in gloss.split(";")]
        defn = parts[0]; ex = next((x.strip('" ') for x in parts[1:] if x.startswith('"')), None)
        stem = lemma[:4] if len(lemma) > 4 else lemma
        if stem in defn.lower() or len(defn) < 4 or len(defn) > 90: continue
        syns = [w for w in words if w != lemma and re.fullmatch(r"[a-z]+", w) and stem not in w and lemma not in w]
        z = zipf_frequency(lemma, "en")
        if z < 2.3: continue
        prev = out.get(lemma)
        if prev and prev["n"] >= synset_cnt: continue
        if ex and re.search(r"\b" + lemma + r"\b", ex) and len(ex) < 60 and not re.search(r"[A-Z0-9]|kill|murder|die|dead|war|massacre", ex):
            ex = re.sub(r"\b" + lemma + r"\b", "___", ex)
        else: ex = None
        out[lemma] = {"z": round(z, 2), "d": defn[0].upper() + defn[1:], "s": syns[:2], "x": ex, "n": synset_cnt, "pos": pos}
for v in out.values(): v.pop("n")
json.dump(out, open("clues.json", "w"))
print(len(out), "words", sum(1 for v in out.values() if v["z"] >= 4), "common")
