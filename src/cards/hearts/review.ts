// Hearts decisions (passes and cards) for hand review + mistake drills, scored with the same Monte Carlo as the Train comparison cards.
import { seededRng, type Card } from "../core.ts";
import { sortHand } from "../tricks.ts";
import * as Sim from "./sim.ts";
import { evalPlay, evalPass, passCandidates, knownHs, type View, type PlayRow, type PassRow, type Given } from "./coach.ts";
import { classify, newId, type Decision } from "../coach/record.ts";
import { cname, equivCard, pct, trickLine } from "../coach/trickHelp.ts";

const rng = () => seededRng((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
export const passKey = (c: Card[]) => [...c].sort().join(",");
const passText = (c: Card[]) => [...c].map(cname).join(" ");
type Ctx = { hand: string; handLabel: string };
const compact = (kind: string, p: View | null, seat: number, hand: Card[], extra: Record<string, unknown> = {}) => ({ kind, seat, hand, ...(p ? { v: p.v, trick: p.trick, trickSeats: p.trickSeats, broken: p.broken, pts: p.pts, played: p.history.flatMap((h) => h.cards) } : {}), ...extra });

export type HePlayEval = { kind: "play"; rows: PlayRow[]; p: View; seat: number; hand: Card[] };
export type HePassEval = { kind: "pass"; rows: PassRow[]; v: Sim.Variant; n: number; seat: number; hand: Card[]; off: number };
export const hePlayEval = (p: View, seat: number, hand: Card[], given: Given, n = 120): HePlayEval => ({ kind: "play", rows: evalPlay(p, seat, hand, { n, rng: rng(), given }), p, seat, hand });
export function hePassEval(v: Sim.Variant, n: number, seat: number, hand: Card[], off: number, mine?: Card[], N = 120): HePassEval {
  const R = rng(); return { kind: "pass", rows: evalPass(v, n, seat, hand, off, passCandidates(hand, R, mine), { n: N, rng: R }), v, n, seat, hand, off };
}
export const hasPass = (e: HePassEval, cards: Card[]) => e.rows.some((r) => passKey(r.cards) === passKey(cards));

function playWhy(b: PlayRow, p: View) {
  const pts = p.trick.reduce((a, c) => a + Sim.cardPts(c), 0);
  if (b.trick < 0.03) return `${cname(b.card)} ducks under this trick, so someone else collects whatever points are in it.`;
  if (b.trick > 0.97) return pts ? `Every card you hold wins this trick, so ${cname(b.card)} gets it over with as cheaply as possible.` : `${cname(b.card)} takes a trick with no points in it — a safe way to get rid of a high card.`;
  return `${cname(b.card)} leaves you with the fewest points on average (${b.pts.toFixed(1)}) and keeps the Q♠ away from you.`;
}
function playDiff(b: PlayRow, m: PlayRow) {
  if (m.qs - b.qs >= 0.04) return ` Your ${cname(m.card)} makes you more likely to get stuck with the Q♠ (${pct(m.qs)} vs ${pct(b.qs)}).`;
  if (m.trick - b.trick >= 0.2) return ` Your ${cname(m.card)} wins this trick more often (${pct(m.trick)}), and with it the points.`;
  return ` Your ${cname(m.card)} costs about ${(b.ev - m.ev).toFixed(1)} points on average.`;
}
export function hePlayDecision(e: HePlayEval, chosen: Card, c: Ctx, caught?: Card): Decision {
  const { p, seat, hand, rows } = e; const deck = Sim.deckFor(p.v);
  const gone = new Set<Card>([...hand, ...p.history.flatMap((x) => x.cards), ...p.trick]);
  const key = equivCard(rows.map((r) => r.card), chosen, gone, deck) ?? chosen;
  const cl = classify(rows.map((r) => ({ key: r.card, label: cname(r.card), ev: r.ev, seGap: r.seGap })), key, 0.6);
  const best = rows.find((r) => r.card === cl.best.key)!; const mine = rows.find((r) => r.card === key);
  const legal = Sim.legal(knownHs(p, seat, hand), seat);
  const tl = trickLine(p.history.length + 1, p.trick, legal);
  const score = `You had ${p.pts[seat]} point${p.pts[seat] === 1 ? "" : "s"} this hand so far.`;
  return { id: newId(), game: "hearts", hand: c.hand, handLabel: c.handLabel, at: Date.now(), step: `Trick ${p.history.length + 1}`,
    situation: `${tl} ${score}`, chosen: { key: chosen, label: cname(chosen) }, best: { key: best.card, label: cname(best.card) }, verdict: cl.verdict,
    why: playWhy(best, p) + (cl.verdict === "mistake" && mine ? playDiff(best, mine) : ""),
    cost: cl.verdict === "best" ? "" : `About ${Math.max(0.1, cl.gap).toFixed(1)} points worse on average${cl.verdict === "close" ? " — close enough" : ""}.`,
    sig: `he|play|${sortHand(hand).join("")}|${p.trick.join("")}|${p.history.length}`,
    spot: { prompt: p.trick.length ? "Which card do you play?" : "You're leading. Which card do you play?", groups: [...(p.trick.length ? [{ label: "On the table", cards: p.trick }] : []), { label: "Your hand", cards: sortHand(hand) }],
      facts: [tl, score, p.broken ? "Hearts have been played (broken)." : "No hearts played yet — you can't lead one unless that's all you have."],
      options: rows.map((r) => ({ key: r.card, label: cname(r.card) })), ok: cl.ok, best: best.card, why: playWhy(best, p), state: compact("play", p, seat, hand) },
    caught: caught ? { key: caught, label: cname(caught) } : undefined };
}
function passWhy(b: PassRow) {
  const c = b.cards;
  const what = c.includes("QS") ? "gets rid of the Q♠ (the 13-point card)" : c.some((x) => x === "AS" || x === "KS") ? "sheds a high spade that could be forced to catch the Q♠" : c.every((x) => x[1] === c[0][1]) ? "empties a suit, so you can throw away points when it's led" : "dumps high cards that would win point-heavy tricks";
  return `Passing ${passText(c)} ${what}. It leaves you the fewest points on average (${b.pts.toFixed(1)}).`;
}
export function hePassDecision(e: HePassEval, chosen: Card[], c: Ctx, caught?: Card[]): Decision {
  const { rows, hand, seat, off, n } = e;
  const cl = classify(rows.map((r) => ({ key: passKey(r.cards), label: passText(r.cards), ev: r.ev, seGap: r.seGap })), passKey(chosen), 0.6);
  const best = rows.find((r) => passKey(r.cards) === cl.best.key)!; const mine = rows.find((r) => passKey(r.cards) === passKey(chosen));
  const dir = Sim.passName(n, off);
  let why = passWhy(best);
  if (cl.verdict === "mistake" && mine) why += mine.qs - best.qs >= 0.04 ? ` Your pass leaves you more likely to end up with the Q♠ (${pct(mine.qs)} vs ${pct(best.qs)}).` : ` Your pass costs about ${(best.ev - mine.ev).toFixed(1)} points on average.`;
  return { id: newId(), game: "hearts", hand: c.hand, handLabel: c.handLabel, at: Date.now(), step: "Pass",
    situation: `Passing three cards ${dir === "across" ? "across" : `to the ${dir}`}.`, chosen: { key: passKey(chosen), label: passText(chosen) }, best: { key: passKey(best.cards), label: passText(best.cards) },
    verdict: cl.verdict, why, cost: cl.verdict === "best" ? "" : `About ${Math.max(0.1, cl.gap).toFixed(1)} points worse on average${cl.verdict === "close" ? " — close enough" : ""}.`,
    sig: `he|pass|${sortHand(hand).join("")}|${off}`,
    spot: { prompt: `Which three cards do you pass ${dir === "across" ? "across" : `to the ${dir}`}?`, groups: [{ label: "Your hand", cards: sortHand(hand) }], facts: [],
      options: rows.map((r) => ({ key: passKey(r.cards), label: passText(r.cards) })), ok: cl.ok, best: passKey(best.cards), why: passWhy(best), state: compact("pass", null, seat, hand, { off, n }) },
    caught: caught ? { key: passKey(caught), label: passText(caught) } : undefined };
}
/** Guided-mode suggestion for the current decision. */
export function heHint(e: HePlayEval | HePassEval): { key: string; label: string; why: string } {
  if (e.kind === "play") { const b = e.rows[0]; return { key: b.card, label: cname(b.card), why: playWhy(b, e.p) }; }
  const b = e.rows[0]; return { key: passKey(b.cards), label: passText(b.cards), why: passWhy(b) };
}
