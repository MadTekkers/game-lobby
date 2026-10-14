"""Generates crosswords: random 180°-symmetric block pattern + backtracking fill (most-constrained slot first)."""
import json, random, time, sys
CL = json.load(open("clues.json"))
MINZ = {"easy": 3.4, "medium": 2.9, "hard": 2.3}

def pattern(n, density, rng):
    for _ in range(4000):
        g = [[0] * n for _ in range(n)]
        target = int(n * n * density)
        cnt = 0; tries = 0
        while cnt < target and tries < 500:
            tries += 1
            r, c = rng.randrange(n), rng.randrange(n)
            if g[r][c]: continue
            g[r][c] = g[n-1-r][n-1-c] = 1
            if not ok(g, n): g[r][c] = g[n-1-r][n-1-c] = 0
            else: cnt = sum(map(sum, g))
        if ok(g, n) and connected(g, n): return g
    return [[0] * n for _ in range(n)]

def runs_ok(line):
    run = 0
    for v in line + [1]:
        if v: 
            if 0 < run < 3: return False
            run = 0
        else: run += 1
    return True
def ok(g, n):
    return all(runs_ok(g[r]) for r in range(n)) and all(runs_ok([g[r][c] for r in range(n)]) for c in range(n))
def connected(g, n):
    cells = [(r, c) for r in range(n) for c in range(n) if not g[r][c]]
    if not cells: return False
    seen = {cells[0]}; st = [cells[0]]
    while st:
        r, c = st.pop()
        for a, b in ((r+1,c),(r-1,c),(r,c+1),(r,c-1)):
            if 0 <= a < n and 0 <= b < n and not g[a][b] and (a,b) not in seen: seen.add((a,b)); st.append((a,b))
    return len(seen) == len(cells)

def slots(g, n):
    S = []
    for r in range(n):
        c = 0
        while c < n:
            if not g[r][c]:
                s = c
                while c < n and not g[r][c]: c += 1
                if c - s >= 3: S.append([(r, x) for x in range(s, c)])
            else: c += 1
    for c in range(n):
        r = 0
        while r < n:
            if not g[r][c]:
                s = r
                while r < n and not g[r][c]: r += 1
                if r - s >= 3: S.append([(x, c) for x in range(s, r)])
            else: r += 1
    return S

def fill(g, n, diff, rng, limit):
    minz = MINZ[diff] - (0.7 if n >= 11 else 0)
    words = [w for w, v in CL.items() if v["z"] >= minz and len(w) <= n]
    bylen = {}
    for w in words: bylen.setdefault(len(w), []).append(w)
    idx = {}
    for L, ws in bylen.items():
        for i, w in enumerate(ws):
            for p, ch in enumerate(w): idx.setdefault((L, p, ch), set()).add(i)
    S = slots(g, n); grid = {}; used = set(); assign = {}
    deadline = time.time() + limit
    def cands(s):
        L = len(s); res = None
        for p, cell in enumerate(s):
            ch = grid.get(cell)
            if ch:
                st = idx.get((L, p, ch), set())
                res = st if res is None else res & st
                if not res: return []
        ws = bylen.get(L, [])
        out = [ws[i] for i in res] if res is not None else list(ws)
        return [w for w in out if w not in used]
    def rec():
        if time.time() > deadline: raise TimeoutError
        open_ = [i for i in range(len(S)) if i not in assign]
        if not open_: return True
        best = None; bc = None
        for i in open_:
            c = cands(S[i])
            if not c: return False
            if best is None or len(c) < len(bc): best, bc = i, c
            if len(bc) == 1: break
        if diff == "easy": bc.sort(key=lambda w: -CL[w]["z"] + rng.random() * 1.2)
        else: rng.shuffle(bc)
        for w in bc[:60]:
            prev = {cell: grid.get(cell) for cell in S[best]}
            for cell, ch in zip(S[best], w): grid[cell] = ch
            assign[best] = w; used.add(w)
            if rec(): return True
            del assign[best]; used.discard(w)
            for cell, ch in prev.items():
                if ch is None: grid.pop(cell, None)
                else: grid[cell] = ch
        return False
    try:
        if rec(): return S, assign, grid
    except TimeoutError: pass
    return None

def clue(w, diff, rng):
    v = CL[w]
    if diff == "hard" and v["s"]: return v["s"][0].capitalize()
    if diff == "easy" and v["x"] and w not in v["x"].lower(): return f'{v["d"]} ("{v["x"]}")'
    return v["d"]

def build(n, diff, seed, density, limit=None):
    limit = limit or (4 if n < 11 else 10)
    rng = random.Random(seed)
    for attempt in range(200):
        g = pattern(n, density, rng) if density > 0 else [[0]*n for _ in range(n)]
        r = fill(g, n, diff, rng, limit)
        if not r: continue
        S, assign, grid = r
        # numbering
        num = {}; k = 0
        for rr in range(n):
            for cc in range(n):
                if g[rr][cc]: continue
                starts = any(s[0] == (rr, cc) for s in S)
                if starts: k += 1; num[(rr, cc)] = k
        across, down = [], []
        for i, s in enumerate(S):
            e = {"n": num[s[0]], "row": s[0][0], "col": s[0][1], "answer": assign[i].upper(), "clue": clue(assign[i], diff, rng)}
            (across if s[0][0] == s[-1][0] else down).append(e)
        rows = ["".join("#" if g[rr][cc] else grid[(rr, cc)].upper() for cc in range(n)) for rr in range(n)]
        return {"size": n, "difficulty": diff, "grid": rows, "across": sorted(across, key=lambda e: e["n"]), "down": sorted(down, key=lambda e: e["n"])}
    return None

if __name__ == "__main__":
    plan = {"mini": (5, 0.12), "5": (7, 0.18), "10": (11, 0.27), "30": (15, 0.3)}
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    only = sys.argv[2].split(",") if len(sys.argv) > 2 else list(plan)
    try: out = json.load(open("../../src/data/crosswords.json"))
    except Exception: out = {}
    for key in only:
        n, dens = plan[key]
        for diff in ["easy", "medium", "hard"]:
            lst = out.setdefault(f"{key}-{diff}", [])
            seed = len(lst) * 101 + n
            while len(lst) < count:
                t = time.time(); p = build(n, diff, seed, dens); seed += 1
                if p: lst.append(p); print(key, diff, len(lst), f"{time.time()-t:.1f}s", flush=True)
                json.dump(out, open("../../src/data/crosswords.json", "w"))
