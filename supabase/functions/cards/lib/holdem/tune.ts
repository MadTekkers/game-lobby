// Hold'em tuner: fitness = big blinds won per hand. Review rules look at showdown/bluff outcomes; the screen is duplicate self-play.
import { seededRng, shuffle, makeDeck, type Rng } from "../core.ts";
import type { GameTuner, HandRow } from "../tune.ts";
import * as E from "./engine.ts";
import * as Sim from "./sim.ts";

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
/** Heads-up duplicate: each deck is played twice with seats swapped, 100bb stacks reset every hand. Returns A's bb/hand edge. */
export function duplicate(a: Sim.Level, b: Sim.Level, deals: number, rng: Rng, pa?: Sim.BotParams, pb?: Sim.BotParams) {
  let won = 0;
  for (let d = 0; d < deals; d++) {
    const deck = shuffle(makeDeck(), rng); const seed = Math.floor(rng() * 2 ** 31);
    for (const swap of [0, 1]) {
      const s = E.newTable({ seats: 2, botLevel: "medium", now: 0, rng: seededRng(seed), deck });
      const lv = swap ? [b, a] : [a, b]; s.seats.forEach((x, i) => (x.level = lv[i])); s.button = d % 2;
      const params = swap ? [pb, pa] : [pa, pb];
      E.botsHand(s, { rng: seededRng(seed + 1), now: 0 }, params);
      won += (s.lastHand!.net[swap ? 1 : 0]) / s.bb;
    }
  }
  return won / (2 * deals);
}
export const holdemTuner: GameTuner<Sim.BotParams> = {
  game: "holdem", defaults: Sim.DEFAULT_PARAMS, bounds: Sim.PARAM_BOUNDS,
  // easy stays a calling station on purpose; samples is fixed by the edge CPU budget
  steps: { medium: { open: 0.5, slack: 0.02, bluff: 0.02, aggr: 0.05, valueTh: 0.02 }, hard: { open: 0.5, slack: 0.02, bluff: 0.02, aggr: 0.05, valueTh: 0.02 } },
  fitness(m) { return m.dealt === false ? null : num(m.bb); },
  review(level, p, rows: HandRow[]) {
    const notes: string[] = []; const q = { ...p }; if (level === "easy") return { p: q, notes };
    const bl = rows.filter((r) => r.metrics.bluff === true);
    if (bl.length >= 25) { const ok = bl.filter((r) => r.metrics.bluffWon === true).length / bl.length;
      if (ok < 0.3) { q.bluff -= 0.02; notes.push(`bluffs won ${(ok * 100).toFixed(0)}% of ${bl.length} → bluff less`); }
      else if (ok > 0.55) { q.bluff += 0.02; notes.push(`bluffs won ${(ok * 100).toFixed(0)}% of ${bl.length} → bluff more`); } }
    const sd = rows.filter((r) => r.metrics.sd === true);
    if (sd.length >= 40) { const w = sd.filter((r) => r.metrics.won === true).length / sd.length;
      if (w < 0.42) { q.slack -= 0.02; notes.push(`won ${(w * 100).toFixed(0)}% of ${sd.length} showdowns → call down less`); }
      else if (w > 0.62) { q.slack += 0.02; notes.push(`won ${(w * 100).toFixed(0)}% of ${sd.length} showdowns → call down more`); } }
    const vp = rows.filter((r) => r.metrics.dealt === true); 
    if (vp.length >= 60) { const v = vp.filter((r) => r.metrics.vpip === true).length / vp.length; const bb = vp.reduce((a, r) => a + (num(r.metrics.bb) ?? 0), 0) / vp.length;
      if (v > 0.45 && bb < 0) { q.open -= 0.5; notes.push(`played ${(v * 100).toFixed(0)}% of hands at ${bb.toFixed(2)} bb/hand → tighten`); } }
    return { p: q, notes };
  },
  selfPlay(level, a, b, rng) { return level === "medium" ? duplicate("medium", "medium", 40, rng, a, b) : 0; },
};
