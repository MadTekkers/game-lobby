import { describe, it, expect } from "vitest";
import { seededRng, shuffle, type Card } from "./cards/core";
import * as H from "./cards/hearts/engine";
import * as Sim from "./cards/hearts/sim";

const ctx = (seed = 1, now = 1000) => ({ rng: seededRng(seed), now });
const P = (n = "Ann", t = "tok-ann-000000000000") => ({ name: n, tokenHash: t, stack: 1000 });

describe("hearts rules", () => {
  it("lowest club leads; no points on the first trick; hearts not led until broken", () => {
    const h = Sim.newHs("four", [["2C", "AH", "3D"], ["5C", "QS", "4H"], ["KD", "2H", "9S"], ["7C", "8H", "TS"]], 0);
    h.leader = h.turn = Sim.firstLeader(h.hands);
    expect(h.turn).toBe(0); expect(Sim.legal(h, 0)).toEqual(["2C"]);
    Sim.play(h, 0, "2C"); Sim.play(h, 1, "5C");
    expect(Sim.legal(h, 2)).toEqual(["KD", "9S"]); // void in clubs, but no points on trick 1
    Sim.play(h, 2, "9S"); Sim.play(h, 3, "7C");
    expect(h.turn).toBe(3); expect(Sim.legal(h, 3)).toEqual(["TS"]); // hearts not broken
  });
  it("scores hearts + Q♠ and the moon", () => {
    expect(Sim.scoreHand([3, 13, 10, 0]).points).toEqual([3, 13, 10, 0]);
    expect(Sim.scoreHand([26, 0, 0, 0])).toEqual({ points: [0, 26, 26, 26], moon: 0 });
    expect(Sim.deckFor("three")).not.toContain("2D"); expect(Sim.deckFor("three").length).toBe(51);
  });
  it("pass rotation", () => {
    expect([1, 2, 3, 4, 5].map((k) => Sim.passOffset(4, k))).toEqual([1, 3, 2, 0, 1]);
    expect([1, 2, 3].map((k) => Sim.passOffset(3, k))).toEqual([1, 2, 0]);
    expect([1, 2].map((k) => Sim.passOffset(2, k))).toEqual([1, 0]);
  });
  it("two-hand game draws from the stock after each trick (winner first)", () => {
    let s = H.newTable({ seats: 2, botLevel: "medium", now: 0, rng: seededRng(5) });
    s = H.seatHuman(s, 0, P(), ctx());
    expect(s.v).toBe("two"); expect(s.h.stock.length).toBe(26); expect(s.phase).toBe("pass");
    s = H.apply(s, 0, { t: "pass", cards: s.h.hands[0].slice(0, 3) }, ctx(2));
    expect(s.phase).toBe("play");
    for (let g = 0; g < 4 && s.h.history.length === 0; g++) { if (H.actor(s) === 0) s = H.apply(s, 0, { t: "play", card: Sim.legal(s.h, 0)[0] }, ctx(g)); }
    expect(s.h.history.length).toBe(1); expect(s.h.stock.length).toBe(24);
    const all = [...s.h.hands.flat(), ...s.h.stock, ...s.h.trick, ...s.h.history.flatMap((t) => t.cards)];
    expect(all.length).toBe(52); expect(new Set(all).size).toBe(52);
  });
  it("passing moves three cards to the right seat and is validated", () => {
    let s = H.newTable({ seats: 4, botLevel: "easy", now: 0, rng: seededRng(8) });
    s = H.seatHuman(s, 0, P(), ctx());
    const mine = s.h.hands[0].slice(0, 3);
    expect(() => H.apply(s, 0, { t: "pass", cards: [mine[0], mine[0], mine[1]] }, ctx())).toThrow();
    s = H.apply(s, 0, { t: "pass", cards: mine }, ctx(3));
    const seat1 = [...s.h.hands[1], ...s.h.history.flatMap((t) => t.cards.filter((_, k) => t.seats[k] === 1)), ...s.h.trick.filter((_, k) => s.h.trickSeats[k] === 1)];
    for (const c of mine) expect(seat1).toContain(c);
    expect(s.seats[1].received).toEqual(mine); expect(s.phase).toBe("play");
  });
});
describe("hearts table", () => {
  it("plays complete games in every variant at every level", () => {
    for (const [n, lvl] of [[4, "hard"], [3, "medium"], [2, "easy"], [4, "easy"], [3, "hard"], [2, "hard"]] as const) {
      let s = H.newTable({ seats: n, botLevel: lvl, now: 0, rng: seededRng(n * 11), target: 60 });
      s = H.seatHuman(s, 0, P(), ctx(1));
      for (let g = 0; g < 3000 && s.phase !== "gameover"; g++) { s.seats[0].idle = -9999; s.deadline = 1; s = H.timeout(s, ctx(g, 10)); }
      expect(s.phase).toBe("gameover"); expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(60);
      expect(s.results[0].name).toBe("Ann"); expect(s.ledger.length).toBeGreaterThan(0);
      const total = s.lastHand!.points.reduce((a, b) => a + b, 0); expect([26, 26 * (n - 1)]).toContain(total);
    }
  }, 90000);
  it("public view never carries hands, stock or passed cards; private view only the owner's", () => {
    let s = H.newTable({ seats: 4, botLevel: "medium", now: 0, rng: seededRng(2), live: true });
    s = H.seatHuman(s, 0, P(), ctx()); s = H.seatHuman(s, 1, P("Bob", "tok-bob-000000000000"), ctx());
    s = H.apply(s, 0, { t: "start" }, ctx());
    const pub = JSON.stringify(H.publicView(s));
    for (const c of s.h.hands[1]) expect(pub).not.toContain(`"${c}"`);
    expect(pub).not.toContain("tokenHash");
    expect(H.privateView(s, 0)!.hand).toEqual(expect.arrayContaining(s.h.hands[0]));
  });
});

