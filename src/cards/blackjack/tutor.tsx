// Tutorial-mode tips for Blackjack: beginner rule of thumb -> basic strategy -> simulated odds,
// plus what the face-up cards (hole card, next card in the shoe) say actually happens.
import { handValue, ACTION_LABEL, cardValue, type Action } from "./strategy.ts";
import type { CoachResult } from "./coach.tsx";
import { RANK_LABEL, type Card } from "../core.ts";
import { LABEL } from "./coach.tsx";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const money = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}`;

export function bjTips(o: { cards: Card[]; up: Card; hole: Card | null; next: Card[]; basic: Action | null; coach: CoachResult; insurance: boolean }) {
  const { cards, up, hole, next, basic, coach } = o;
  const v = handValue(cards), u = cardValue(up);
  const weak = u >= 2 && u <= 6;
  const tips: { tier: string; text: string }[] = [];
  if (o.insurance) {
    tips.push({ tier: "Beginner", text: "Insurance is a side bet that the dealer has blackjack. It pays 2:1, but a ten is under the hole less than 1/3 of the time — almost always say no." });
    const ins = coach.raw.find((r) => r.action === "insure");
    tips.push({ tier: "Intermediate", text: `Basic strategy never takes insurance. Right now P(ten under the ace) ≈ ${ins ? pct(ins.win) : "31%"}, below the 33.3% break-even.` });
  } else {
    tips.push({ tier: "Beginner", text: v.total >= 17 && !v.soft ? `You have ${v.total} — stand; most cards would bust you.` : v.total <= 11 ? `You have ${v.total}: no card can bust you, so take another (or double on 10–11).` : weak ? `The dealer shows a weak ${RANK_LABEL(up[0])} (2–6) and has to draw to 17 — they bust often, so stand on 12+ hard and let them.` : `The dealer shows a strong ${RANK_LABEL(up[0])}: assume a 10 underneath (${10 + (u === 11 ? 1 : u)}), so keep drawing until you have 17+.` });
    if (basic) tips.push({ tier: "Intermediate", text: `Basic strategy for ${v.soft ? "soft " : ""}${v.total} vs ${RANK_LABEL(up[0])}: ${ACTION_LABEL[basic]}. It's the play with the best long-run return given only the cards a normal player sees.` });
  }
  const r = coach.raw;
  if (r.length) tips.push({ tier: "Expert", text: r.slice(0, 3).map((x) => `${LABEL[x.action]}: win ${pct(x.win)}, EV ${money(x.ev)}`).join(" · ") + ` (from ${coach.n.toLocaleString()} simulated hands each, ignoring the face-up cards below).` });
  if (hole) {
    const d = handValue([up, hole]).total;
    const nx = next[0]; const after = nx ? handValue([...cards, nx]) : null;
    tips.push({ tier: "Peek", text: `Face-up check: the dealer's hole card is ${RANK_LABEL(hole[0])} (dealer has ${d}).${nx && !o.insurance ? ` The next card is ${RANK_LABEL(nx[0])} — hitting would make ${after!.total > 21 ? "you bust" : after!.total}.` : ""} At a real table you can't see these, so judge your play by the odds above, not by this.` });
  }
  return tips;
}
