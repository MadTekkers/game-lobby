// Hi-Lo card counting for the Blackjack trainer: running count, true count, bet spread and the
// "Illustrious 18" index plays (Don Schlesinger, Blackjack Attack). See docs/strategy/blackjack.md.
import type { Card } from "../core.ts";
import { cardValue, handValue, type Action } from "./strategy.ts";
import { hiLoTag } from "./engine.ts";
export { hiLoTag };

/** Running count = finished rounds of this shoe (server tally, public) + every card face up on the table right now. */
export function runningCount(pub: { rcPrev?: number; seats: { hands: { cards: Card[] }[] }[]; dealer: (Card | null)[] }) {
  const visible = [...pub.seats.flatMap((s) => s.hands.flatMap((h) => h.cards)), ...(pub.dealer.filter(Boolean) as Card[])];
  return { rc: (pub.rcPrev ?? 0) + visible.reduce((a, c) => a + hiLoTag(c), 0), visible };
}
/** Decks still in the shoe (to the nearest half deck, as players estimate from the discard tray), min half a deck. */
export const decksLeft = (shoeLeft: number) => Math.max(0.5, Math.round((shoeLeft / 52) * 2) / 2);
/** True count = running count ÷ decks remaining, truncated toward zero (the common convention for index plays). */
export const trueCount = (rc: number, shoeLeft: number) => Math.trunc(rc / decksLeft(shoeLeft));
export const trueCountExact = (rc: number, shoeLeft: number) => rc / decksLeft(shoeLeft);
/** A conservative 1-8 spread for a 6-deck S17 game. */
export function betUnits(tc: number) { return tc <= 1 ? 1 : tc === 2 ? 2 : tc === 3 ? 4 : tc === 4 ? 6 : 8; }

/** The Illustrious 18 (6-deck, S17 numbers). "ge" = make the play at true count >= at; "le" = at or below. */
export const ILLUSTRIOUS_18: { label: string; tot: number | "TT"; up: number; at: number; dir: "ge" | "le"; play: Action | "insure"; base: string }[] = [
  { label: "Insurance", tot: 0, up: 11, at: 3, dir: "ge", play: "insure", base: "never insure" },
  { label: "16 vs 10", tot: 16, up: 10, at: 0, dir: "ge", play: "stand", base: "hit" },
  { label: "15 vs 10", tot: 15, up: 10, at: 4, dir: "ge", play: "stand", base: "hit" },
  { label: "10,10 vs 5", tot: "TT", up: 5, at: 5, dir: "ge", play: "split", base: "stand" },
  { label: "10,10 vs 6", tot: "TT", up: 6, at: 4, dir: "ge", play: "split", base: "stand" },
  { label: "10 vs 10", tot: 10, up: 10, at: 4, dir: "ge", play: "double", base: "hit" },
  { label: "12 vs 3", tot: 12, up: 3, at: 2, dir: "ge", play: "stand", base: "hit" },
  { label: "12 vs 2", tot: 12, up: 2, at: 3, dir: "ge", play: "stand", base: "hit" },
  { label: "11 vs A", tot: 11, up: 11, at: 1, dir: "ge", play: "double", base: "hit (S17)" },
  { label: "9 vs 2", tot: 9, up: 2, at: 1, dir: "ge", play: "double", base: "hit" },
  { label: "10 vs A", tot: 10, up: 11, at: 4, dir: "ge", play: "double", base: "hit" },
  { label: "9 vs 7", tot: 9, up: 7, at: 3, dir: "ge", play: "double", base: "hit" },
  { label: "16 vs 9", tot: 16, up: 9, at: 5, dir: "ge", play: "stand", base: "hit" },
  { label: "13 vs 2", tot: 13, up: 2, at: -1, dir: "le", play: "hit", base: "stand" },
  { label: "12 vs 4", tot: 12, up: 4, at: 0, dir: "le", play: "hit", base: "stand" },
  { label: "12 vs 5", tot: 12, up: 5, at: -2, dir: "le", play: "hit", base: "stand" },
  { label: "12 vs 6", tot: 12, up: 6, at: -1, dir: "le", play: "hit", base: "stand" },
  { label: "13 vs 3", tot: 13, up: 3, at: -2, dir: "le", play: "hit", base: "stand" },
];
/** The index play that applies to this hand (if any) and whether the current true count triggers it. */
export function indexPlay(cards: Card[], upCard: Card, tc: number, insurancePhase = false) {
  const up = cardValue(upCard); const v = handValue(cards);
  const pairT = cards.length === 2 && cardValue(cards[0]) === 10 && cardValue(cards[1]) === 10;
  const row = ILLUSTRIOUS_18.find((r) => r.up === up && (insurancePhase ? r.play === "insure" : r.play !== "insure" && (r.tot === "TT" ? pairT : !v.soft && r.tot === v.total && !(pairT && r.tot === 20) && (r.play !== "double" || cards.length === 2))));
  if (!row) return null;
  const on = row.dir === "ge" ? tc >= row.at : tc <= row.at;
  return { ...row, on };
}
