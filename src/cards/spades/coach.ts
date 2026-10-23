// Spades coach: Monte Carlo over the hidden cards (worlds consistent with everything this seat has seen: played cards, voids shown,
// its own discards in the draw variant). Every candidate is scored on the SAME sampled worlds (common random numbers), and the rest
// of the hand is rolled out with the medium card-counting heuristic for all four hands. Nothing is hardcoded.
import { type Card, type Rng, makeDeck } from "../core.ts";
import { SI, dedupeEquivalent, trickWinner } from "../tricks.ts";
import * as Sim from "./sim.ts";

export type View = {
  v: Sim.Variant; n: number; trick: Card[]; trickSeats: number[]; leader: number; broken: boolean; bids: (number | null)[]; nil: number[];
  tricks: number[]; counts: number[]; history: Sim.Trick[]; bags: number[]; scores: number[];
};
/** Rebuild the hand state as `seat` knows it (other hands are placeholders of the right size; voids recovered from the play). */
export function knownHs(p: View, seat: number, hand: Card[]): Sim.Hs {
  const h = Sim.newHs(p.v, p.counts.map((k, i) => (i === seat ? hand.slice() : Array.from({ length: k }, (_, j) => `?${i}${j}`))), p.leader);
  h.trick = p.trick.slice(); h.trickSeats = p.trickSeats.slice(); h.turn = seat; h.broken = p.broken;
  h.bids = p.bids.slice(); h.nil = p.nil.slice(); h.tricks = p.tricks.slice(); h.history = p.history.map((t) => ({ ...t, cards: t.cards.slice(), seats: t.seats.slice() }));
  const mark = (cards: Card[], seats: number[]) => { for (let k = 1; k < cards.length; k++) if (cards[k][1] !== cards[0][1]) h.voids[seats[k]][SI[cards[0][1]]] = true; };
  for (const t of h.history) mark(t.cards, t.seats); mark(h.trick, h.trickSeats);
  return h;
}
export function unknownDeck(v: Sim.Variant, exclude: Card[] = []) { const ex = new Set(exclude); return Sim.deckFor(v).filter((c) => !ex.has(c)); }

export type PlayRow = { card: Card; n: number; make: number; set: number; bags: number; nil: number | null; trick: number; ev: number; se: number; /** paired SE of (best − this), same worlds */ seGap: number };
const teamOk = (sc: Sim.HandScore, t: number) => sc.contract[t] === 0 || sc.made[t];
function stats(v: Sim.Variant, w: Sim.Hs, t: number, seat: number) {
  const sc = Sim.scoreHand(v, w.bids, w.nil, w.tricks); const T = sc.points.length;
  const oppSet = [...Array(T).keys()].some((k) => k !== t && sc.contract[k] > 0 && !sc.made[k]);
  const pt = Sim.partnerOf(v, seat); const nils = [seat, pt].filter((i) => i >= 0 && w.nil[i]);
  const nilOk = nils.length ? (nils.every((i) => sc.nilOk[i]) ? 1 : 0) : null;
  return { make: teamOk(sc, t) ? 1 : 0, set: oppSet ? 1 : 0, bags: sc.bags[t], nilOk, value: Sim.handValue(w, t, 10) };
}

/** Evaluate each legal card for `seat` over `n` sampled worlds. deck = cards that may be in other hands (excludes known discards). */
export function evalPlay(p: View, seat: number, hand: Card[], o: { n?: number; rng: Rng; deck?: Card[] }): PlayRow[] {
  const n = o.n ?? 200; const deck = o.deck ?? Sim.deckFor(p.v); const h = knownHs(p, seat, hand); const t = Sim.teamOf(p.v, seat);
  const L = Sim.legal(h, seat); const seen = new Set<Card>([...hand, ...p.history.flatMap((x) => x.cards), ...p.trick]);
  const cands = dedupeEquivalent(L, seen, deck);
  const acc = cands.map(() => ({ make: 0, set: 0, bags: 0, nil: 0, nilN: 0, trick: 0, v: 0, v2: 0, vals: [] as number[] }));
  const rc = Sim.ROLLOUT_CTX(o.rng, deck); const before = h.history.length;
  for (let k = 0; k < n; k++) {
    const w0 = Sim.sampleWorld(h, seat, deck, o.rng);
    cands.forEach((c, i) => {
      const w = Sim.cloneHs(w0); Sim.play(w, seat, c);
      while (w.history.length === before && !Sim.handDone(w)) Sim.play(w, w.turn, Sim.heuristic(w, w.turn, rc));
      const won = w.history[before] ? Sim.teamOf(p.v, w.history[before].winner) === t : false;
      Sim.rollout(w, rc); const s = stats(p.v, w, t, seat); const a = acc[i];
      a.make += s.make; a.set += s.set; a.bags += s.bags; a.trick += won ? 1 : 0; a.v += s.value; a.v2 += s.value * s.value; a.vals.push(s.value);
      if (s.nilOk !== null) { a.nil += s.nilOk; a.nilN++; }
    });
  }
  const out = cands.map((card, i) => { const a = acc[i]; const ev = a.v / n; const sd = Math.sqrt(Math.max(0, a.v2 / n - ev * ev));
    return { card, n, make: a.make / n, set: a.set / n, bags: a.bags / n, nil: a.nilN ? a.nil / a.nilN : null, trick: a.trick / n, ev, se: sd / Math.sqrt(n), seGap: 0, vals: a.vals }; })
    .sort((x, y) => y.ev - x.ev);
  return withGap(out);
}

