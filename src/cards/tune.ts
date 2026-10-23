// Nightly self-improvement: bots tune from a review of past hands (card_hands rows written by the edge function).
// Per game + level:
//  1. A/B verdict: half the bot seats play variant A (live params), half variant B (a candidate). If B's mean per-hand fitness beats A's
//     by > 1.5 standard errors (>= MIN_N hands each), B is adopted; if it is clearly worse or has had MAX_N hands without a win, it is dropped.
//  2. Review adjustments to A from what actually happened (e.g. Spades: systematic over/under-tricks shift the bid offset; nil success shifts nil willingness).
//  3. A fresh candidate B = A with one parameter nudged, optionally screened by a short self-play check supplied by the game.
import type { Rng } from "./core.ts";
import type { Level } from "./seats.ts";

export type HandRow = { level: string | null; variant: string | null; metrics: Record<string, unknown> };
export type LevelRow = { params: Record<string, number>; candidate: Record<string, number> | null; generation: number };
export type GameTuner<P extends Record<string, number> = Record<string, number>> = {
  game: string; defaults: Record<Level, P>; bounds: Record<string, [number, number]>;
  /** Tunable keys and nudge size per key, per level. */
  steps: Partial<Record<Level, Partial<Record<keyof P & string, number>>>>;
  fitness(m: Record<string, unknown>): number | null;
  /** Review-driven correction to the live params from variant-A rows. Returns the changed params and human-readable notes. */
  review(level: Level, p: P, rows: HandRow[]): { p: P; notes: string[] };
  /** Optional cheap screen: positive = candidate looks better in self-play. Rejects candidates that look clearly worse. */
  selfPlay?(level: Level, a: P, b: P, rng: Rng): number;
};
export const MIN_N = 30, MAX_N = 400;
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
const variance = (x: number[]) => { const m = mean(x); return x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1); };
const round = (x: number) => Math.round(x * 1000) / 1000;
export function clampParams<P extends Record<string, number>>(p: P, bounds: Record<string, [number, number]>): P {
  const o = { ...p } as Record<string, number>;
  for (const k of Object.keys(o)) { const b = bounds[k]; if (b) o[k] = round(Math.max(b[0], Math.min(b[1], o[k]))); }
  return o as P;
}

export type TuneOutcome = { level: Level; before: LevelRow; after: LevelRow; review: Record<string, unknown>; changed: boolean };
export function tuneLevel<P extends Record<string, number>>(t: GameTuner<P>, level: Level, cur: LevelRow | null, rows: HandRow[], rng: Rng): TuneOutcome {
  const before: LevelRow = cur ?? { params: {}, candidate: null, generation: 0 };
  let params = clampParams({ ...t.defaults[level], ...before.params } as P, t.bounds);
  let candidate = before.candidate ? clampParams({ ...params, ...before.candidate } as P, t.bounds) : null;
  let generation = before.generation;
  const mine = rows.filter((r) => r.level === level);
  const fa = mine.filter((r) => r.variant === "A").map((r) => t.fitness(r.metrics)).filter((x): x is number => x !== null);
  const fb = mine.filter((r) => r.variant === "B").map((r) => t.fitness(r.metrics)).filter((x): x is number => x !== null);
  const review: Record<string, unknown> = { handsA: fa.length, handsB: fb.length, meanA: round(mean(fa)), meanB: round(mean(fb)) };
  let decided = false;
  if (candidate && fa.length >= MIN_N && fb.length >= MIN_N) {
    const diff = mean(fb) - mean(fa); const se = Math.sqrt(variance(fa) / fa.length + variance(fb) / fb.length) || 1;
    review.z = round(diff / se);
    if (diff > 1.5 * se) { review.verdict = "adopted candidate B"; params = candidate; generation++; candidate = null; decided = true; }
    else if (diff < -1.5 * se || fb.length >= MAX_N) { review.verdict = "dropped candidate B"; candidate = null; decided = true; }
    else review.verdict = "still testing B";
  } else review.verdict = candidate ? "not enough hands yet" : "no candidate";
  if (!decided) {
    const r = t.review(level, params, mine.filter((x) => x.variant === "A"));
    if (r.notes.length) { params = clampParams(r.p, t.bounds); review.adjust = r.notes; if (candidate) candidate = null; generation++; review.verdict += "; review adjusted A (candidate restarted)"; }
  }
  if (!candidate) {
    const steps = Object.entries(t.steps[level] ?? {}) as [string, number][];
    for (let tries = 0; tries < 4 && steps.length && !candidate; tries++) {
      const [k, step] = steps[Math.floor(rng() * steps.length)];
      const b = clampParams({ ...params, [k]: params[k] + (rng() < 0.5 ? -step : step) } as P, t.bounds);
      if (b[k] === params[k]) continue;
      const sp = t.selfPlay ? t.selfPlay(level, params, b, rng) : 0;
      if (sp < -0.5) { (review.screened ??= [] as string[]) && (review.screened as string[]).push(`${k}=${b[k]} (${round(sp)})`); continue; }
      candidate = b; review.newCandidate = { [k]: b[k] }; if (t.selfPlay) review.selfPlay = round(sp);
    }
  }
  const after: LevelRow = { params, candidate, generation };
  const changed = JSON.stringify(after) !== JSON.stringify({ params: clampParams({ ...t.defaults[level], ...before.params } as P, t.bounds), candidate: before.candidate, generation: before.generation });
  return { level, before, after, review, changed };
}
