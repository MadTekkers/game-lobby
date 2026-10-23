// Basic strategy for 6 decks, dealer stands on all 17s, double after split allowed, no surrender.
import type { Card } from "../core.ts";

export type Action = "hit" | "stand" | "double" | "split";
export const cardValue = (c: Card) => { const r = c[0]; return r === "A" ? 11 : "TJQK".includes(r) ? 10 : +r; };
/** Ten-valued ranks count as equal for splitting. */
export const sameValue = (a: Card, b: Card) => cardValue(a) === cardValue(b);
export function handValue(cards: Card[]) {
  let total = 0, aces = 0;
  for (const c of cards) { const v = cardValue(c); total += v; if (v === 11) aces++; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
export const isBlackjack = (cards: Card[], fromSplit = false) => !fromSplit && cards.length === 2 && handValue(cards).total === 21;

/** up = dealer upcard value 2..11 (ace = 11). Returns the textbook play given what is allowed. */
export function basicStrategy(cards: Card[], dealerUp: Card, canDouble: boolean, canSplit: boolean): Action {
  const up = cardValue(dealerUp);
  const D = (alt: Action): Action => (canDouble ? "double" : alt);
  if (canSplit && cards.length === 2 && sameValue(cards[0], cards[1])) {
    const p = cardValue(cards[0]);
    const split =
      p === 11 || p === 8 ? true :
      p === 10 || p === 5 ? false :
      p === 9 ? [2, 3, 4, 5, 6, 8, 9].includes(up) :
      p === 7 ? up <= 7 :
      p === 6 ? up <= 6 :
      p === 4 ? up === 5 || up === 6 :
      /* 2,3 */ up <= 7;
    if (split) return "split";
  }
  const { total, soft } = handValue(cards);
  if (soft && cards.length >= 2) {
    if (total >= 20) return "stand";
    if (total === 19) return "stand";
    if (total === 18) return up >= 3 && up <= 6 ? D("stand") : up <= 8 ? "stand" : "hit";
    if (total === 17) return up >= 3 && up <= 6 ? D("hit") : "hit";
    if (total === 16 || total === 15) return up >= 4 && up <= 6 ? D("hit") : "hit";
    if (total === 14 || total === 13) return up >= 5 && up <= 6 ? D("hit") : "hit";
    return "hit";
  }
  if (total >= 17) return "stand";
  if (total >= 13) return up <= 6 ? "stand" : "hit";
  if (total === 12) return up >= 4 && up <= 6 ? "stand" : "hit";
  if (total === 11) return up <= 10 ? D("hit") : "hit";
  if (total === 10) return up <= 9 ? D("hit") : "hit";
  if (total === 9) return up >= 3 && up <= 6 ? D("hit") : "hit";
  return "hit";
}
export const ACTION_LABEL: Record<Action, string> = { hit: "Hit", stand: "Stand", double: "Double", split: "Split" };
