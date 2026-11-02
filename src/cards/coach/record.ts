// Decision recording for hand reviews and mistake drills. Pure TS: storage is injected so it runs in vitest.
// Every decision the local player makes is compared with the coach's rows (the same simulations behind the Train comparison cards).
import type { Card } from "../core.ts";
import type { CoachGame } from "./level.ts";

export type Verdict = "best" | "close" | "mistake";
export type Opt = { key: string; label: string };
/** What the quiz shows: the cards and plain facts needed to make the same decision again. Only the player's own cards + public info. */
export type Spot = { prompt: string; groups: { label: string; cards: Card[] }[]; facts: string[]; options: Opt[]; ok: string[]; best: string; why: string;
  /** game state to recreate the spot (opaque to this module) */ state?: unknown };
export type Decision = {
  id: string; game: CoachGame; hand: string; handLabel: string; at: number;
  step: string; situation: string; chosen: Opt; best: Opt; verdict: Verdict; why: string; cost: string;
  /** dedupe key for drills: same kind of spot (e.g. "hard 16 vs 10") */ sig: string; spot: Spot;
  /** the player first picked something else and took the coach's advice to try again */ caught?: Opt;
};
/** One coach row, reduced to what classification needs (ev = expected value in the game's unit, seGap = paired standard error vs the best). */
export type EvRow = { key: string; label: string; ev: number; seGap?: number; se?: number };

/** Compare the chosen option with the coach's best. "close" = within the simulation's noise or a trivial margin, so it isn't a mistake. */
export function classify(rows: EvRow[], chosenKey: string, minGap: number): { verdict: Verdict; best: EvRow; mine: EvRow | null; gap: number; ok: string[] } {
  const sorted = [...rows].sort((a, b) => b.ev - a.ev); const best = sorted[0];
  const noise = (r: EvRow) => (r.seGap != null ? 1.96 * r.seGap : r.se != null ? 1.96 * Math.hypot(r.se, best.se ?? 0) : 0);
  const okRow = (r: EvRow) => r === best || best.ev - r.ev <= Math.max(minGap, noise(r));
  const ok = sorted.filter(okRow).map((r) => r.key);
  const mine = sorted.find((r) => r.key === chosenKey) ?? null;
  if (!mine) return { verdict: "mistake", best, mine, gap: NaN, ok };
  const gap = best.ev - mine.ev;
  return { verdict: mine === best || gap <= 0 ? "best" : okRow(mine) ? "close" : "mistake", best, mine, gap, ok };
}

