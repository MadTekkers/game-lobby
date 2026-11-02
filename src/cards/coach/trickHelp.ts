// Small helpers shared by the Spades and Hearts decision recorders.
import { RANK_LABEL, SUIT_SYMBOL, type Card } from "../core.ts";
import { RV } from "../tricks.ts";

export const cname = (c: Card) => `${RANK_LABEL(c[0])}${SUIT_SYMBOL[c[1]]}`;
export const pct = (x: number) => (x > 0 && x < 0.0095 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
export const SUIT_WORD: Record<string, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
/** The coach groups cards that play the same (7♣ and 6♣ when 5♣… nothing between them is still out). Map a chosen card onto its row's card. */
export function equivCard(rowCards: Card[], chosen: Card, gone: Set<Card>, deck: Card[]): Card | null {
  if (rowCards.includes(chosen)) return chosen;
  for (const r of rowCards) {
    if (r[1] !== chosen[1]) continue;
    const lo = Math.min(RV(r), RV(chosen)), hi = Math.max(RV(r), RV(chosen));
    if (deck.every((c) => c[1] !== r[1] || RV(c) <= lo || RV(c) >= hi || gone.has(c))) return r;
  }
  return null;
}
/** "Trick 4 — K♥ 9♥ played so far; you had to follow hearts." */
export function trickLine(trickNo: number, trick: Card[], legal: Card[]) {
  if (!trick.length) return `Trick ${trickNo} — you were leading.`;
  const led = trick[0][1]; const follow = legal.every((c) => c[1] === led);
  return `Trick ${trickNo} — ${trick.map(cname).join(" ")} played so far; ${follow ? `you had to follow ${SUIT_WORD[led]}` : `you had no ${SUIT_WORD[led]}, so anything went`}.`;
}
