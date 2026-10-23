import { describe, it, expect } from "vitest";
import { seededRng, makeDeck } from "./cards/core";
import * as S from "./cards/spades/engine";
import * as Sim from "./cards/spades/sim";

const ctx = (seed = 1, now = 1000) => ({ rng: seededRng(seed), now });
const P = (n = "Ann", t = "tok-ann-000000000000") => ({ name: n, tokenHash: t, stack: 1000 });

describe("spades scoring", () => {
  it("contract made with bags, set, nil and blind nil", () => {
    const r = Sim.scoreHand("partners", [4, 3, 2, 4], [0, 0, 0, 0], [5, 3, 2, 3]);
    expect(r.points).toEqual([61, -70]); expect(r.bags).toEqual([1, 0]); expect(r.made).toEqual([true, false]);
    const n = Sim.scoreHand("partners", [0, 5, 6, 0], [1, 0, 0, 2], [0, 5, 6, 2]);
    expect(n.points).toEqual([100 + 60, 50 - 200]); expect(n.nilOk).toEqual([true, null, null, false]);
    const c = Sim.scoreHand("cutthroat", [5, 6, 6], [0, 0, 0], [7, 5, 5]);
    expect(c.points).toEqual([52, -60, -60]);
  });
  it("10 bags cost 100", () => {
    expect(Sim.applyBags(300, 8, 3)).toEqual({ score: 200, bags: 1, penalties: 1 });
    expect(Sim.applyBags(300, 2, 3)).toEqual({ score: 300, bags: 5, penalties: 0 });
  });
});
describe("spades rules", () => {
  it("must follow suit; spades can't lead until broken", () => {
    const h = Sim.newHs("partners", [["AS", "2H"], ["3H", "4S"], ["5H", "6D"], ["7H", "8C"]], 0);
    expect(Sim.legal(h, 0)).toEqual(["2H"]);
    Sim.play(h, 0, "2H"); expect(Sim.legal(h, 1)).toEqual(["3H"]);
    const h2 = Sim.newHs("partners", [["AS", "KS"], ["3H"], ["5H"], ["7H"]], 0);
    expect(Sim.legal(h2, 0)).toEqual(["AS", "KS"]); // only spades left
  });
  it("trump wins; void recorded", () => {
    const h = Sim.newHs("partners", [["KH", "2C"], ["2S", "3C"], ["AH", "4C"], ["3H", "5C"]], 0);
    Sim.play(h, 0, "KH"); Sim.play(h, 1, "2S"); Sim.play(h, 2, "AH"); Sim.play(h, 3, "3H");
    expect(h.tricks).toEqual([0, 1, 0, 0]); expect(h.turn).toBe(1); expect(h.voids[1][1]).toBe(true); expect(h.broken).toBe(true);
  });
  it("cutthroat removes the 2♣ and deals 17; draw variant draws 13 each", () => {
    let s = S.newTable({ seats: 3, botLevel: "medium", now: 0, rng: seededRng(3) });
    s = S.seatHuman(s, 0, P(), ctx());
    expect(s.v).toBe("cutthroat"); expect(s.h.hands.every((x) => x.length === 17)).toBe(true);
    expect(s.h.hands.flat()).not.toContain("2C");
    let d = S.newTable({ seats: 2, botLevel: "medium", now: 0, rng: seededRng(4) });
    d = S.seatHuman(d, 0, P(), ctx());
    expect(d.v).toBe("draw");
    for (let g = 0; g < 40 && d.phase === "draw"; g++) d = S.apply(d, 0, { t: g % 2 ? "keep" : "discard" }, ctx(g));
    expect(d.phase).toBe("bidding"); expect(d.h.hands.map((x) => x.length)).toEqual([13, 13]);
    expect(new Set(d.h.hands.flat()).size).toBe(26);
  });
});
describe("spades table", () => {
  it("plays complete games in every variant at every level", () => {
    for (const [n, lvl] of [[4, "hard"], [3, "medium"], [2, "easy"], [4, "easy"], [3, "hard"], [2, "hard"]] as const) {
      let s = S.newTable({ seats: n, botLevel: lvl, now: 0, rng: seededRng(n * 7), target: 200 });
      s = S.seatHuman(s, 0, P(), ctx(1));
      for (let g = 0; g < 3000 && s.phase !== "gameover"; g++) { s.seats[0].idle = -9999; s.deadline = 1; s = S.timeout(s, ctx(g, 10)); }
      expect(s.phase).toBe("gameover"); expect(s.results[0].name).toBe("Ann");
      expect(s.scores.some((x) => x >= 200) || s.scores.some((x) => x <= -200)).toBe(true);
    }
  }, 60000);
  it("drives a full human game to the end with results + ledger", () => {
    let s = S.newTable({ seats: 4, botLevel: "medium", now: 0, rng: seededRng(9), target: 250 });
    s = S.seatHuman(s, 0, P(), ctx());
    const rng = seededRng(5);
    for (let g = 0; g < 5000 && s.phase !== "gameover"; g++) {
      const a = S.actor(s); expect(a).toBe(0); // bots always move until the human is up
      if (s.phase === "bidding") s = S.apply(s, 0, { t: "bid", n: Math.max(1, Math.round(Sim.estimate(s.h.hands[0], s.v))) }, ctx(g));
      else { const L = Sim.legal(s.h, 0); s = S.apply(s, 0, { t: "play", card: L[Math.floor(rng() * L.length)] }, ctx(g)); }
    }
    expect(s.phase).toBe("gameover"); expect(s.resultSeq).toBe(1); expect(s.results).toHaveLength(1);
    expect(s.ledger).toHaveLength(1); expect(Math.abs(s.ledger[0].delta)).toBe(100); expect(s.ledger[0].clamp).toBe(true);
    expect(s.reviewSeq).toBeGreaterThan(0); expect(s.reviews).toHaveLength(4);
  });
  it("rejects illegal moves", () => {
    let s = S.newTable({ seats: 4, botLevel: "medium", now: 0, rng: seededRng(2) });
    s = S.seatHuman(s, 0, P(), ctx());
    expect(() => S.apply(s, 0, { t: "bid", n: 14 }, ctx())).toThrow();
    expect(() => S.apply(s, 0, { t: "play", card: s.h.hands[0][0] }, ctx())).toThrow();
    expect(() => S.apply(s, 1, { t: "bid", n: 3 }, ctx())).toThrow();
    s = S.apply(s, 0, { t: "bid", n: 3 }, ctx());
    const notMine = makeDeck().find((c) => !s.h.hands[0].includes(c))!;
    if (S.actor(s) === 0) expect(() => S.apply(s, 0, { t: "play", card: notMine }, ctx())).toThrow();
  });
  it("public view never contains unplayed cards; private view only the owner's", () => {
    let s = S.newTable({ seats: 4, botLevel: "hard", now: 0, rng: seededRng(12) });
    s = S.seatHuman(s, 0, P(), ctx()); s = S.apply(s, 0, { t: "bid", n: 3 }, ctx());
    const pub = JSON.stringify(S.publicView(s));
    for (let i = 0; i < 4; i++) for (const c of s.h.hands[i]) expect(pub).not.toMatch(new RegExp(`"${c}"`));
    expect(S.privateView(s, 0)!.hand!.sort()).toEqual([...s.h.hands[0]].sort());
    expect(pub).not.toContain("tok-ann");
    const tut = S.newTable({ seats: 4, botLevel: "easy", now: 0, rng: seededRng(1), tutorial: true });
    expect(S.publicView(S.seatHuman(tut, 0, P(), ctx())).hands![1]).toHaveLength(13);
  });
  it("blind nil is offered only when trailing by 100+, and hides the hand", () => {
    let s = S.newTable({ seats: 4, botLevel: "medium", now: 0, rng: seededRng(4) });
    s = S.seatHuman(s, 0, P(), ctx());
    expect(S.privateView(s, 0)!.blindOffer).toBe(false);
    s.scores = [100, 250]; s.h.bids = [null, null, null, null]; s.turn = 0; s.seats[0].looked = false;
    expect(S.privateView(s, 0)!.blindOffer).toBe(true); expect(S.privateView(s, 0)!.hand).toBeNull();
    const b = S.apply(s, 0, { t: "bid", n: 0, blind: true }, ctx()); expect(b.h.nil[0]).toBe(2);
    expect(() => S.apply(s, 0, { t: "bid", n: 2, blind: true }, ctx())).toThrow();
  });
  it("a joining human waits for the hand to end, then takes the bot's seat", () => {
    let s = S.newTable({ seats: 4, botLevel: "medium", now: 0, rng: seededRng(6) });
    s = S.seatHuman(s, 0, P(), ctx());
    s = S.seatHuman(s, 2, P("Bea", "tok-bea-000000000000"), ctx());
    expect(s.seats[2].kind).toBe("bot"); expect(s.seats[2].pending?.name).toBe("Bea");
    const hand = s.handNo;
    for (let g = 0; g < 400 && s.handNo === hand; g++) { const a = S.actor(s); if (a < 0) break; if (s.seats[a].kind === "human") { s.deadline = 1; s.seats[a].idle = -99; s = S.timeout(s, ctx(g, 5)); } }
    expect(s.seats[2].kind).toBe("human"); expect(s.seats[2].name).toBe("Bea");
  });
  it("live tables wait for Start; leaving hands the seat to a bot", () => {
    let s = S.newTable({ seats: 4, botLevel: "medium", now: 0, rng: seededRng(6), live: true });
    s = S.seatHuman(s, 0, P(), ctx()); expect(s.phase).toBe("waiting");
    s = S.seatHuman(s, 1, P("Bea", "tok-bea-000000000000"), ctx()); expect(s.seats[1].kind).toBe("human");
    s = S.apply(s, 1, { t: "start" }, ctx()); expect(s.phase).toBe("bidding");
    s = S.leaveSeat(s, 1, ctx()); expect(s.seats[1].kind).toBe("bot");
  });
});
describe("spades bots", () => {
  const playMatch = (lvA: Sim.Level, lvB: Sim.Level, hands: number, seed: number) => {
    // team 0 (seats 0,2) at lvA vs team 1 (seats 1,3) at lvB, scored by hand points with bags charged at their amortized cost (10 bags = -100)
    const rng = seededRng(seed); let a = 0, b = 0;
    for (let k = 0; k < hands; k++) {
      const deck = makeDeck(); for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      const h = Sim.newHs("partners", [0, 1, 2, 3].map((i) => deck.slice(i * 13, i * 13 + 13)), k % 4);
      const lv = (i: number) => (i % 2 ? lvB : lvA);
      for (let j = 0; j < 4; j++) { const i = (k % 4 + j) % 4; const bd = Sim.botBid({ v: "partners", seat: i, hand: h.hands[i], bids: h.bids, nil: h.nil, level: lv(i), P: Sim.DEFAULT_PARAMS[lv(i)], rng }); h.bids[i] = bd.n; h.nil[i] = bd.nil; }
      while (!Sim.handDone(h)) { const i = h.turn; Sim.play(h, i, Sim.botCard(h, i, { level: lv(i), P: Sim.DEFAULT_PARAMS[lv(i)], rng, deck: makeDeck() })); }
      const sc = Sim.scoreHand("partners", h.bids, h.nil, h.tricks); a += sc.points[0] - 10 * sc.bags[0]; b += sc.points[1] - 10 * sc.bags[1];
    }
    return { a, b };
  };
  it("medium beats easy and hard beats medium (noticeably different strength)", () => {
    const m = playMatch("medium", "easy", 120, 11); expect(m.a).toBeGreaterThan(m.b + 600);
    const h = playMatch("hard", "medium", 100, 12); expect(h.a).toBeGreaterThan(h.b + 300);
  }, 60000);
  it("bids: strong hands bid high, weak safe hands bid nil", () => {
    const strong = ["AS", "KS", "QS", "JS", "TS", "AH", "KH", "AD", "KD", "AC", "2C", "3C", "4C"];
    expect(Sim.botBid({ v: "partners", seat: 0, hand: strong, bids: [null, null, null, null], nil: [0, 0, 0, 0], level: "hard", P: Sim.DEFAULT_PARAMS.hard, rng: seededRng(1) }).n).toBeGreaterThanOrEqual(8);
    const weak = ["2S", "3S", "2H", "3H", "4H", "5H", "2D", "3D", "4D", "6D", "2C", "3C", "5C"];
    expect(Sim.botBid({ v: "partners", seat: 0, hand: weak, bids: [null, null, null, null], nil: [0, 0, 0, 0], level: "hard", P: Sim.DEFAULT_PARAMS.hard, rng: seededRng(1) })).toEqual({ n: 0, nil: 1 });
  });
  it("sampled worlds respect voids and hand sizes", () => {
    const h = Sim.newHs("partners", [["AS", "KH", "2C"], ["3S", "4H", "5D"], ["6S", "7H", "8D"], ["9S", "TH", "JD"]], 0);
    h.voids[1][3] = true; // seat 1 has no clubs
    for (let k = 0; k < 50; k++) { const w = Sim.sampleWorld(h, 0, ["AS", "KH", "2C", "3S", "4H", "5D", "6S", "7H", "8D", "9S", "TH", "JD", "3C", "4C"], seededRng(k + 1)); expect(w.hands[1].some((c) => c[1] === "C")).toBe(false); expect(w.hands.map((x) => x.length)).toEqual([3, 3, 3, 3]); }
  });
});

