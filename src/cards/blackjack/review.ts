// Blackjack decisions for hand review + mistake drills, scored by the same Monte Carlo evaluator as the Train comparison cards.
import { seededRng, RANK_LABEL, SUIT_SYMBOL, type Card, type Rng } from "../core.ts";
import { evaluate, type EvalInput, type Row } from "./sim.ts";
import { ACTION_LABEL, cardValue, handValue, sameValue } from "./strategy.ts";
import { classify, newId, type Decision, type Spot } from "../coach/record.ts";

export const BJ_LABEL: Record<Row["action"], string> = { ...ACTION_LABEL, insure: "Take insurance", noinsure: "No insurance" };
const pct = (x: number) => (x > 0 && x < 0.0095 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
const cents = (x: number) => `${Math.max(1, Math.round(x * 100))}¢`;
const nm = (c: Card) => `${RANK_LABEL(c[0])}${SUIT_SYMBOL[c[1]]}`;
const upName = (c: Card) => (c[0] === "A" ? "an ace" : c[0] === "8" ? "an 8" : `a ${RANK_LABEL(cardValue(c) === 10 ? "T" : c[0])}`);
export type BjInput = Omit<EvalInput, "rng" | "n">;
/** Monte Carlo rows for this decision (fewer trials than the Train card: it runs in the background for every decision). */
export function bjRows(input: BjInput, n = 8000, rng: Rng = seededRng((Date.now() ^ 0x5bd1e995) >>> 0)): Row[] { return evaluate({ ...input, n, rng }); }

export function handName(cards: Card[]) {
  const v = handValue(cards);
  if (cards.length === 2 && sameValue(cards[0], cards[1])) return `a pair of ${cards[0][0] === "A" ? "aces" : `${RANK_LABEL(cardValue(cards[0]) === 10 ? "T" : cards[0][0])}s`}`;
  return v.soft && v.total < 21 ? `soft ${v.total}` : `${v.total}`;
}
/** One or two plain sentences on why the best play is best. */
export function bjWhy(best: Row, rows: Row[], input: BjInput): string {
  const up = upName(input.dealerUp); const total = handValue(input.cards).total; const stand = rows.find((r) => r.action === "stand");
  switch (best.action) {
    case "stand": return `With ${up} showing, the dealer busts about ${pct(best.dealerBust)} of the time — let them take the risk instead of drawing to your ${total}.`;
    case "hit": return stand ? `${total} rarely wins as it stands against ${up} (only ${pct(stand.win)} of the time), so taking a card is worth the ${pct(best.bustNext)} chance of busting.` : `Taking another card gives you the best chance to beat ${up}.`;
    case "double": return `One more card turns this into 18–21 about ${pct(best.strong)} of the time, and ${up} is a weak dealer card — so it pays to double your bet.`;
    case "split": return `Two fresh hands starting with a ${RANK_LABEL(input.cards[0][0])} each do better than one hand of ${total} against ${up}.`;
    case "noinsure": return `Insurance only pays when the dealer's face-down card is a 10. That happens about ${pct(best.strong)} of the time — less than the 1 in 3 it needs to break even.`;
    case "insure": return `So many 10s are left in the shoe (${pct(best.win)} chance one is face-down) that this side bet actually pays off on average.`;
  }
}
export function bjSig(input: BjInput, legal: string[]) {
  if (input.insurancePhase) return "bj|insurance";
  const v = handValue(input.cards); const pair = input.cards.length === 2 && sameValue(input.cards[0], input.cards[1]) && legal.includes("split");
  return `bj|${pair ? `pair${cardValue(input.cards[0])}` : `${v.soft ? "soft" : "hard"}${v.total}`}|${cardValue(input.dealerUp)}|${legal.includes("double") ? "d" : ""}`;
}
export function bjDecision(o: { input: BjInput; rows: Row[]; chosen: Row["action"]; hand: string; handLabel: string; step: string; caught?: Row["action"] }): Decision {
  const { input, rows } = o;
  const c = classify(rows.map((r) => ({ key: r.action, label: BJ_LABEL[r.action], ev: r.ev, se: r.se })), o.chosen, input.insurancePhase ? 0.005 : 0.02);
  const best = rows.find((r) => r.action === c.best.key)!;
  const legal = rows.map((r) => r.action);
  const total = handName(input.cards);
  const situation = input.insurancePhase
    ? `The dealer showed an ace and offered insurance. You had ${total} (${input.cards.map(nm).join(" ")}).`
    : `You had ${total} (${input.cards.map(nm).join(" ")}) against the dealer's ${nm(input.dealerUp)}.`;
  const why = bjWhy(best, rows, input);
  const cost = c.verdict === "best" ? "" : `${c.verdict === "close" ? "Nearly as good — " : ""}costs about ${cents(c.gap)} per $1 bet on average.`;
  const spot: Spot = {
    prompt: input.insurancePhase ? "Dealer shows an ace. Take insurance?" : `You have ${total}. Dealer shows ${nm(input.dealerUp)}. What's your move?`,
    groups: [{ label: "Dealer shows", cards: [input.dealerUp] }, { label: "Your cards", cards: input.cards }],
    facts: [], options: legal.map((k) => ({ key: k, label: BJ_LABEL[k] })), ok: c.ok, best: c.best.key, why,
    state: { cards: input.cards, up: input.dealerUp, legal, insurance: !!input.insurancePhase },
  };
  return { id: newId(), game: "blackjack", hand: o.hand, handLabel: o.handLabel, at: Date.now(), step: o.step, situation,
    chosen: { key: o.chosen, label: BJ_LABEL[o.chosen] }, best: { key: c.best.key, label: c.best.label }, verdict: c.verdict, why, cost,
    sig: bjSig(input, legal), spot, caught: o.caught ? { key: o.caught, label: BJ_LABEL[o.caught] } : undefined };
}
/** A close variant of a stored spot: a different two-card hand with the same total (hard, non-pair, no ace) against the same dealer card. */
export function bjVariant(spot: Spot, rng: Rng): Spot {
  const st = spot.state as { cards: Card[]; up: Card; legal: string[]; insurance: boolean } | undefined;
  if (!st || st.insurance || st.cards.length !== 2 || sameValue(st.cards[0], st.cards[1]) || st.cards.some((c) => c[0] === "A")) return spot;
  const total = handValue(st.cards).total; const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];
  const pairs: [string, string][] = [];
  for (const a of ranks) for (const b of ranks) { const va = cardValue(a + "S"), vb = cardValue(b + "S"); if (va < vb && va + vb === total) pairs.push([a, b]); }
  if (!pairs.length) return spot;
  const [a, b] = pairs[Math.floor(rng() * pairs.length)]; const s = () => "SHDC"[Math.floor(rng() * 4)];
  const cards = rng() < 0.5 ? [a + s(), b + s()] : [b + s(), a + s()];
  const swap = (g: { label: string; cards: Card[] }) => (g.label === "Your cards" ? { ...g, cards } : g);
  return { ...spot, groups: spot.groups.map(swap), state: { ...st, cards } };
}
