"""Print JSON list of N new 5x5 minis: python3 mini_cli.py N SEED DIFF[,DIFF...]"""
import json, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from gen_crosswords import build
n, seed, diffs = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3].split(",")
out = []; s = seed
while len(out) < n:
    d = diffs[len(out) % len(diffs)]
    cw = build(5, d, s, 0.12); s += 1
    if cw: out.append(cw)
print(json.dumps(out))
