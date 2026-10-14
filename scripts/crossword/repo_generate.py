"""Generate validated crosswords and insert them into the Supabase `crosswords` repository.
Usage: npm run crossword:generate -- --count N [--sizes 7,11,15] [--difficulties easy,medium,hard] [--backfill FILE]
Reads SUPABASE_URL, SUPABASE_ANON_KEY, CROSSWORD_INGEST_SECRET from env or /workspace/.secrets/game-lobby.env.
Needs only stdlib + clues.json (prebuilt from WordNet/wordfreq by build_clues.py)."""
import argparse, json, os, sys, time, random, urllib.request
CWD = os.getcwd(); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); os.chdir(os.path.dirname(os.path.abspath(__file__)))
from gen_crosswords import build
DENS = {7: 0.18, 11: 0.27, 15: 0.3}

def env():
    e = dict(os.environ)
    p = os.environ.get("GAME_LOBBY_ENV", "/workspace/.secrets/game-lobby.env")
    if os.path.exists(p):
        for line in open(p):
            if "=" in line: k, v = line.strip().split("=", 1); e.setdefault(k, v)
    return e

def validate(cw):
    n = cw["size"]; g = cw["grid"]; assert len(g) == n and all(len(r) == n for r in g)
    covered = set(); seen = set()
    for key, dr, dc in (("across", 0, 1), ("down", 1, 0)):
        for e in cw[key]:
            a = e["answer"]; assert len(a) >= 3 and a not in seen and a.lower() not in e["clue"].lower(); seen.add(a)
            for k, ch in enumerate(a):
                r, c = e["row"] + dr * k, e["col"] + dc * k; assert g[r][c] == ch; covered.add((r, c))
    for r in range(n):
        for c in range(n):
            assert (g[r][c] == "#") == (g[n-1-r][n-1-c] == "#")
            if g[r][c] != "#": assert (r, c) in covered
    return True

def insert(E, cw):
    body = json.dumps({"secret": E["CROSSWORD_INGEST_SECRET"], "p_size": cw["size"], "p_difficulty": cw["difficulty"], "p_grid": cw["grid"], "p_across": cw["across"], "p_down": cw["down"]}).encode()
    req = urllib.request.Request(E["SUPABASE_URL"] + "/rest/v1/rpc/insert_crossword", data=body, method="POST",
        headers={"apikey": E["SUPABASE_ANON_KEY"], "Authorization": "Bearer " + E["SUPABASE_ANON_KEY"], "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read() or "null")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=6); ap.add_argument("--sizes", default="7,11,15"); ap.add_argument("--difficulties", default="easy,medium,hard")
    ap.add_argument("--backfill"); ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args(); E = env(); stats = {}
    if a.backfill:
        data = json.load(open(os.path.join(CWD, a.backfill))); n = 0
        for k, lst in data.items():
            if k.startswith("mini"): continue
            for cw in lst: validate(cw); n += insert(E, cw) is not None
        print("backfilled", n); sys.exit(0)
    sizes = [int(s) for s in a.sizes.split(",")]; diffs = a.difficulties.split(",")
    rng = random.Random(a.seed if a.seed is not None else time.time_ns())
    combos = [(s, d) for s in sizes for d in diffs]; done = 0
    while done < a.count:
        s, d = combos[done % len(combos)]
        t = time.time(); cw = build(s, d, rng.randrange(1 << 30), DENS[s]); dt = time.time() - t
        if not cw: print(f"skip {s} {d} (no fill)", flush=True); continue
        validate(cw); new_id = insert(E, cw); done += 1
        stats.setdefault(s, []).append(dt)
        print(f"[{done}/{a.count}] {s}x{s} {d} id={new_id} {dt:.1f}s", flush=True)
    for s, ts in sorted(stats.items()): print(f"avg {s}x{s}: {sum(ts)/len(ts):.1f}s over {len(ts)}")
