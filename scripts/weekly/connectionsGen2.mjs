// Connections generator v2: typed categories, quotas and red herrings.
// Rules (all difficulties): <=1 wordplay group per puzzle; hidden-word groups only when the caller's budget allows (~1 in 10 puzzles);
// exactly one valid solution; no category reused within a week; no repeated type pattern / purple type within a week per difficulty.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WORDPLAY } from "./connectionsTypes.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const BANK = fs.readFileSync(path.join(DIR, "connectionsBank2.txt"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => {
  const [t, lv, c, w, fam] = l.split("|");
  const words = [...new Set(w.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))];
  return { t, lv: +lv, c, w: words, set: new Set(words), fam: fam || c };
}).filter((b) => b.w.length >= 4);
for (const b of BANK) for (const x of b.w) if (!/^[A-Z]+$/.test(x)) throw new Error(`bad word ${x} in ${b.c}`);

/** Pairs that must never share a puzzle: members of one obviously belong to the other (unlisted overlap). */
const CONFLICTS = [
  ["Things with wings", "Birds|Insects|Avengers"], ["Things with a bridge", "Orchestra instruments"], ["Things with scales", "Fish|Snakes|Orchestra instruments"],
  ["Things with shells", "Sea creatures|Nuts"], ["Things that bark", "Dog breeds|Trees|Sea creatures"], ["Things with stripes", "Big cats"], ["Things with spots", "Big cats|Dog breeds"],
  ["Things with teeth", "Tools|Kitchen tools"], ["Things with a crown", "Royal titles|Chess pieces|Trees"], ["Things with needles", "Trees"], ["Things with keys", "Orchestra instruments"],
  ["Things with rings", "Planets|Trees"], ["Things with a deck", "Boats"], ["Things you can crack", "Nuts"], ["Things with a pupil", "Organs"],
  ["Teeny", "Tiny amount"], ["Enormous", "A whole lot"], ["Hoodwink", "Pilfer"], ["Exhausted", "Down in the dumps"], ["Bonkers", "Nonsense"],
  ["Golf scores", "Birds"], ["Martial arts", "Olympic events"], ["Famous Williamses", "Tennis greats"], ["Painters", "Renaissance artists"],
  ["Greek gods", "Roman gods|Norse gods"], ["Roman gods", "Planets|NASA programs"], ["Clue suspects", "Shades of red|Shades of green|Shades of yellow"],
  ["Shades of blue", "Shades of red|Shades of green|Shades of yellow|Gemstones"], ["Shades of red", "Shades of green|Shades of yellow|Gemstones"], ["Shades of green", "Shades of yellow|Gemstones|Herbs"],
  ["Card games", "Poker terms"], ["Chess pieces", "Chess terms|Royal titles"], ["NBA teams", "NFL teams|MLB teams|NHL teams"], ["NFL teams", "MLB teams|NHL teams"], ["MLB teams", "NHL teams"],
  ["Capital cities", "Olympic host cities"], ["Metals", "Chemical elements"], ["Hot drinks", "Coffee orders"], ["Breads", "Toast toppings"],
];
const conflictMap = new Map(); for (const [a, bs] of CONFLICTS) for (const b of bs.split("|")) { (conflictMap.get(a) || conflictMap.set(a, new Set()).get(a)).add(b); (conflictMap.get(b) || conflictMap.set(b, new Set()).get(b)).add(a); }
export const conflicts = (a, b) => !!conflictMap.get(a)?.has(b);
function rng(s) { s = s >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
const shuffle = (a, r) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

/** slot = allowed levels; purple slot last. */
export const TEMPLATES = {
  easy: { slots: [[0], [0, 1], [1], [1, 2]], herrings: 0, wordplay: false, nonSetPurple: false },
  medium: { slots: [[0, 1], [1, 2], [2], [3]], herrings: 1, wordplay: true, nonSetPurple: true },
  hard: { slots: [[0, 1], [1, 2], [2, 3], [3]], herrings: 2, wordplay: true, nonSetPurple: true, minHigh: 2 },
};

/** Number of ways to split the 16 shown words into the 4 categories (by full category lists); 1 = unique. */
export function countSolutions(words, cats, limit = 2) {
  const cnt = cats.map(() => 0); let n = 0;
  const opts = words.map((w) => cats.map((c, i) => (c.set.has(w) ? i : -1)).filter((i) => i >= 0));
  if (opts.some((o) => !o.length)) return 0;
  const order = words.map((_, i) => i).sort((a, b) => opts[a].length - opts[b].length);
  (function go(k) { if (n >= limit) return; if (k === order.length) { n++; return; } for (const i of opts[order[k]]) if (cnt[i] < 4) { cnt[i]++; go(k + 1); cnt[i]--; } })(0);
  return n;
}
export const herringsOf = (groups, cats) => groups.flatMap((g, i) => g.words.filter((w) => cats.some((c, j) => j !== i && c.set.has(w))).map((w) => ({ w, home: g.category, looks: cats.filter((c, j) => j !== i && c.set.has(w)).map((c) => c.c) })));
export const patternOf = (types) => [...types].sort().join("+");

/**
 * ctx: { allowHidden, weekCats:Set<category>, weekPatterns:Set<pattern>, weekPurple:Set<type>, usedFps:Set, usedGroups:Set }
 * Returns { gen:2, groups:[{level,category,words,type}], herrings:[...] }.
 */
export function makeConnections2(difficulty, seed, ctx = {}) {
  const T = TEMPLATES[difficulty]; const r = rng(seed * 2654435761 + 97);
  const weekCats = ctx.weekCats || new Set(), weekPatterns = ctx.weekPatterns || new Set(), weekPurple = ctx.weekPurple || new Set();
  const usedFps = ctx.usedFps || new Set(), usedGroups = ctx.usedGroups || new Set();
  for (let t = 0; t < 6000; t++) {
    const strict = t < 4000; // relax "never-seen group" / purple-type rules late in the search
    const chosen = []; let ok = true;
    // pick purple first so later picks can be biased toward overlapping (herring) categories
    for (const si of [3, 2, 1, 0]) {
      const lvls = T.slots[si];
      let pool = BANK.filter((b) => lvls.includes(b.lv) && !weekCats.has(b.c) && !chosen.some((c) => c.c === b.c || c.fam === b.fam || conflicts(c.c, b.c)));
      pool = pool.filter((b) => (WORDPLAY.has(b.t) ? T.wordplay && !chosen.some((c) => WORDPLAY.has(c.t)) && (b.t !== "hidden" || ctx.allowHidden) : true));
      if (si === 3 && T.nonSetPurple) pool = pool.filter((b) => b.t !== "set" && (!strict || !weekPurple.has(b.t)));
      if (si !== 3 && difficulty !== "hard") pool = pool.filter((b) => !WORDPLAY.has(b.t)); // medium: the only wordplay group is purple
      // variety: each type at most once per puzzle (plain sets / trivia at most twice)
      pool = pool.filter((b) => chosen.filter((c) => c.t === b.t).length < (b.t === "set" || b.t === "trivia" ? 2 : 1));
      if (!pool.length) { ok = false; break; }
      // herring bias: prefer categories that share words with ones already chosen
      const overl = pool.filter((b) => chosen.some((c) => c.w.some((x) => b.set.has(x))));
      const src = T.herrings && overl.length && r() < 0.85 ? overl : pool;
      chosen.push(src[Math.floor(r() * src.length)]);
    }
    if (!ok) continue;
    const cats = [chosen[3], chosen[2], chosen[1], chosen[0]]; // slot order 0..3
    const types = cats.map((c) => c.t);
    if (new Set(types).size < 3) continue;
    if (cats.filter((c) => WORDPLAY.has(c.t)).length > 1) continue;
    if (T.minHigh && cats.filter((c) => c.lv >= 2).length < T.minHigh) continue;
    const pat = patternOf(types); if (weekPatterns.has(pat)) continue;
    // choose words: herrings first (a shared word placed in its home group, kept out of the look-alike group)
    const used = new Set(); const groups = cats.map((c, i) => ({ level: i, category: c.c, type: c.t, words: [] }));
    const shared = []; for (let i = 0; i < 4; i++) for (const w of cats[i].w) { const others = cats.filter((c, j) => j !== i && c.set.has(w)); if (others.length) shared.push([w, i]); }
    for (const [w, i] of shuffle(shared, r)) {
      if (groups.filter((g) => g.words.some((x) => cats.some((c, j) => c !== cats[groups.indexOf(g)] && c.set.has(x)))).length >= 4) break;
      if (herringsOf(groups, cats).length >= T.herrings + (r() < 0.4 ? 1 : 0)) break;
      if (used.has(w) || groups[i].words.length >= 2) continue;
      groups[i].words.push(w); used.add(w);
    }
    for (let i = 0; i < 4; i++) {
      const excl = shuffle(cats[i].w.filter((w) => !used.has(w) && !cats.some((c, j) => j !== i && c.set.has(w))), r);
      while (groups[i].words.length < 4 && excl.length) { const w = excl.pop(); groups[i].words.push(w); used.add(w); }
      if (groups[i].words.length < 4) { ok = false; break; }
    }
    if (!ok) continue;
    const all = groups.flatMap((g) => g.words);
    if (new Set(all).size !== 16) continue;
    if (countSolutions(all, cats) !== 1) continue;
    const hs = herringsOf(groups, cats);
    if (hs.length < T.herrings) continue;
    const fp = [...all].sort().join("|"); if (usedFps.has(fp)) continue;
    if (strict && groups.some((g) => usedGroups.has(g.category + ":" + [...g.words].sort().join(",")))) continue;
    groups.forEach((g) => g.words = shuffle(g.words, r));
    return { gen: 2, groups, herrings: hs.map((h) => `${h.w} (${h.home}) also looks like ${h.looks.join(" / ")}`), fp, pattern: pat };
  }
  throw new Error(`connections v2: no ${difficulty} puzzle for seed ${seed}`);
}

/** Validates a v2 (or legacy) puzzle: 4 groups x 4, 16 unique words, levels 0-3, <=1 wordplay, unique solution when categories are known. */
export function validate2(p, difficulty) {
  const all = p.groups.flatMap((g) => g.words);
  if (p.groups.length !== 4 || p.groups.some((g) => g.words.length !== 4)) throw new Error("not 4x4");
  if (new Set(all).size !== 16) throw new Error("duplicate words");
  if (p.groups.map((g) => g.level).sort().join() !== "0,1,2,3") throw new Error("levels");
  if (p.gen === 2) {
    const cats = p.groups.map((g) => BANK.find((b) => b.c === g.category));
    if (cats.some((c) => !c)) throw new Error("unknown category");
    if (p.groups.some((g, i) => g.words.some((w) => !cats[i].set.has(w)))) throw new Error("word not in its category");
    if (p.groups.filter((g) => WORDPLAY.has(g.type)).length > 1) throw new Error("more than one wordplay group");
    if (countSolutions(all, cats) !== 1) throw new Error("not a unique solution");
    if (herringsOf(p.groups, cats).length < TEMPLATES[difficulty].herrings) throw new Error("not enough red herrings");
  }
  return true;
}
