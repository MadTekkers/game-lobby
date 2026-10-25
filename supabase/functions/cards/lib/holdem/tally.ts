// Live hand tally: each player's best hand right now (works pre-flop too) and multiway odds to showdown.
// Only ever called with hole cards the client legitimately has: your own, or everyone's at a tutorial table.
import type { Card, Rng } from "../core.ts";
import { evaluate, evalInts, describe, toInt } from "./eval.ts";

const B = 13, B5 = B ** 5;
const pack = (cat: number, k: number[]) => { let v = cat; for (let i = 0; i < 5; i++) v = v * B + (k[i] ?? 0); return v; };
const RI: Record<string, number> = { "2": 0, "3": 1, "4": 2, "5": 3, "6": 4, "7": 5, "8": 6, "9": 7, T: 8, J: 9, Q: 10, K: 11, A: 12 };

/** Score of the best hand from 2–7 cards on the same scale as evaluate() (fewer than 5 cards: pairs/trips/quads + kickers only). */
export function currentScore(cards: Card[]): number {
  if (cards.length >= 5) return evaluate(cards);
  const cnt = new Array(13).fill(0); for (const c of cards) cnt[RI[c[0]]]++;
  const by = (n: number) => { const r: number[] = []; for (let i = 12; i >= 0; i--) if (cnt[i] === n) r.push(i); return r; };
  const q = by(4), t = by(3), p = by(2), s = by(1);
  if (q.length) return pack(7, [q[0], ...s]);
  if (t.length) return pack(3, [t[0], ...s]);
  if (p.length >= 2) return pack(2, [p[0], p[1], ...s]);
  if (p.length) return pack(1, [p[0], ...s]);
  return pack(0, s);
}
export const describeNow = (cards: Card[]) => describe(currentScore(cards));
export const categoryOf = (score: number) => Math.floor(score / B5);

export type TallyRow = { seat: number; score: number; desc: string; rank: number };
/** Players still in the hand, best hand first. rank 1 = currently winning (ties share a rank). */
export function tally(holes: Record<number, Card[]>, board: Card[]): TallyRow[] {
  const rows = Object.entries(holes).filter(([, h]) => h?.length === 2).map(([s, h]) => { const sc = currentScore([...h, ...board]); return { seat: Number(s), score: sc, desc: describe(sc), rank: 0 }; });
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1; });
  return rows;
}

const FULL = Array.from({ length: 52 }, (_, i) => i);
/** Share of the pot each player wins if nobody folds (ties split). Enumerates every run-out when ≤ 2 board cards are to come,
 *  otherwise samples n random run-outs. */
export function showdownOdds(holes: Record<number, Card[]>, board: Card[], n: number, rng: Rng) {
  const seats = Object.keys(holes).map(Number).filter((s) => holes[s]?.length === 2);
  const hs = seats.map((s) => holes[s].map(toInt)); const b = board.map(toInt);
  const used = new Set([...hs.flat(), ...b]); const deck = FULL.filter((c) => !used.has(c)); const need = 5 - b.length;
  const share = seats.map(() => 0); let k = 0;
  const score = (run: number[]) => {
    let best = -1; const v = hs.map((h) => { const x = evalInts([...h, ...b, ...run]); if (x > best) best = x; return x; });
    const w = v.filter((x) => x === best).length; v.forEach((x, i) => { if (x === best) share[i] += 1 / w; }); k++;
  };
  if (seats.length === 0) return { odds: {} as Record<number, number>, n: 0, exact: true };
  if (need === 0) score([]);
  else if (need === 1) for (const c of deck) score([c]);
  else if (need === 2) { for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) score([deck[i], deck[j]]); }
  else for (let t = 0; t < n; t++) { const d = deck.slice(); const run: number[] = []; for (let i = 0; i < need; i++) { const j = Math.floor(rng() * d.length); run.push(d[j]); d[j] = d[d.length - 1]; d.pop(); } score(run); }
  const odds: Record<number, number> = {}; seats.forEach((s, i) => { odds[s] = share[i] / k; });
  return { odds, n: k, exact: need <= 2 };
}
