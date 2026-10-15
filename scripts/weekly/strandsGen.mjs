// Mini Strands board generator (6 rows x 5 cols) from a theme bank; never runs dry (new word subsets/layouts).
import fs from "fs";
export const R = 6, C = 5;
export function loadThemes(path) {
  return fs.readFileSync(path, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => {
    const [theme, clue, spans, words] = l.split("|");
    return { theme, clue, spangrams: spans.split(",").map((s) => s.trim()), words: [...new Set(words.trim().split(/\s+/))].filter((w) => /^[A-Z]{3,8}$/.test(w)) };
  });
}
export function rng(s) { s = s >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
const nb = (r, c) => { const o = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const a = r + dr, b = c + dc; if (a >= 0 && a < R && b >= 0 && b < C) o.push([a, b]); } return o; };
function regionsOk(g) { const seen = new Set(); for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { if (g[r][c] || seen.has(r * C + c)) continue; let n = 0; const st = [[r, c]]; seen.add(r * C + c); while (st.length) { const [a, b] = st.pop(); n++; for (const [x, y] of nb(a, b)) if (!g[x][y] && !seen.has(x * C + y)) { seen.add(x * C + y); st.push([x, y]); } } if (n < 3) return false; } return true; }
export const spans = (p) => { const rs = p.map((x) => x[0]), cs = p.map((x) => x[1]); return (rs.includes(0) && rs.includes(R - 1)) || (cs.includes(0) && cs.includes(C - 1)); };
function place(g, word, rand, paths, needSpan, budget) {
  const cells = []; for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (!g[r][c]) cells.push([r, c]);
  cells.sort(() => rand() - 0.5); const path = [];
  function dfs(r, c, i) {
    if (--budget.n < 0) return false;
    g[r][c] = word[i]; path.push([r, c]);
    if (i === word.length - 1) { if ((!needSpan || spans(path)) && regionsOk(g)) return true; }
    else { const n = nb(r, c).filter(([a, b]) => !g[a][b]).sort(() => rand() - 0.5); for (const [a, b] of n) if (dfs(a, b, i + 1)) return true; }
    g[r][c] = null; path.pop(); return false;
  }
  for (const [r, c] of cells) if (dfs(r, c, 0)) { paths.push(path.slice()); return true; }
  return false;
}
/** Picks a spangram + word subset totalling 30 letters and tiles the grid. */
export function makeBoard(t, seed) {
  const rand = rng(seed * 7919 + 1);
  for (let attempt = 0; attempt < 400; attempt++) {
    const span = t.spangrams[Math.floor(rand() * t.spangrams.length)];
    if (span.length < 5 || span.length > 12) continue;
    const need = 30 - span.length;
    const pool = t.words.filter((w) => w !== span && !span.includes(w)).sort(() => rand() - 0.5);
    let chosen = null;
    for (let k = 0; k < 200 && !chosen; k++) { // random subset-sum
      const pick = []; let sum = 0;
      for (const w of [...pool].sort(() => rand() - 0.5)) { if (sum + w.length <= need) { pick.push(w); sum += w.length; } if (sum === need) break; }
      if (sum === need && pick.length >= 3 && pick.length <= 7) chosen = pick;
    }
    if (!chosen) continue;
    for (let s2 = 0; s2 < 30; s2++) {
      const r2 = rng(seed * 31 + attempt * 101 + s2); const g = Array.from({ length: R }, () => Array(C).fill(null)); const paths = []; const budget = { n: 60000 };
      if (!place(g, span, r2, paths, true, budget)) continue;
      // longest words first
      const order = [...chosen].sort((a, b) => b.length - a.length); let ok = true;
      for (const w of order) if (!place(g, w, r2, paths, false, budget)) { ok = false; break; }
      if (!ok) continue;
      return { theme: t.theme, clue: t.clue, spangram: span, words: order, grid: g.map((r) => r.join("")), paths: { [span]: paths[0], ...Object.fromEntries(order.map((w, i) => [w, paths[i + 1]])) } };
    }
  }
  return null;
}
export function validateBoard(p) {
  const used = new Set(); const all = [p.spangram, ...p.words];
  if (p.grid.length !== R || p.grid.some((r) => r.length !== C)) throw new Error("bad grid");
  for (const w of all) { const path = p.paths[w]; if (path.length !== w.length) throw new Error("len " + w);
    path.forEach((c, j) => { if (p.grid[c[0]][c[1]] !== w[j]) throw new Error("letter " + w); if (j && Math.max(Math.abs(path[j - 1][0] - c[0]), Math.abs(path[j - 1][1] - c[1])) !== 1) throw new Error("adj " + w); const k = c.join(); if (used.has(k)) throw new Error("reuse"); used.add(k); }); }
  if (used.size !== R * C || !spans(p.paths[p.spangram])) throw new Error("coverage/span");
}
