// Weekly puzzle job. Generates a week (Mon..Sun) of NEW puzzles for Wordle, Connections (easy/medium/hard),
// Mini Strands, Spelling Bee and The Mini, validates them and stores them in Supabase (weekly_puzzles) so no redeploy is needed.
// Crosswords are NOT weekly: they live in the crossword repository (npm run crossword:generate).
//   npm run weekly                       -> ensure the current and next week exist (idempotent)
//   npm run weekly -- --backfill 8       -> also the 8 weeks before the current one
//   npm run weekly -- --week 2026-10-12  -> one specific week (Monday date)
//   npm run weekly -- --dry-run          -> generate + validate, print counts, write nothing
import fs from "fs"; import path from "path"; import { execFileSync } from "child_process"; import { fileURLToPath } from "url";
import { makePuzzle } from "./connectionsGen.mjs"; import { mediumBank } from "./connectionsMediumBank.mjs";
import { makeHard } from "./weekly/connectionsHardBank.mjs";
import { loadThemes, makeBoard, validateBoard, rng } from "./weekly/strandsGen.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2); const flag = (f) => args.includes(f); const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = flag("--dry-run");
const env = { ...Object.fromEntries((fs.existsSync("/workspace/.secrets/game-lobby.env") ? fs.readFileSync("/workspace/.secrets/game-lobby.env", "utf8") : "").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])), ...process.env };
const URL_ = env.SUPABASE_URL || env.VITE_SUPABASE_URL, KEY = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

// ---- weeks (Monday-start, America/Chicago) ----
function ctToday() { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value])); return new Date(Date.UTC(+p.year, +p.month - 1, +p.day)); }
const iso = (d) => d.toISOString().slice(0, 10);
function monday(d) { const x = new Date(d); const wd = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - wd); return x; }
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
let weeks;
if (val("--week")) weeks = [iso(monday(new Date(val("--week") + "T00:00:00Z")))];
else { const cur = monday(ctToday()); const back = +(val("--backfill") || 0); weeks = []; for (let i = back; i >= 1; i--) weeks.push(iso(addDays(cur, -7 * i))); weeks.push(iso(cur), iso(addDays(cur, 7))); }