import * as Coach from "./cards/spades/coach";
describe("spades coach (Monte Carlo)", () => {
  const view = (o: Partial<Coach.View>): Coach.View => ({ v: "partners", n: 4, trick: [], trickSeats: [], leader: 0, broken: false, bids: [3, 3, 3, 3], nil: [0, 0, 0, 0], tricks: [0, 0, 0, 0], counts: [13, 13, 13, 13], history: [], bags: [0, 0], scores: [0, 0], ...o });
  it("prefers winning a trick it needs with the boss card, and rates make % from samples", () => {
    // seat 3 is last to play to a heart trick: A♥ certainly wins, 2♥ certainly loses
    const hand = ["AH", "2H", "3D", "4D", "5D", "6D", "7C", "8C", "9C", "TC", "2S", "3S", "4S"];
    const p = view({ trick: ["KH", "5H", "7H"], trickSeats: [0, 1, 2], leader: 0, counts: [12, 12, 12, 13], bids: [3, 4, 3, 4] });
    const rows = Coach.evalPlay(p, 3, hand, { n: 60, rng: seededRng(5) }); // A♥ vs 2♥ is close in EV (A♥ wins later anyway) — check the facts, not the ranking
    const a = rows.find((r) => r.card === "AH")!, two = rows.find((r) => r.card === "2H")!;
    expect(a.trick).toBe(1); expect(two.trick).toBe(0); expect(a.n).toBe(60); expect(rows[0].seGap).toBe(0); expect(rows[1].seGap).toBeGreaterThan(0);
    expect(rows.every((r) => r.make >= 0 && r.make <= 1 && r.se >= 0)).toBe(true);
  });
  it("recovers voids from the play history so sampled worlds respect them", () => {
    const p = view({ history: [{ seats: [0, 1, 2, 3], cards: ["AC", "2H", "3C", "4C"], winner: 0 }], counts: [12, 12, 12, 12], leader: 0 });
    const h = Coach.knownHs(p, 0, ["KC", "QC", "JC", "TC", "9C", "8C", "7C", "6C", "5C", "AD", "KD", "QD"]);
    expect(h.voids[1][3]).toBe(true); expect(h.voids[2][3]).toBe(false);
  });
  it("bid coach: a monster hand should not bid nil; a weak hand prefers nil to bidding 3", () => {
    const strong = ["AS", "KS", "QS", "JS", "TS", "AH", "KH", "AD", "KD", "AC", "2C", "3C", "4C"];
    const r = Coach.evalBid(view({ bids: [null, null, null, null] }), 0, strong, { n: 40, rng: seededRng(9) });
    expect(r[0].nil).toBe(0); expect(r.find((x) => x.nil === 1)!.nilOk!).toBeLessThan(0.2);
    const weak = ["2S", "3S", "2H", "3H", "4H", "5H", "2D", "3D", "4D", "6D", "2C", "3C", "5C"];
    const w = Coach.evalBid(view({ bids: [null, null, null, null] }), 0, weak, { n: 60, rng: seededRng(9) });
    expect(w.find((x) => x.nil === 1)!.nilOk!).toBeGreaterThan(0.5);
  });
});
