// Audits category-type frequency across every Connections source. Usage: node scripts/connectionsAudit.mjs [--json out.json]
import fs from "fs";
import { typeOf, WORDPLAY } from "./weekly/connectionsTypes.mjs";
import { bank } from "./connectionsBank.mjs";
import { mediumBank } from "./connectionsMediumBank.mjs";
import { wordplay, surface } from "./weekly/connectionsHardBank.mjs";
import { BANK as BANK2 } from "./weekly/connectionsGen2.mjs";
const ENV = Object.fromEntries((fs.existsSync("/workspace/.secrets/game-lobby.env") ? fs.readFileSync("/workspace/.secrets/game-lobby.env", "utf8") : "").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const lists = new Map(); const tags = new Map();
for (const [, c, w] of [...bank, ...mediumBank, ...wordplay, ...surface]) lists.set(c, new Set([...(lists.get(c) || []), ...w]));
for (const b of BANK2) { lists.set(b.c, b.set); tags.set(b.c, b.t); }

export function stats(puzzles) {
  const n = puzzles.length, types = {}; let hid = 0, wp = 0, wp2 = 0, herr = 0, wpGroups = 0; const pats = new Set();
  for (const p of puzzles) {
    const ts = p.groups.map((g) => g.type || typeOf(g.category, tags.get(g.category)));
    ts.forEach((t) => (types[t] = (types[t] || 0) + 1));
    const w = ts.filter((t) => WORDPLAY.has(t)).length; wpGroups += w;
    if (ts.includes("hidden")) hid++; if (w) wp++; if (w >= 2) wp2++;
    pats.add([...ts].sort().join("+"));
    const cats = p.groups.map((g) => lists.get(g.category) || new Set(g.words));
    if (p.groups.some((g, i) => g.words.some((x) => cats.some((c, j) => j !== i && c.has(x))))) herr++;
  }
  const pct = (x) => n ? Math.round((100 * x) / n) + "%" : "-";
  const tot = Object.values(types).reduce((a, b) => a + b, 0);
  return { puzzles: n, withHidden: pct(hid), withWordplay: pct(wp), with2plusWordplay: pct(wp2), wordplayGroupsPerPuzzle: n ? +(wpGroups / n).toFixed(2) : 0, withRedHerring: pct(herr), distinctPatterns: pats.size,
    typeShare: Object.fromEntries(Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((100 * v) / tot) + "%"])) };
}
async function weekly() {
  const H = { apikey: ENV.SUPABASE_ANON_KEY, Authorization: `Bearer ${ENV.SUPABASE_ANON_KEY}` };
  const r = await fetch(`${ENV.SUPABASE_URL}/rest/v1/weekly_puzzles?select=id,week_start,day,difficulty,data&game=eq.connections&order=week_start,day&limit=2000`, { headers: H });
  return r.json();
}
if ((process.argv[1] || "").endsWith("connectionsAudit.mjs")) {
  const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  const out = { classic: { easy: stats(read("src/data/connections.json")), medium: stats(read("src/data/connections-medium.json")), hard: stats(read("src/data/connections-hard.json")) }, weekly: {} , weeklyByWeek: {} };
  const rows = await weekly();
  for (const d of ["easy", "medium", "hard"]) out.weekly[d] = stats(rows.filter((r) => r.difficulty === d).map((r) => r.data));
  out.weekly.all = stats(rows.map((r) => r.data));
  for (const r of rows) (out.weeklyByWeek[r.week_start] ||= []).push(r.data);
  for (const [w, ps] of Object.entries(out.weeklyByWeek)) { const s = stats(ps); out.weeklyByWeek[w] = `hidden ${s.withHidden}, wordplay ${s.withWordplay}, herring ${s.withRedHerring}, patterns ${s.distinctPatterns}/${s.puzzles}`; }
  const bankTypes = (b, f) => { const t = {}; for (const x of b) { const k = f(x); t[k] = (t[k] || 0) + 1; } return t; };
  out.banks = { easyBank: bankTypes(bank, (x) => typeOf(x[1])), mediumBank: bankTypes(mediumBank, (x) => typeOf(x[1])), hardBank: bankTypes([...wordplay, ...surface], (x) => typeOf(x[1])) };
  if (BANK2.length) out.banks.newBank = bankTypes(BANK2, (x) => x.t);
  const j = process.argv.indexOf("--json"); if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
