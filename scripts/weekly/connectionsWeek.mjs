// Week-level quota bookkeeping for Connections (shared by weekly.mjs and regenConnections.mjs).
import { typeOf } from "./connectionsTypes.mjs";
import { makeConnections2, validate2, patternOf } from "./connectionsGen2.mjs";

export const HIDDEN_PER_WEEK = 2; // 21 Connections puzzles a week -> <= 2 hidden-word groups (~1 in 10)
export const groupKey = (g) => g.category + ":" + [...g.words].sort().join(",");
const typesOf = (p) => p.groups.map((g) => g.type || typeOf(g.category));

/** Context from the puzzles of a week that are kept (not being generated). */
export function weekCtx(keptRows) {
  const c = { weekCats: new Set(), patterns: { easy: new Set(), medium: new Set(), hard: new Set() }, purple: { easy: new Set(), medium: new Set(), hard: new Set() }, hidden: 0 };
  for (const r of keptRows) {
    const ts = typesOf(r.data); r.data.groups.forEach((g) => c.weekCats.add(g.category));
    c.patterns[r.difficulty]?.add(patternOf(ts)); c.purple[r.difficulty]?.add(ts[ts.length - 1]);
    if (ts.includes("hidden")) c.hidden++;
  }
  return c;
}
/** Generates one puzzle for (difficulty, seed) honouring the week context, and records it in the context. */
export function genSlot(diff, seed, wc, usedFps, usedGroups, r) {
  const allowHidden = diff !== "easy" && wc.hidden < HIDDEN_PER_WEEK && r() < 0.15;
  const p = makeConnections2(diff, seed, { allowHidden, weekCats: wc.weekCats, weekPatterns: wc.patterns[diff], weekPurple: wc.purple[diff], usedFps, usedGroups });
  validate2(p, diff);
  const { fp, pattern, ...data } = p;
  data.groups.forEach((g) => { wc.weekCats.add(g.category); usedGroups.add(groupKey(g)); });
  wc.patterns[diff].add(pattern); wc.purple[diff].add(data.groups[3].type); usedFps.add(fp);
  if (data.groups.some((g) => g.type === "hidden")) wc.hidden++;
  return { data, fp };
}
