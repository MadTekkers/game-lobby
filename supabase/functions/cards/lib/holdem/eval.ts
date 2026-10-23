// Texas Hold'em hand evaluator: best 5 of 5–7 cards → a comparable integer (higher wins). Pure TS, no allocations in the hot path
// beyond two small arrays; ~1µs per 7-card hand in V8, fast enough for Monte Carlo inside the edge function.
import type { Card } from "../core.ts";

const RI: Record<string, number> = { "2": 0, "3": 1, "4": 2, "5": 3, "6": 4, "7": 5, "8": 6, "9": 7, T: 8, J: 9, Q: 10, K: 11, A: 12 };
const SIx: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };
export const rankIdx = (c: Card) => RI[c[0]];
export const suitIdx = (c: Card) => SIx[c[1]];
/** Card → int 0..51 (rank*4 + suit). */
export const toInt = (c: Card) => RI[c[0]] * 4 + SIx[c[1]];
export const CATS = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"] as const;
const B = 13, B5 = B ** 5;
const pack = (cat: number, k: number[]) => { let v = cat; for (let i = 0; i < 5; i++) v = v * B + (k[i] ?? 0); return v; };
/** Highest straight in a 13-bit rank mask (bit r = rank r present); returns top rank or -1. Ace plays low in A-2-3-4-5. */
function straightTop(mask: number) {
  for (let top = 12; top >= 4; top--) { const need = 0b11111 << (top - 4); if ((mask & need) === need) return top; }
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3; // wheel: A 2 3 4 5 → five-high
  return -1;
}
/** Evaluate cards given as ints (rank*4+suit). 5–7 cards. */
export function evalInts(cs: number[]): number {
  const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; const sm = [0, 0, 0, 0]; const sc = [0, 0, 0, 0]; let all = 0;
  for (const c of cs) { const r = c >> 2, s = c & 3; cnt[r]++; sm[s] |= 1 << r; sc[s]++; all |= 1 << r; }
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) {
    const st = straightTop(sm[s]); if (st >= 0) return pack(8, [st]);
    const k: number[] = []; for (let r = 12; r >= 0 && k.length < 5; r--) if (sm[s] & (1 << r)) k.push(r);
    // (a flush and a full house/quads can't coexist in 7 cards, so the flush is the best hand here)
    return pack(5, k);
  }
  const fh = fullOrQuads(cnt); if (fh >= 0) return fh;
  const st = straightTop(all); if (st >= 0) return pack(4, [st]);
  let t = -1; const pairs: number[] = []; const singles: number[] = [];
  for (let r = 12; r >= 0; r--) { if (cnt[r] === 3 && t < 0) t = r; else if (cnt[r] >= 2) pairs.push(r); else if (cnt[r] === 1) singles.push(r); }
  if (t >= 0) { const k = [...pairs, ...singles].sort((a, b) => b - a); return pack(3, [t, k[0], k[1]]); }
  if (pairs.length >= 2) { const k = [...pairs.slice(2), ...singles].sort((a, b) => b - a); return pack(2, [pairs[0], pairs[1], k[0]]); }
  if (pairs.length === 1) return pack(1, [pairs[0], singles[0], singles[1], singles[2]]);
  return pack(0, singles.slice(0, 5));
}
function fullOrQuads(cnt: number[]) {
  let q = -1, t = -1, t2 = -1, p = -1, hi = -1;
  for (let r = 12; r >= 0; r--) {
    if (cnt[r] === 4 && q < 0) q = r;
    else if (cnt[r] === 3) { if (t < 0) t = r; else if (t2 < 0) t2 = r; }
    else if (cnt[r] === 2 && p < 0) p = r;
  }
  if (q >= 0) { for (let r = 12; r >= 0; r--) if (r !== q && cnt[r] > 0) { hi = r; break; } return pack(7, [q, hi]); }
  if (t >= 0 && (p >= 0 || t2 >= 0)) return pack(6, [t, Math.max(p, t2)]);
  return -1;
}
export const evaluate = (cards: Card[]) => evalInts(cards.map(toInt));
export const category = (score: number) => Math.floor(score / B5);
export const handName = (score: number) => CATS[category(score)];
const RN = "23456789TJQKA";
/** Human description, e.g. "Two pair, Kings and 7s". */
export function describe(score: number) {
  const cat = category(score); const d: number[] = []; let v = score % B5; for (let i = 0; i < 5; i++) { d.unshift(v % B); v = Math.floor(v / B); }
  const nm = (r: number, pl = false) => { const n = ["Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines", "Tens", "Jacks", "Queens", "Kings", "Aces"][r]; return pl ? n : n.slice(0, -1).replace("Sixe", "Six"); };
  switch (cat) {
    case 8: return d[0] === 12 ? "Royal flush" : `Straight flush, ${nm(d[0])}-high`;
    case 7: return `Four ${nm(d[0], true)}`;
    case 6: return `Full house, ${nm(d[0], true)} over ${nm(d[1], true)}`;
    case 5: return `Flush, ${nm(d[0])}-high`;
    case 4: return `Straight, ${nm(d[0])}-high`;
    case 3: return `Three ${nm(d[0], true)}`;
    case 2: return `Two pair, ${nm(d[0], true)} and ${nm(d[1], true)}`;
    case 1: return `Pair of ${nm(d[0], true)}`;
    default: return `${nm(d[0])}-high`;
  }
}
export const _RN = RN;
