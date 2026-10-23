// Spades tuner: fitness = team hand points with bags charged at their amortized cost (10 bags = −100 → −10 each).
import { makeDeck, shuffle, type Rng } from "../core.ts";
import type { GameTuner, HandRow } from "../tune.ts";
import * as Sim from "./sim.ts";

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
/** Duplicate self-play: each deal is played twice with the teams swapped; returns candidate's mean edge per hand / 20. */
export function duplicate(level: Sim.Level, a: Sim.BotParams, b: Sim.BotParams, deals: number, rng: Rng) {
  let edge = 0;
  for (let d = 0; d < deals; d++) {
    const deck = shuffle(makeDeck(), rng);
    for (const swap of [0, 1]) {
      const h = Sim.newHs("partners", [0, 1, 2, 3].map((i) => deck.slice(i * 13, i * 13 + 13)), d % 4);
      const P = (i: number) => ((i % 2) ^ swap ? a : b); // team (0 when !swap) plays b
      for (let j = 0; j < 4; j++) { const i = (d % 4 + j) % 4; const bd = Sim.botBid({ v: "partners", seat: i, hand: h.hands[i], bids: h.bids, nil: h.nil, level, P: P(i), rng }); h.bids[i] = bd.n; h.nil[i] = bd.nil; }
      while (!Sim.handDone(h)) { const i = h.turn; Sim.play(h, i, Sim.botCard(h, i, { level, P: P(i), rng, deck: makeDeck() })); }
      const sc = Sim.scoreHand("partners", h.bids, h.nil, h.tricks); const f = (t: number) => sc.points[t] - 10 * sc.bags[t];
      edge += swap ? f(1) - f(0) : f(0) - f(1);
    }
  }
  return edge / (2 * deals) / 20;
}
export const spadesTuner: GameTuner<Sim.BotParams> = {
  game: "spades", defaults: Sim.DEFAULT_PARAMS, bounds: Sim.PARAM_BOUNDS,
  // easy stays deliberately weak; samples (search depth) is fixed by the edge CPU budget
  steps: { medium: { bidOffset: 0.2, bagCost: 1, setAggro: 0.1, nilMax: 0.15 }, hard: { bidOffset: 0.2, bagCost: 1, setAggro: 0.1, nilMax: 0.15 } },
  fitness(m) { const p = num(m.points), b = num(m.bags); return p === null || b === null ? null : p - 10 * b; },
  review(level, p, rows: HandRow[]) {
    const notes: string[] = []; const q = { ...p };
    if (level === "easy") return { p: q, notes };
    const bids = rows.filter((r) => !r.metrics.nil && num(r.metrics.bid) !== null && num(r.metrics.tricks) !== null);
    if (bids.length >= 40) {
      const err = bids.reduce((a, r) => a + (Number(r.metrics.tricks) - Number(r.metrics.bid)), 0) / bids.length;
      if (Math.abs(err) > 0.25) { const d = Math.max(-0.3, Math.min(0.3, 0.5 * err)); q.bidOffset += d; notes.push(`bots took ${err.toFixed(2)} tricks vs bid on average over ${bids.length} bids → bidOffset ${d > 0 ? "+" : ""}${d.toFixed(2)}`); }
    }
    const nils = rows.filter((r) => Number(r.metrics.nil) === 1);
    if (nils.length >= 8) {
      const ok = nils.filter((r) => r.metrics.nilOk === true).length / nils.length;
      if (ok < 0.6) { q.nilMax -= 0.15; notes.push(`nil made ${(ok * 100).toFixed(0)}% of ${nils.length} → bid nil less often`); }
      else if (ok > 0.88) { q.nilMax += 0.1; notes.push(`nil made ${(ok * 100).toFixed(0)}% of ${nils.length} → bid nil a bit more`); }
    }
    return { p: q, notes };
  },
  selfPlay(level, a, b, rng) { return level === "medium" ? duplicate(level, a, b, 24, rng) : 0; },
};
