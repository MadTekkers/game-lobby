// Spades decisions (bids and cards) for hand review + mistake drills, scored with the same Monte Carlo as the Train comparison cards.
import { seededRng, type Card } from "../core.ts";
import { sortHand } from "../tricks.ts";
import * as Sim from "./sim.ts";
import { evalPlay, evalBid, knownHs, type View, type PlayRow, type BidRow } from "./coach.ts";
import { classify, newId, type Decision } from "../coach/record.ts";
import { cname, equivCard, pct, trickLine } from "../coach/trickHelp.ts";

const rng = () => seededRng((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
export const spBidLabel = (b: { bid: number; nil: number }) => (b.nil === 2 ? "Blind nil" : b.nil ? "Nil" : `Bid ${b.bid}`);
export const spBidKey = (b: { bid: number; nil: number }) => (b.nil === 2 ? "blind" : b.nil ? "nil" : String(b.bid));
type Ctx = { hand: string; handLabel: string };
/** Enough to rebuild the spot later (no other player's hidden cards — those were never known). */
const compact = (kind: string, p: View, seat: number, hand: Card[]) => ({ kind, v: p.v, seat, hand, trick: p.trick, trickSeats: p.trickSeats, bids: p.bids, nil: p.nil, tricks: p.tricks, broken: p.broken, played: p.history.flatMap((h) => h.cards) });

function standing(p: View, seat: number) {
  const t = Sim.teamOf(p.v, seat); const mates = p.bids.map((_, i) => i).filter((i) => Sim.teamOf(p.v, i) === t && !p.nil[i]);
  const bid = mates.reduce((a, i) => a + (p.bids[i] ?? 0), 0), took = mates.reduce((a, i) => a + p.tricks[i], 0);
  return `${p.v === "partners" ? "Your side" : "You"} bid ${bid} and had taken ${took}.${p.nil[seat] ? " You bid nil." : ""}`;
}
export type SpPlayEval = { kind: "play"; rows: PlayRow[]; p: View; seat: number; hand: Card[]; deck: Card[] };
export type SpBidEval = { kind: "bid"; rows: BidRow[]; p: View; seat: number; hand: Card[] };
export const spPlayEval = (p: View, seat: number, hand: Card[], deck: Card[], n = 120): SpPlayEval => ({ kind: "play", rows: evalPlay(p, seat, hand, { n, rng: rng(), deck }), p, seat, hand, deck });
export const spBidEval = (p: View, seat: number, hand: Card[], deck: Card[], n = 160): SpBidEval => ({ kind: "bid", rows: evalBid(p, seat, hand, { n, rng: rng(), deck }), p, seat, hand });

function playWhy(b: PlayRow, p: View, seat: number) {
  if (b.trick > 0.97) return `${cname(b.card)} wins this trick for sure${p.nil[seat] ? "" : ", and that trick counts toward your bid"}.`;
  if (b.trick < 0.03) return `${cname(b.card)} stays under this trick${p.nil[seat] ? " — exactly what a nil needs" : " and saves your stronger cards for later"}.`;
  return `${cname(b.card)} gives ${p.v === "partners" ? "your side" : "you"} the best chance to make the bid (${pct(b.make)}) without piling up extra tricks (bags).`;
}
function playDiff(b: PlayRow, m: PlayRow) {
  if (b.make - m.make >= 0.03) return ` Your ${cname(m.card)} makes the bid less often (${pct(m.make)} vs ${pct(b.make)}).`;
  if (m.bags - b.bags >= 0.3) return ` Your ${cname(m.card)} tends to collect extra tricks you didn't bid for (bags).`;
  if (b.set - m.set >= 0.03) return ` Your ${cname(m.card)} lets the other side make their bid more often.`;
  return ` Your ${cname(m.card)} scores a little less on average.`;
}
export function spPlayDecision(e: SpPlayEval, chosen: Card, c: Ctx, caught?: Card): Decision {
  const { p, seat, hand, deck, rows } = e;
  const gone = new Set<Card>([...hand, ...p.history.flatMap((x) => x.cards), ...p.trick, ...Sim.deckFor(p.v).filter((x) => !deck.includes(x))]);
  const key = equivCard(rows.map((r) => r.card), chosen, gone, Sim.deckFor(p.v)) ?? chosen;
  const cl = classify(rows.map((r) => ({ key: r.card, label: cname(r.card), ev: r.ev, seGap: r.seGap })), key, 2);
  const best = rows.find((r) => r.card === cl.best.key)!; const mine = rows.find((r) => r.card === key);
  const legal = Sim.legal(knownHs(p, seat, hand), seat);
  const why = playWhy(best, p, seat) + (cl.verdict === "mistake" && mine ? playDiff(best, mine) : "");
  const tl = trickLine(p.history.length + 1, p.trick, legal);
  return { id: newId(), game: "spades", hand: c.hand, handLabel: c.handLabel, at: Date.now(), step: `Trick ${p.history.length + 1}`,
    situation: `${tl} ${standing(p, seat)}`, chosen: { key: chosen, label: cname(chosen) }, best: { key: best.card, label: cname(best.card) }, verdict: cl.verdict, why,
    cost: cl.verdict === "best" ? "" : `About ${Math.max(0.1, cl.gap).toFixed(1)} points worse on average${cl.verdict === "close" ? " — close enough" : ""}.`,
    sig: `sp|play|${sortHand(hand).join("")}|${p.trick.join("")}|${p.history.length}`,
    spot: { prompt: p.trick.length ? "Which card do you play?" : "You're leading. Which card do you play?", groups: [...(p.trick.length ? [{ label: "On the table", cards: p.trick }] : []), { label: "Your hand", cards: sortHand(hand) }],
      facts: [tl, standing(p, seat), p.broken ? "Spades have been played (broken)." : "Spades haven't been played yet — you can't lead one unless that's all you have."],
      options: rows.map((r) => ({ key: r.card, label: cname(r.card) })), ok: cl.ok, best: best.card, why: playWhy(best, p, seat), state: compact("play", p, seat, hand) },
    caught: caught ? { key: caught, label: cname(caught) } : undefined };
}
function bidWhy(b: BidRow) {
  if (b.nil) return `${spBidLabel(b)} works about ${pct(b.nilOk ?? 0)} of the time with these cards — and it's worth ${b.nil === 2 ? 200 : 100} points.`;
  return `This hand usually takes about ${b.tricks.toFixed(1)} tricks, so ${b.bid} is the sweet spot: you make it ${pct(b.make)} of the time without too many extra tricks (bags).`;
}
export function spBidDecision(e: SpBidEval, chosen: { bid: number; nil: number }, c: Ctx, caught?: { bid: number; nil: number }): Decision {
  const { p, seat, hand, rows } = e;
  const cl = classify(rows.map((r) => ({ key: spBidKey(r), label: spBidLabel(r), ev: r.ev, seGap: r.seGap })), spBidKey(chosen), 3);
  const best = rows.find((r) => spBidKey(r) === cl.best.key)!; const mine = rows.find((r) => spBidKey(r) === spBidKey(chosen));
  let why = bidWhy(best);
  if (cl.verdict === "mistake") why += !mine ? ` ${spBidLabel(chosen)} is far from what this hand can take.` : mine.nil ? ` Nil only works ${pct(mine.nilOk ?? 0)} of the time here.` : mine.bid > best.bid ? ` ${spBidLabel(mine)} only makes it ${pct(mine.make)} of the time.` : ` ${spBidLabel(mine)} leaves tricks on the table that turn into bags.`;
  const pt = Sim.partnerOf(p.v, seat); const ptLine = pt >= 0 && p.bids[pt] !== null ? ` Your partner bid ${p.nil[pt] ? "nil" : p.bids[pt]}.` : "";
  const sp = hand.filter((x) => x[1] === "S").length;
  return { id: newId(), game: "spades", hand: c.hand, handLabel: c.handLabel, at: Date.now(), step: "Bid",
    situation: `Bidding with ${sp} spade${sp === 1 ? "" : "s"}${hand.some((x) => x[0] === "A") ? ` and ${hand.filter((x) => x[0] === "A").length} ace(s)` : ""}.${ptLine}`,
    chosen: { key: spBidKey(chosen), label: spBidLabel(chosen) }, best: { key: spBidKey(best), label: spBidLabel(best) }, verdict: mine ? cl.verdict : "mistake", why,
    cost: cl.verdict === "best" && mine ? "" : mine ? `About ${Math.max(0.1, cl.gap).toFixed(1)} points worse on average${cl.verdict === "close" ? " — close enough" : ""}.` : "Well outside the coach's range.",
    sig: `sp|bid|${sortHand(hand).join("")}`,
    spot: { prompt: "How many tricks do you bid?", groups: [{ label: "Your hand", cards: sortHand(hand) }], facts: [`${p.v === "partners" ? "Partnership" : p.v === "cutthroat" ? "Cutthroat" : "Two-hand"} Spades.${ptLine}`],
      options: rows.map((r) => ({ key: spBidKey(r), label: spBidLabel(r) })).sort((a, b) => (a.key === "nil" ? -1 : b.key === "nil" ? 1 : +a.key - +b.key)), ok: cl.ok, best: spBidKey(best), why: bidWhy(best), state: compact("bid", p, seat, hand) },
    caught: caught ? { key: spBidKey(caught), label: spBidLabel(caught) } : undefined };
}
/** Guided-mode suggestion for the current decision. */
export function spHint(e: SpPlayEval | SpBidEval): { key: string; label: string; why: string } {
  if (e.kind === "play") { const b = e.rows[0]; return { key: b.card, label: cname(b.card), why: playWhy(b, e.p, e.seat) }; }
  const b = e.rows[0]; return { key: spBidKey(b), label: spBidLabel(b), why: bidWhy(b) };
}