export type BidRow = { bid: number; nil: number; n: number; make: number; set: number; bags: number; nilOk: number | null; ev: number; se: number; seGap: number; tricks: number };
/** Evaluate candidate bids: other unknown hands are sampled, seats yet to bid bid like the medium bot, then the hand is played out. */
export function evalBid(p: View & { handSize?: number }, seat: number, hand: Card[], o: { n?: number; rng: Rng; deck?: Card[]; blind?: boolean }): BidRow[] {
  const n = o.n ?? 300; const deck = o.deck ?? Sim.deckFor(p.v); const hs = Sim.handSize(p.v); const t = Sim.teamOf(p.v, seat);
  const est = Sim.estimate(hand, p.v); const base = Math.max(1, Math.min(hs, Math.round(est)));
  const pt = Sim.partnerOf(p.v, seat); const partnerNil = pt >= 0 && p.nil[pt] > 0;
  const cand: { bid: number; nil: number }[] = [...new Set([base - 1, base, base + 1].filter((b) => b >= 1 && b <= hs))].map((b) => ({ bid: b, nil: 0 }));
  if (!partnerNil) cand.push({ bid: 0, nil: 1 }); if (o.blind) cand.push({ bid: 0, nil: 2 });
  const P = Sim.DEFAULT_PARAMS.medium; const rc = Sim.ROLLOUT_CTX(o.rng, deck);
  const unknown = deck.filter((c) => !hand.includes(c));
  const acc = cand.map(() => ({ make: 0, set: 0, bags: 0, nil: 0, nilN: 0, v: 0, v2: 0, tr: 0, vals: [] as number[] }));
  for (let k = 0; k < n; k++) {
    // deal the unknown cards (no voids known before play)
    const pool = unknown.slice(); for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(o.rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    let off = 0; const hands = p.counts.map((_c, i) => { if (i === seat) return hand.slice(); const x = pool.slice(off, off + hs); off += hs; return x; });
    cand.forEach((c, ci) => {
      const w = Sim.newHs(p.v, hands.map((x) => x.slice()), p.leader); w.bids = p.bids.slice(); w.nil = p.nil.slice();
      w.bids[seat] = c.bid; w.nil[seat] = c.nil;
      for (let j = 1; j < p.n; j++) { const i = (seat + j) % p.n; if (w.bids[i] !== null) continue; const b = Sim.botBid({ v: p.v, seat: i, hand: w.hands[i], bids: w.bids, nil: w.nil, level: "medium", P, rng: o.rng }); w.bids[i] = b.n; w.nil[i] = b.nil; }
      Sim.rollout(w, rc); const s = stats(p.v, w, t, seat); const a = acc[ci];
      a.make += s.make; a.set += s.set; a.bags += s.bags; a.v += s.value; a.v2 += s.value * s.value; a.tr += w.tricks[seat]; a.vals.push(s.value);
      if (s.nilOk !== null) { a.nil += s.nilOk; a.nilN++; }
    });
  }
  return withGap(cand.map((c, i) => { const a = acc[i]; const ev = a.v / n; const sd = Math.sqrt(Math.max(0, a.v2 / n - ev * ev));
    return { ...c, n, make: a.make / n, set: a.set / n, bags: a.bags / n, nilOk: a.nilN ? a.nil / a.nilN : null, ev, se: sd / Math.sqrt(n), seGap: 0, tricks: a.tr / n, vals: a.vals }; })
    .sort((x, y) => y.ev - x.ev));
}
/** Paired standard error of (best − row) over the shared worlds; strips the per-world values. */
function withGap<R extends { seGap: number; vals: number[] }>(rows: R[]): Omit<R, "vals">[] {
  const b = rows[0]?.vals ?? [];
  return rows.map(({ vals, ...r }) => { const d = vals.map((x, k) => b[k] - x); const m = d.reduce((a, x) => a + x, 0) / Math.max(1, d.length);
    const sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, d.length - 1)); return { ...r, seGap: sd / Math.sqrt(Math.max(1, d.length)) } as Omit<R, "vals">; });
}
/** One sampled playout of the rest of the hand after `card` (for the coach card's Replay). */
export function replayPlay(p: View, seat: number, hand: Card[], card: Card, rng: Rng, deck?: Card[]) {
  const d = deck ?? Sim.deckFor(p.v); const h = knownHs(p, seat, hand); const w = Sim.sampleWorld(h, seat, d, rng); const rc = Sim.ROLLOUT_CTX(rng, d);
  const before = w.history.length; Sim.play(w, seat, card); Sim.rollout(w, rc);
  return { tricks: w.history.slice(before), final: w.tricks, score: Sim.scoreHand(p.v, w.bids, w.nil, w.tricks), hands: w.hands };
}
export const _test = { trickWinner, makeDeck };
