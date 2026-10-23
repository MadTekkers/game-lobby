// Hearts coach: Monte Carlo over the hidden cards. Worlds are consistent with everything this seat knows (its hand, the play so far,
// voids shown, and the three cards it passed — those sit in the receiver's hand until played). Every candidate is scored on the SAME
// worlds (common random numbers); the rest of the hand is rolled out with the medium heuristic for every seat. Nothing is hardcoded.
import { type Card, type Rng, shuffle } from "../core.ts";
import { SI, dedupeEquivalent, RV, bySuit } from "../tricks.ts";
import * as Sim from "./sim.ts";

export type View = { v: Sim.Variant; n: number; trick: Card[]; trickSeats: number[]; leader: number; broken: boolean; pts: number[]; qs: number; counts: number[]; history: Sim.Trick[]; stockLeft: number };
export type Given = Sim.Given;
/** Rebuild the hand as `seat` knows it (others' hands are placeholders of the right size; voids recovered from the play). */
export function knownHs(p: View, seat: number, hand: Card[]): Sim.Hs {
  const ph = (i: number, k: number) => Array.from({ length: k }, (_, j) => `?${i}${j}`);
  const h = Sim.newHs(p.v, p.counts.map((k, i) => (i === seat ? hand.slice() : ph(i, k))), p.leader, ph(9, p.stockLeft));
  h.trick = p.trick.slice(); h.trickSeats = p.trickSeats.slice(); h.turn = seat; h.broken = p.broken; h.pts = p.pts.slice(); h.qs = p.qs;
  h.history = p.history.map((t) => ({ ...t, cards: t.cards.slice(), seats: t.seats.slice() }));
  const mark = (cards: Card[], seats: number[]) => { for (let k = 1; k < cards.length; k++) if (cards[k][1] !== cards[0][1]) h.voids[seats[k]][SI[cards[0][1]]] = true; };
  // two-hand: every draw can refill a void, so only tricks after the stock ran out (and the current one) tell us anything
  const from = p.v === "two" ? (p.stockLeft > 0 ? h.history.length : 13) : 0;
  h.history.slice(from).forEach((t) => mark(t.cards, t.seats)); mark(h.trick, h.trickSeats);
  return h;
}
type Acc = { qs: number; pts: number; moon: number; oppMoon: number; trick: number; v: number; v2: number; vals: number[] };
const acc0 = (): Acc => ({ qs: 0, pts: 0, moon: 0, oppMoon: 0, trick: 0, v: 0, v2: 0, vals: [] });
function add(a: Acc, w: Sim.Hs, seat: number, wonTrick: boolean) {
  const sc = Sim.scoreHand(w.pts); const val = Sim.handValue(w, seat);
  a.qs += w.qs === seat ? 1 : 0; a.pts += sc.points[seat]; a.moon += sc.moon === seat ? 1 : 0; a.oppMoon += sc.moon >= 0 && sc.moon !== seat ? 1 : 0;
  a.trick += wonTrick ? 1 : 0; a.v += val; a.v2 += val * val; a.vals.push(val);
}
const fin = (a: Acc, n: number) => { const ev = a.v / n; const sd = Math.sqrt(Math.max(0, a.v2 / n - ev * ev));
  return { n, qs: a.qs / n, pts: a.pts / n, moon: a.moon / n, oppMoon: a.oppMoon / n, trick: a.trick / n, ev, se: sd / Math.sqrt(n), seGap: 0, vals: a.vals }; };

export type PlayRow = { card: Card; n: number; /** P(I take Q♠ this hand) */ qs: number; /** expected points I score (moon rule applied) */ pts: number; moon: number; oppMoon: number; /** P(I win this trick) */ trick: number; /** avg opp points − mine */ ev: number; se: number; seGap: number };
/** Evaluate each distinct legal card for `seat` over `n` sampled worlds. */
export function evalPlay(p: View, seat: number, hand: Card[], o: { n?: number; rng: Rng; given?: Given }): PlayRow[] {
  const n = o.n ?? 200; const deck = Sim.deckFor(p.v); const h = knownHs(p, seat, hand);
  const L = Sim.legal(h, seat); const seen = new Set<Card>([...hand, ...p.history.flatMap((x) => x.cards), ...p.trick]);
  const cands = dedupeEquivalent(L, seen, deck); const acc = cands.map(acc0);
  const rc = Sim.ROLLOUT_CTX(o.rng, deck); const before = h.history.length;
  for (let k = 0; k < n; k++) {
    const w0 = Sim.sampleWorld(h, seat, deck, o.rng, o.given ?? null);
    cands.forEach((c, i) => {
      const w = Sim.cloneHs(w0); Sim.play(w, seat, c);
      while (w.history.length === before && !Sim.handDone(w)) Sim.play(w, w.turn, Sim.heuristic(w, w.turn, rc));
      const won = w.history[before]?.winner === seat;
      Sim.rollout(w, rc); add(acc[i], w, seat, won);
    });
  }
  return withGap(cands.map((card, i) => ({ card, ...fin(acc[i], n) })).sort((x, y) => y.ev - x.ev));
}

