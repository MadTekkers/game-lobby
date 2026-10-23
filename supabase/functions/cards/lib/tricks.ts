// Shared helpers for the trick-taking games (Spades, Hearts). Pure TS, Deno-compatible.
import { type Card, type Rng, shuffle } from "./core.ts";

export const RV = (c: Card) => "23456789TJQKA".indexOf(c[0]);
export const SI: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };
const ORDER: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 }; // alternate colours in hand display
export const sortHand = (h: Card[]) => [...h].sort((a, b) => ORDER[a[1]] - ORDER[b[1]] || RV(b) - RV(a));
export const bySuit = (h: Card[], s: string) => h.filter((c) => c[1] === s);

/** Does `c` beat `best` in a trick led with `led` (trump may be null)? */
export function beats(c: Card, best: Card, trump: string | null) {
  if (c[1] === best[1]) return RV(c) > RV(best);
  return trump !== null && c[1] === trump;
}
/** Index (into the trick) of the winning card. */
export function trickWinner(cards: Card[], trump: string | null) {
  let w = 0;
  for (let i = 1; i < cards.length; i++) if (beats(cards[i], cards[w], trump)) w = i;
  return w;
}
/** Cards of `suit` not yet seen by the viewer (not played, not in own hand). */
export function unseenOfSuit(suit: string, seen: Set<Card>, deck: Card[]) { return deck.filter((c) => c[1] === suit && !seen.has(c)); }
/** Is `c` the highest remaining card of its suit given everything the viewer has seen? */
export function isBoss(c: Card, seen: Set<Card>, deck: Card[]) { return !deck.some((x) => x[1] === c[1] && RV(x) > RV(c) && !seen.has(x)); }

/** Group equivalent candidate cards: adjacent ranks of one suit with nothing unseen between them play the same. */
export function dedupeEquivalent(cands: Card[], seen: Set<Card>, deck: Card[]): Card[] {
  const out: Card[] = [];
  const sorted = [...cands].sort((a, b) => SI[a[1]] - SI[b[1]] || RV(a) - RV(b));
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev[1] === c[1] && !deck.some((x) => x[1] === c[1] && RV(x) > RV(prev) && RV(x) < RV(c) && !seen.has(x) && !cands.includes(x))) continue;
    out.push(c);
  }
  return out;
}

/**
 * Deal the unknown cards to the other seats consistent with what is known (hand sizes, suit voids).
 * sizes[i] = cards to give seat i (0 for the viewer); any leftover cards are dropped (unseen stock/discards).
 * Returns null if no consistent deal was found.
 */
export function sampleHands(unknown: Card[], sizes: number[], voids: boolean[][], rng: Rng, tries = 40): Card[][] | null {
  const need = sizes.reduce((a, b) => a + b, 0);
  for (let t = 0; t < tries; t++) {
    const pool = shuffle(unknown, rng);
    const hands: Card[][] = sizes.map(() => []);
    const room = [...sizes]; let spare = pool.length - need; let ok = true;
    // most-constrained cards first: cards whose suit few seats can hold
    const holders = (c: Card) => sizes.reduce((k, _, i) => k + (room[i] > 0 && !voids[i]?.[SI[c[1]]] ? 1 : 0), 0);
    pool.sort((a, b) => holders(a) - holders(b));
    for (const c of pool) {
      let tot = 0; for (let i = 0; i < sizes.length; i++) if (room[i] > 0 && !voids[i]?.[SI[c[1]]]) tot += room[i];
      if (spare > 0) tot += spare;
      if (tot === 0) { ok = false; break; }
      let r = rng() * tot; let placed = false;
      for (let i = 0; i < sizes.length; i++) {
        if (room[i] > 0 && !voids[i]?.[SI[c[1]]]) { r -= room[i]; if (r < 0) { hands[i].push(c); room[i]--; placed = true; break; } }
      }
      if (!placed) spare--; // goes to the unseen remainder
    }
    if (ok && room.every((x) => x === 0)) return hands;
  }
  return null;
}
/** Fallback that ignores voids (always succeeds). */
export function sampleHandsLoose(unknown: Card[], sizes: number[], rng: Rng): Card[][] {
  const pool = shuffle(unknown, rng); let k = 0;
  return sizes.map((n) => pool.slice(k, (k += n)));
}
