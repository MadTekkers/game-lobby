// One-off/maintenance: regenerate weekly Connections puzzles in place with the v2 generator (quotas + red herrings).
// Never touches a puzzle that has a recorded result or a room. Usage:
//   node scripts/regenConnections.mjs --weeks 2026-10-12,2026-10-19 --diffs medium,hard [--dry-run]
//   node scripts/regenConnections.mjs --all --diffs medium,hard
import fs from "fs";
import path from "path";
import { weekCtx, genSlot, groupKey } from "./weekly/connectionsWeek.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = { ...Object.fromEntries((fs.existsSync("/workspace/.secrets/game-lobby.env") ? fs.readFileSync("/workspace/.secrets/game-lobby.env", "utf8") : "").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])), ...process.env };
const URL_ = env.SUPABASE_URL, H = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes("--dry-run"), ALL = process.argv.includes("--all");
const WEEKS = (arg("--weeks") || "").split(",").filter(Boolean), DIFFS = (arg("--diffs") || "medium,hard").split(",");
const get = async (q) => { const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: H }); const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j)); return j; };
const seedOf = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h % 1e9; };
function rng(s) { s = s >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

const rows = await get("weekly_puzzles?select=id,week_start,day,difficulty,fingerprint,data&game=eq.connections&order=week_start,day&limit=5000");
const res = await get("results?select=puzzle_id&game=eq.connections&puzzle_id=gte.100000&limit=10000");
const rooms = await get("rooms?select=puzzle_id&game=eq.connections&puzzle_id=gte.100000&limit=10000");
const protectedIds = new Set([...res, ...rooms].map((x) => x.puzzle_id - 100000));
const isTarget = (r) => (ALL || WEEKS.includes(r.week_start)) && DIFFS.includes(r.difficulty) && !protectedIds.has(r.id) && r.data.gen !== 2;
const targets = rows.filter(isTarget);
const kept = rows.filter((r) => !targets.includes(r));
const usedFps = { easy: new Set(), medium: new Set(), hard: new Set() }; const usedGroups = new Set();
for (const r of kept) { usedFps[r.difficulty].add(r.fingerprint); r.data.groups.forEach((g) => usedGroups.add(groupKey(g))); }
const skipped = rows.filter((r) => (ALL || WEEKS.includes(r.week_start)) && DIFFS.includes(r.difficulty) && protectedIds.has(r.id));
console.log(`targets ${targets.length}, kept because played ${skipped.length}:`, skipped.map((r) => `${r.week_start} ${r.difficulty} d${r.day}`).join(", "));
const touched = new Set(); const out = [];
for (const wk of [...new Set(targets.map((r) => r.week_start))].sort()) {
  const wc = weekCtx(kept.filter((r) => r.week_start === wk)); const r = rng(seedOf(wk + "hidden"));
  for (const t of targets.filter((x) => x.week_start === wk).sort((a, b) => a.difficulty.localeCompare(b.difficulty) || a.day - b.day)) {
    const { data, fp } = genSlot(t.difficulty, seedOf(`${wk}${t.difficulty}${t.day}v2`), wc, usedFps[t.difficulty], usedGroups, r);
    out.push({ id: t.id, week: wk, day: t.day, difficulty: t.difficulty, data });
    if (!DRY) {
      const q = await fetch(`${URL_}/rest/v1/rpc/replace_weekly`, { method: "POST", headers: H, body: JSON.stringify({ secret: env.CROSSWORD_INGEST_SECRET, p_id: t.id, p_data: data, p_fingerprint: fp }) });
      if (!q.ok || (await q.json()) !== t.id) throw new Error(`replace failed for ${t.id}`);
    }
    touched.add(wk);
  }
}
fs.writeFileSync("/tmp/regen-connections.json", JSON.stringify(out, null, 1));
console.log(DRY ? "DRY RUN" : "replaced", out.length, "puzzles in weeks", [...touched].join(", "));
if (!DRY) for (const w of touched) {
  const all = await get(`weekly_puzzles?select=id,day,game,difficulty,fingerprint,data&week_start=eq.${w}&order=game,difficulty,day`);
  fs.writeFileSync(path.join(ROOT, `puzzles/weekly/${w}.json`), JSON.stringify({ week_start: w, count: all.length, puzzles: all }));
}