// ---- existing rows (for no-repeat selection) ----
async function existing() {
  if (!URL_) return [];
  const rows = []; for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL_}/rest/v1/weekly_puzzles?select=week_start,day,game,difficulty,fingerprint,data->>theme&order=id`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    const page = await r.json(); if (!Array.isArray(page)) throw new Error(JSON.stringify(page)); rows.push(...page); if (page.length < 1000) break;
  }
  return rows;
}
async function insert(week, day, game, difficulty, data, fingerprint) {
  if (DRY) return "dry";
  const r = await fetch(`${URL_}/rest/v1/rpc/insert_weekly`, { method: "POST", headers: H, body: JSON.stringify({ secret: env.CROSSWORD_INGEST_SECRET, p_week: week, p_day: day, p_game: game, p_difficulty: difficulty, p_data: data, p_fingerprint: fingerprint }) });
  if (!r.ok) throw new Error(`insert failed ${r.status} ${await r.text()}`);
  return await r.json(); // null = already existed
}

// ---- validators ----
const guesses = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "public/wordle-guesses.json"))));
const ANSWERS = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/wordle-answers.json")));
const BEE_WORDS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/weekly/bee_words.json")));
const THEMES = loadThemes(path.join(ROOT, "scripts/weekly/strandsThemes.txt"));
const vConn = (p) => { const w = p.groups.flatMap((g) => g.words); if (new Set(w).size !== 16 || p.groups.map((g) => g.level).sort().join() !== "0,1,2,3") throw new Error("bad connections"); };
const vBee = (b) => { const L = new Set([b.center, ...b.outer]); if (L.size !== 7 || !b.pangrams.length) throw new Error("bad bee"); for (const w of b.answers) if (w.length < 4 || !w.includes(b.center) || [...w].some((c) => !L.has(c))) throw new Error("bad bee word " + w); };
const vMini = (cw) => { const n = cw.size, g = cw.grid; const cov = new Set();
  for (const [key, dr, dc] of [["across", 0, 1], ["down", 1, 0]]) for (const e of cw[key]) { if (e.clue.toLowerCase().includes(e.answer.toLowerCase())) throw new Error("clue has answer"); [...e.answer].forEach((ch, k) => { const r = e.row + dr * k, c = e.col + dc * k; if (g[r][c] !== ch) throw new Error("mini mismatch"); cov.add(r * n + c); }); }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { if ((g[r][c] === "#") !== (g[n - 1 - r][n - 1 - c] === "#")) throw new Error("asym"); if (g[r][c] !== "#" && !cov.has(r * n + c)) throw new Error("uncovered"); } };

// ---- generators ----
const seedOf = (week, extra) => { let h = 2166136261; for (const ch of week + extra) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h % 1e9; };
const MINI_DIFF = ["easy", "easy", "medium", "medium", "medium", "hard", "hard"];
function beeFor(seed, usedSets) {
  const r = rng(seed); const pangrams = BEE_WORDS.filter((w) => new Set(w).size === 7);
  for (let t = 0; t < 5000; t++) {
    const p = pangrams[Math.floor(r() * pangrams.length)]; const letters = [...new Set(p)].sort().join("");
    for (const center of [...letters].sort(() => r() - 0.5)) {
      const fp = letters + ":" + center; if (usedSets.has(fp)) continue;
      const ans = BEE_WORDS.filter((w) => w.includes(center) && [...w].every((c) => letters.includes(c)));
      if (ans.length < 18 || ans.length > 55) continue;
      const outer = [...letters].filter((c) => c !== center).sort(() => r() - 0.5).join("");
      const score = ans.reduce((a, w) => a + (w.length === 4 ? 1 : w.length) + (new Set(w).size === 7 ? 7 : 0), 0);
      return { fp, data: { center, outer, answers: ans, pangrams: ans.filter((w) => new Set(w).size === 7), max: score } };
    }
  }
  throw new Error("bee exhausted");
}

const rows = await existing();
const have = new Set(rows.map((r) => `${r.week_start}|${r.game}|${r.difficulty}|${r.day}`));
const fps = new Map(); for (const r of rows) { const k = r.game + "|" + r.difficulty; if (!fps.has(k)) fps.set(k, new Set()); fps.get(k).add(r.fingerprint); }
const fpSet = (g, d) => { const k = g + "|" + d; if (!fps.has(k)) fps.set(k, new Set()); return fps.get(k); };
const themeUse = new Map(); for (const r of rows) if (r.game === "strands" && r.theme) themeUse.set(r.theme, (themeUse.get(r.theme) || 0) + 1);
const counts = {}; const bump = (w, k) => { counts[w] ||= {}; counts[w][k] = (counts[w][k] || 0) + 1; };
const snapshot = {};
const t0 = Date.now();

for (const week of weeks) {
  snapshot[week] = [];
  const add = async (day, game, diff, data, fp) => {
    const r = await insert(week, day, game, diff, data, fp); if (r == null) throw new Error(`insert conflict ${week} ${game}-${diff} day ${day} fp ${String(fp).slice(0,80)}`); fpSet(game, diff).add(fp);
    bump(week, game + (diff ? "-" + diff : "")); snapshot[week].push({ day, game, difficulty: diff, fingerprint: fp, id: r });
  };
  const need = (game, diff, day) => !have.has(`${week}|${game}|${diff}|${day}`);
  // Wordle: 7 unused answers
  const pool = ANSWERS.filter((a) => !fpSet("wordle", "").has(a)); const wr = rng(seedOf(week, "wordle"));
  for (let day = 0; day < 7; day++) if (need("wordle", "", day)) {
    const avail = pool.filter((a) => !fpSet("wordle", "").has(a));
    const a = avail.length ? avail[Math.floor(wr() * avail.length)] : ANSWERS[Math.floor(wr() * ANSWERS.length)]; // pool exhausted -> reuse
    if (!guesses.has(a)) throw new Error("answer not in guess list " + a);
    await add(day, "wordle", "", { answer: a }, avail.length ? a : a + "@" + week);
  }
  // Connections easy / medium / hard
  for (const [diff, gen] of [["easy", (s) => makePuzzle(s)], ["medium", (s) => makePuzzle(s, mediumBank)], ["hard", (s) => makeHard(s)]]) {
    for (let day = 0; day < 7; day++) if (need("connections", diff, day)) {
      let p, fp, s = seedOf(week, diff + day);
      for (let t = 0; t < 400; t++, s++) { p = gen(s); fp = p.groups.flatMap((g) => g.words).sort().join("|"); if (!fpSet("connections", diff).has(fp)) break; }
      vConn(p); delete p.id; await add(day, "connections", diff, p, fp);
    }
  }
  // Mini Strands: least-used themes first, new boards every time
  for (let day = 0; day < 7; day++) if (need("strands", "", day)) {
    const order = [...THEMES].sort((a, b) => (themeUse.get(a.theme) || 0) - (themeUse.get(b.theme) || 0) || seedOf(week, a.theme + day) - seedOf(week, b.theme + day));
    let board = null;
    for (const t of order) { for (let k = 0; k < 5 && !board; k++) { const b = makeBoard(t, seedOf(week, t.theme + day + k)); if (b && !fpSet("strands", "").has(b.grid.join(""))) board = b; } if (board) break; }
    validateBoard(board); themeUse.set(board.theme, (themeUse.get(board.theme) || 0) + 1);
    await add(day, "strands", "", board, board.grid.join(""));
  }
  // Spelling Bee
  for (let day = 0; day < 7; day++) if (need("bee", "", day)) { const b = beeFor(seedOf(week, "bee" + day), fpSet("bee", "")); vBee(b.data); await add(day, "bee", "", b.data, b.fp); }
  // The Mini (5x5) via the crossword generator
  let miniDays = [...Array(7).keys()].filter((d) => need("mini", "", d));
  for (let round = 0; miniDays.length && round < 8; round++) {
    const out = JSON.parse(execFileSync("python3", [path.join(ROOT, "scripts/crossword/mini_cli.py"), String(miniDays.length * 2), String(seedOf(week, "mini" + round)), miniDays.map((d) => MINI_DIFF[d]).join(",")], { maxBuffer: 1 << 26 }).toString());
    for (const d of [...miniDays]) {
      const cw = out.find((c) => c.difficulty === MINI_DIFF[d] && !fpSet("mini", "").has(c.grid.join("")));
      if (!cw) continue;
      vMini(cw); await add(d, "mini", "", cw, cw.grid.join("")); miniDays = miniDays.filter((x) => x !== d);
    }
  }
  if (miniDays.length) console.warn("mini: could not fill days", miniDays, "for", week);
}
console.log(DRY ? "DRY RUN (nothing written)" : "Saved to Supabase weekly_puzzles");
for (const [w, c] of Object.entries(counts)) console.log(w, JSON.stringify(c));
const skipped = weeks.filter((w) => !counts[w]); if (skipped.length) console.log("already complete:", skipped.join(", "));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!DRY) {
  fs.mkdirSync(path.join(ROOT, "puzzles/weekly"), { recursive: true });
  for (const w of weeks) {
    const r = await fetch(`${URL_}/rest/v1/weekly_puzzles?select=id,day,game,difficulty,fingerprint,data&week_start=eq.${w}&order=game,difficulty,day`, { headers: H });
    const all = await r.json(); if (Array.isArray(all) && all.length) fs.writeFileSync(path.join(ROOT, `puzzles/weekly/${w}.json`), JSON.stringify({ week_start: w, count: all.length, puzzles: all }));
  }
}