// ---------- storage ----------
export type KV = Pick<Storage, "getItem" | "setItem">;
const kv0 = (): KV | null => (typeof localStorage === "undefined" ? null : localStorage);
const read = <T>(kv: KV | null, k: string, d: T): T => { try { const v = kv?.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (kv: KV | null, k: string, v: unknown) => { try { kv?.setItem(k, JSON.stringify(v)); } catch { /* storage full: drop silently */ } };
export const LOG_MAX = 150, DRILL_MAX = 80;
const logKey = (g: CoachGame) => `coach_log_${g}`, drillKey = (g: CoachGame) => `coach_drills_${g}`;
const listeners = new Set<() => void>();
export const onCoachStore = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const changed = () => listeners.forEach((f) => f());

export function loadLog(g: CoachGame, kv = kv0()): Decision[] { return read<Decision[]>(kv, logKey(g), []); }
/** Record a decision (replacing one with the same id) and, when it was a mistake or a caught mistake, add its spot to the drills. */
export function recordDecision(d: Decision, kv = kv0(), now = Date.now()) {
  const log = loadLog(d.game, kv).filter((x) => x.id !== d.id); log.push(d);
  write(kv, logKey(d.game), log.slice(-LOG_MAX));
  if (d.verdict === "mistake" || d.caught) write(kv, drillKey(d.game), addDrill(loadDrills(d.game, kv), d, now));
  changed();
}
export const handDecisions = (g: CoachGame, hand: string, kv = kv0()) => loadLog(g, kv).filter((d) => d.hand === hand);
/** Hands with recorded decisions, newest first. */
export function recentHands(g: CoachGame, kv = kv0()): { hand: string; label: string; n: number }[] {
  const m = new Map<string, { hand: string; label: string; n: number; at: number }>();
  for (const d of loadLog(g, kv)) { const x = m.get(d.hand) ?? { hand: d.hand, label: d.handLabel, n: 0, at: d.at }; x.n++; x.at = Math.max(x.at, d.at); m.set(d.hand, x); }
  return [...m.values()].sort((a, b) => b.at - a.at).map(({ hand, label, n }) => ({ hand, label, n }));
}

// ---------- drills: simple spaced repetition ----------
export type Drill = { id: string; game: CoachGame; sig: string; spot: Spot; situation: string; added: number; due: number; streak: number; lapses: number; seen: number; retired: boolean };
/** Answer it right this many times in a row to retire a spot. */
export const RETIRE_AFTER = 2;
/** After a right answer the spot comes back this much later; a wrong answer makes it due again right away. */
export const AGAIN_AFTER_MS = 4 * 3600_000;

export function loadDrills(g: CoachGame, kv = kv0()): Drill[] { return read<Drill[]>(kv, drillKey(g), []); }
export function saveDrills(g: CoachGame, items: Drill[], kv = kv0()) { write(kv, drillKey(g), items); changed(); }
/** Add a missed spot. The same kind of spot again (same sig) refreshes the existing card instead of piling up duplicates. */
export function addDrill(items: Drill[], d: Decision, now: number): Drill[] {
  const i = items.findIndex((x) => x.sig === d.sig);
  if (i >= 0) { const x = items[i]; const upd: Drill = { ...x, spot: d.spot, situation: d.situation, due: now, streak: 0, lapses: x.lapses + 1, retired: false }; return [...items.slice(0, i), upd, ...items.slice(i + 1)]; }
  const nu: Drill = { id: d.id, game: d.game, sig: d.sig, spot: d.spot, situation: d.situation, added: now, due: now, streak: 0, lapses: 0, seen: 0, retired: false };
  const all = [...items, nu];
  // over the cap: drop retired ones first, then the oldest
  while (all.length > DRILL_MAX) { const r = all.findIndex((x) => x.retired); all.splice(r >= 0 ? r : 0, 1); }
  return all;
}
export const isDue = (x: Drill, now: number) => !x.retired && x.due <= now;
export const dueDrills = (items: Drill[], now: number) => items.filter((x) => isDue(x, now)).sort((a, b) => a.due - b.due || b.lapses - a.lapses);
export const activeDrills = (items: Drill[]) => items.filter((x) => !x.retired);
export function dueCount(g: CoachGame, kv = kv0(), now = Date.now()) { return dueDrills(loadDrills(g, kv), now).length; }
/** Grade one quiz answer. */
export function answerDrill(x: Drill, correct: boolean, now: number): Drill {
  if (!correct) return { ...x, seen: x.seen + 1, streak: 0, lapses: x.lapses + 1, due: now };
  const streak = x.streak + 1;
  return { ...x, seen: x.seen + 1, streak, retired: streak >= RETIRE_AFTER, due: now + AGAIN_AFTER_MS };
}
/** Order for a drill session: due spots first (oldest due first, most-missed first), capped. */
export function sessionQueue(items: Drill[], now: number, max = 10, includeNotDue = false): string[] {
  const due = dueDrills(items, now);
  const rest = includeNotDue ? activeDrills(items).filter((x) => !isDue(x, now)).sort((a, b) => a.due - b.due) : [];
  return [...due, ...rest].slice(0, max).map((x) => x.id);
}
/** After a wrong answer in a session, the spot comes back after `gap` other questions (sooner than the rest). */
export function requeue(queue: string[], id: string, gap = 2): string[] { const q = queue.filter((x) => x !== id); q.splice(Math.min(gap, q.length), 0, id); return q; }

// ---------- hand grade ----------
export type Grade = { letter: "A" | "B" | "C" | "D"; score: number; best: number; close: number; mistakes: number; headline: string; detail: string };
/** A plain-language summary of a hand: right/close moves count fully/mostly, mistakes not at all. */
export function gradeHand(ds: Decision[]): Grade {
  const best = ds.filter((d) => d.verdict === "best").length, close = ds.filter((d) => d.verdict === "close").length, mistakes = ds.filter((d) => d.verdict === "mistake").length;
  const n = Math.max(1, ds.length); const score = (best + 0.85 * close) / n;
  const letter = !ds.length ? "A" : score >= 0.9 ? "A" : score >= 0.75 ? "B" : score >= 0.55 ? "C" : "D";
  const headline = !ds.length ? "No decisions to review" : mistakes === 0 ? (close ? "Solid hand — every move was right or close enough" : "Perfect hand — you matched the coach every time")
    : mistakes === 1 ? "One move to work on" : `${mistakes} moves to work on`;
  const detail = `${best} matched the coach${close ? `, ${close} close call${close > 1 ? "s" : ""}` : ""}${mistakes ? `, ${mistakes} mistake${mistakes > 1 ? "s" : ""}` : ""}.`;
  return { letter, score, best, close, mistakes, headline, detail };
}
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
