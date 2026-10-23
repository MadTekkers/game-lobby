// Hearts tuner: fitness = average opponent points − own points per hand (moon rule applied).
import { shuffle, type Rng } from "../core.ts";
import type { GameTuner, HandRow } from "../tune.ts";
import * as Sim from "./sim.ts";

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
/** Duplicate self-play on 4-hand deals: each deal is played twice with the A/B seats swapped; returns B's mean edge per hand / 5. */
export function duplicate(level: Sim.Level, a: Sim.BotParams, b: Sim.BotParams, deals: number, rng: Rng) {
  let edge = 0;
  for (let d = 0; d < deals; d++) {
    const deck = shuffle(Sim.deckFor("four"), rng); const off = Sim.passOffset(4, d + 1);
    for (const swap of [0, 1]) {
      const P = (i: number) => ((i % 2) ^ swap ? b : a);
      const hands = [0, 1, 2, 3].map((i) => deck.slice(i * 13, i * 13 + 13));
      const passes = hands.map((h, i) => Sim.botPass(h, level, P(i), rng));
      if (off) { hands.forEach((h, i) => (hands[i] = h.filter((c) => !passes[i].includes(c)))); passes.forEach((p, i) => hands[(i + off) % 4].push(...p)); }
      const h = Sim.newHs("four", hands, 0); h.leader = h.turn = Sim.firstLeader(h.hands);
      while (!Sim.handDone(h)) { const i = h.turn; Sim.play(h, i, Sim.botCard(h, i, { level, P: P(i), rng, deck: Sim.deckFor("four") }, off ? { to: (i + off) % 4, cards: passes[i] } : null)); }
      const p = Sim.scoreHand(h.pts).points; const bSide = swap ? [0, 2] : [1, 3], aSide = swap ? [1, 3] : [0, 2];
      edge += (aSide.reduce((x, i) => x + p[i], 0) - bSide.reduce((x, i) => x + p[i], 0)) / 2;
    }
  }
  return edge / (2 * deals) / 5;
}
export const heartsTuner: GameTuner<Sim.BotParams> = {
  game: "hearts", defaults: Sim.DEFAULT_PARAMS, bounds: Sim.PARAM_BOUNDS,
  // easy stays deliberately weak; samples (search depth) is fixed by the edge CPU budget
  steps: { medium: { qKeep: 1, moonMin: 0.05, flush: 0.15 }, hard: { qKeep: 1, moonMin: 0.05, flush: 0.15 } },
  fitness(m) { return num(m.rel); },
  review(level, p, rows: HandRow[]) {
    const notes: string[] = []; const q = { ...p };
    if (level === "easy") return { p: q, notes };
    const kept = rows.filter((r) => r.metrics.heldQ === true);
    if (kept.length >= 20) {
      const ate = kept.filter((r) => r.metrics.qs === true).length / kept.length;
      if (ate > 0.45) { q.qKeep += 1; notes.push(`bots that kept Q♠ ate it ${(ate * 100).toFixed(0)}% of ${kept.length} hands → keep it only with more low spades (qKeep +1)`); }
      else if (ate < 0.15) { q.qKeep -= 1; notes.push(`bots that kept Q♠ ate it only ${(ate * 100).toFixed(0)}% of ${kept.length} hands → keep it a bit more (qKeep −1)`); }
    }
    if (rows.length >= 60) {
      const opp = rows.filter((r) => r.metrics.oppMoon === true).length / rows.length;
      if (opp > 0.06) { q.flush = Math.min(1, q.flush + 0.1); notes.push(`opponents shot the moon in ${(opp * 100).toFixed(1)}% of ${rows.length} hands → lead spades/flush earlier (flush +0.1)`); }
    }
    return { p: q, notes };
  },
  selfPlay(level, a, b, rng) { return level === "medium" ? duplicate(level, a, b, 16, rng) : 0; },
};