export type PassRow = { cards: Card[]; label: string; n: number; qs: number; pts: number; moon: number; oppMoon: number; trick: number; ev: number; se: number; seGap: number };
/** Candidate pass sets: the hard bot's pick, the "three highest" pick, and a void-a-suit pick, plus any set the player chose. */
export function passCandidates(hand: Card[], rng: Rng, mine?: Card[]): { cards: Card[]; label: string }[] {
  const out: { cards: Card[]; label: string }[] = []; const key = (c: Card[]) => [...c].sort().join();
  const push = (cards: Card[], label: string) => { if (cards.length === 3 && !out.some((x) => key(x.cards) === key(cards))) out.push({ cards: [...cards].sort((a, b) => RV(b) - RV(a)), label }); };
  if (mine?.length === 3) push(mine, "Your pass");
  push(Sim.botPass(hand, "hard", Sim.DEFAULT_PARAMS.hard, rng), "Dump danger cards");
  push([...hand].sort((a, b) => RV(b) - RV(a)).slice(0, 3), "Three highest");
  const suits = (["C", "D"] as const).map((s) => bySuit(hand, s)).filter((x) => x.length > 0 && x.length <= 3).sort((a, b) => a.length - b.length)[0];
  if (suits) { const rest = [...hand].filter((c) => !suits.includes(c)).sort((a, b) => RV(b) - RV(a) || (b === "QS" ? 1 : 0)); push([...suits, ...rest].slice(0, 3), `Void ${suits[0][1] === "C" ? "clubs" : "diamonds"}`); }
  const hearts = bySuit(hand, "H").sort((a, b) => RV(b) - RV(a)); if (hearts.length >= 3) push(hearts.slice(0, 3), "Top hearts");
  return out;
}
/** Evaluate pass sets: the other hands are sampled, everyone else passes like the medium bot, then the hand is played out. */
export function evalPass(v: Sim.Variant, n: number, seat: number, hand: Card[], off: number, cands: { cards: Card[]; label: string }[], o: { n?: number; rng: Rng }): PassRow[] {
  const N = o.n ?? 160; const deck = Sim.deckFor(v); const hs = Sim.handSize(v); const unknown = deck.filter((c) => !hand.includes(c));
  const P = Sim.DEFAULT_PARAMS.medium; const rc = Sim.ROLLOUT_CTX(o.rng, deck); const acc = cands.map(acc0);
  for (let k = 0; k < N; k++) {
    const pool = shuffle(unknown, o.rng); let at = 0;
    const hands = Array.from({ length: n }, (_, i) => { if (i === seat) return hand.slice(); const x = pool.slice(at, at + hs); at += hs; return x; });
    const stock = v === "two" ? pool.slice(at) : [];
    const theirs = hands.map((h, i) => (i === seat ? [] : Sim.botPass(h, "medium", P, o.rng)));
    cands.forEach((c, ci) => {
      const hh = hands.map((h, i) => h.filter((x) => !(i === seat ? c.cards : theirs[i]).includes(x)));
      for (let i = 0; i < n; i++) hh[(i + off) % n].push(...(i === seat ? c.cards : theirs[i]));
      const w = Sim.newHs(v, hh, 0, stock.slice()); w.leader = w.turn = Sim.firstLeader(w.hands);
      Sim.rollout(w, rc); add(acc[ci], w, seat, false);
    });
  }
  return withGap(cands.map((c, i) => ({ ...c, ...fin(acc[i], N) })).sort((x, y) => y.ev - x.ev));
}
function withGap<R extends { seGap: number; vals: number[] }>(rows: R[]): Omit<R, "vals">[] {
  const b = rows[0]?.vals ?? [];
  return rows.map(({ vals, ...r }) => { const d = vals.map((x, k) => b[k] - x); const m = d.reduce((a, x) => a + x, 0) / Math.max(1, d.length);
    const sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, d.length - 1)); return { ...r, seGap: sd / Math.sqrt(Math.max(1, d.length)) } as Omit<R, "vals">; });
}
/** One sampled playout of the rest of the hand after `card` (the coach card's Replay). */
export function replayPlay(p: View, seat: number, hand: Card[], card: Card, rng: Rng, given?: Given) {
  const d = Sim.deckFor(p.v); const h = knownHs(p, seat, hand); const w = Sim.sampleWorld(h, seat, d, rng, given ?? null); const rc = Sim.ROLLOUT_CTX(rng, d);
  const before = w.history.length; Sim.play(w, seat, card); Sim.rollout(w, rc);
  return { tricks: w.history.slice(before), pts: w.pts, score: Sim.scoreHand(w.pts) };
}
