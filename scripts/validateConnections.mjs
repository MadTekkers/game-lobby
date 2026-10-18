// Validates every weekly Connections puzzle in Supabase: 4x4, 16 unique words, levels, v2 rules, no duplicate puzzles across weeks,
// <=1 wordplay group, per-week variety for v2 puzzles. Exit 1 on failure.
import fs from "fs";
import { validate2, patternOf } from "./weekly/connectionsGen2.mjs";
import { WORDPLAY, typeOf } from "./weekly/connectionsTypes.mjs";
const env = Object.fromEntries(fs.readFileSync("/workspace/.secrets/game-lobby.env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const H = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
const rows = await (await fetch(`${env.SUPABASE_URL}/rest/v1/weekly_puzzles?select=id,week_start,day,difficulty,fingerprint,data&game=eq.connections&limit=10000`, { headers: H })).json();
const errs = []; const fps = new Map(); const wk = new Map();
for (const r of rows) {
  const tag = `${r.week_start} ${r.difficulty} d${r.day} #${r.id}`;
  try { validate2(r.data, r.difficulty); } catch (e) { errs.push(`${tag}: ${e.message}`); }
  const fp = r.data.groups.flatMap((g) => g.words).sort().join("|");
  if (fp !== r.fingerprint) errs.push(`${tag}: fingerprint mismatch`);
  if (fps.has(fp)) errs.push(`${tag}: duplicate of ${fps.get(fp)}`); fps.set(fp, tag);
  if (r.data.gen === 2) {
    const ts = r.data.groups.map((g) => g.type);
    if (ts.filter((t) => WORDPLAY.has(t)).length > 1) errs.push(`${tag}: >1 wordplay`);
    const k = r.week_start + r.difficulty; const s = wk.get(k) || { pats: new Set(), cats: new Map() }; wk.set(k, s);
    const p = patternOf(ts); if (s.pats.has(p)) errs.push(`${tag}: repeated type pattern ${p} in week`); s.pats.add(p);
  }
}
// category reuse within a week (any difficulty, v2 puzzles only)
const byWeek = new Map(); for (const r of rows) (byWeek.get(r.week_start) || byWeek.set(r.week_start, []).get(r.week_start)).push(r);
for (const [w, rs] of byWeek) {
  const seen = new Map();
  for (const r of rs) for (const g of r.data.groups) { if (r.data.gen === 2 && seen.has(g.category)) errs.push(`${w}: category "${g.category}" repeated (${seen.get(g.category)} and ${r.difficulty} d${r.day})`); if (!seen.has(g.category)) seen.set(g.category, `${r.difficulty} d${r.day}`); }
  const hidden = rs.filter((r) => r.data.groups.some((g) => (g.type || typeOf(g.category)) === "hidden")).length;
  console.log(w, `${rs.length} puzzles, hidden-word puzzles ${hidden}`);
}
console.log(rows.length, "puzzles checked,", errs.length, "problems"); errs.forEach((e) => console.log("  " + e));
process.exit(errs.length ? 1 : 0);