/** Duplicate-style match: the same deals played with levels A at seats {0,2} and B at {1,3}, then swapped. Returns A's mean edge in points per hand. */
function match(A: Sim.Level, B: Sim.Level, hands: number, seed: number) {
  const rng = seededRng(seed); let edge = 0;
  for (let k = 0; k < hands; k++) {
    const deck = shuffle(Sim.deckFor("four"), rng);
    for (const swap of [false, true]) {
      const lv = (i: number) => ((i % 2 === 0) !== swap ? A : B);
      const hands4: Card[][] = [0, 1, 2, 3].map((i) => deck.slice(i * 13, i * 13 + 13));
      const off = Sim.passOffset(4, k + 1); const r = seededRng(seed * 1000 + k);
      const passes = hands4.map((h, i) => Sim.botPass(h, lv(i), Sim.DEFAULT_PARAMS[lv(i)], r));
      if (off) { hands4.forEach((h, i) => (hands4[i] = h.filter((c) => !passes[i].includes(c)))); passes.forEach((p, i) => hands4[(i + off) % 4].push(...p)); }
      const h = Sim.newHs("four", hands4, 0); h.leader = h.turn = Sim.firstLeader(h.hands);
      while (!Sim.handDone(h)) { const t = h.turn; h && Sim.play(h, t, Sim.botCard(h, t, { level: lv(t), P: Sim.DEFAULT_PARAMS[lv(t)], rng: r, deck: Sim.deckFor("four") }, off ? { to: (t + off) % 4, cards: passes[t] } : null)); }
      const p = Sim.scoreHand(h.pts).points;
      const a = [0, 1, 2, 3].filter((i) => lv(i) === A).reduce((x, i) => x + p[i], 0), b = [0, 1, 2, 3].filter((i) => lv(i) === B).reduce((x, i) => x + p[i], 0);
      edge += (b - a) / 2;
    }
  }
  return edge / (2 * hands);
}
describe("hearts bots", () => {
  it("medium takes fewer points than easy", () => { const e = match("medium", "easy", 60, 3); console.log(`EDGE medium-easy ${e.toFixed(2)}`); expect(e).toBeGreaterThan(1.5); }, 60000);
  it("hard takes fewer points than medium", () => { const e = match("hard", "medium", 40, 4); console.log(`EDGE hard-medium ${e.toFixed(2)}`); expect(e).toBeGreaterThan(0.5); }, 120000);
});
import * as C from "./cards/hearts/coach";
describe("hearts coach", () => {
  it("play rows come from simulation and favour ducking under the queen", () => {
    // spade trick: A♠ led, Q♠ already thrown? no — we hold Q♠ and K♠ is winning: dropping Q♠ is best
    const v: C.View = { v: "four", n: 4, trick: ["KS"], trickSeats: [3], leader: 3, broken: false, pts: [0, 0, 0, 0], qs: -1, counts: [3, 3, 3, 2],
      history: [{ seats: [0, 1, 2, 3], cards: ["2C", "3C", "4C", "5C"], winner: 3 }], stockLeft: 0 };
    const rows = C.evalPlay(v, 0, ["QS", "2S", "9D"], { n: 60, rng: seededRng(1) });
    expect(rows.every((r) => r.n === 60)).toBe(true);
    expect(rows[0].card).toBe("QS");
    expect(rows.find((r) => r.card === "QS")!.qs).toBe(0);
  });
  it("pass rows evaluate several candidate sets", () => {
    const hand = ["QS", "AS", "KS", "2H", "3H", "4C", "5C", "6D", "7D", "8D", "9C", "TC", "JC"];
    const cands = C.passCandidates(hand, seededRng(2));
    expect(cands.length).toBeGreaterThanOrEqual(2);
    const rows = C.evalPass("four", 4, 0, hand, 1, cands, { n: 40, rng: seededRng(3) });
    expect(rows.length).toBe(cands.length); expect(rows[0].ev).toBeGreaterThanOrEqual(rows[rows.length - 1].ev);
  });
});
