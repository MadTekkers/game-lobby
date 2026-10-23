import { describe, it, expect } from "vitest";
import { makeDeck, seededRng, shuffle, IllegalMove, type Card } from "./cards/core.ts";
import { handValue, isBlackjack, basicStrategy } from "./cards/blackjack/strategy.ts";
import { newTable, apply, seatHuman, leaveSeat, timeout, publicView, legalMoves, type BJState } from "./cards/blackjack/engine.ts";
import { evaluate, composition, sampleOnce } from "./cards/blackjack/sim.ts";

const ctx = (now = 1000) => ({ rng: seededRng(7), now });
const filler = (n = 300) => shuffle(makeDeck(6), seededRng(99)).slice(0, n);
/** 1 human (seat 0) + 1 bot (seat 1). Deal order: s0, s1, dealer up, s0, s1, dealer hole, then hits. */
function table(prefix: Card[], seats = 2): BJState {
  let s = newTable({ seats, botLevel: "hard", now: 0, rng: seededRng(1), shoe: [...prefix, ...filler()] });
  s = seatHuman(s, 0, { name: "Ryan", tokenHash: "h1", stack: 1000 }, ctx());
  return s;
}

describe("hand values & strategy", () => {
  it("counts soft and hard totals", () => {
    expect(handValue(["AS", "6H"])).toEqual({ total: 17, soft: true });
    expect(handValue(["AS", "6H", "TD"])).toEqual({ total: 17, soft: false });
    expect(handValue(["AS", "AH", "9D"])).toEqual({ total: 21, soft: true });
    expect(isBlackjack(["AS", "KH"])).toBe(true);
    expect(isBlackjack(["AS", "KH"], true)).toBe(false);
  });
  it("matches the S17 / DAS basic strategy chart", () => {
    const B = (c: string[], up: string, d = true, p = true) => basicStrategy(c, up, d, p);
    expect(B(["TS", "6H"], "TD")).toBe("hit");
    expect(B(["TS", "6H"], "6D")).toBe("stand");
    expect(B(["TS", "2H"], "4D")).toBe("stand");
    expect(B(["TS", "2H"], "3D")).toBe("hit");
    expect(B(["5S", "6H"], "6D")).toBe("double");
    expect(B(["5S", "6H"], "AD")).toBe("hit");
    expect(B(["AS", "7H"], "2D")).toBe("stand");
    expect(B(["AS", "7H"], "9D")).toBe("hit");
    expect(B(["AS", "7H"], "4D")).toBe("double");
    expect(B(["AS", "4H", "3C"], "4D", false)).toBe("stand"); // soft 18, can't double -> stand
    expect(B(["8S", "8H"], "TD")).toBe("split");
    expect(B(["AS", "AH"], "AD")).toBe("split");
    expect(B(["TS", "KH"], "6D")).toBe("stand");
    expect(B(["9S", "9H"], "7D")).toBe("stand");
    expect(B(["9S", "9H"], "8D")).toBe("split");
    expect(B(["5S", "5H"], "6D")).toBe("double");
    expect(B(["8S", "8H"], "TD", true, false)).toBe("hit");
  });
});

describe("blackjack engine", () => {
  it("pays a natural 3:2 and records ledger", () => {
    let s = table(["AS", "9C", "7D", "KH", "9H", "TC"]);
    s = apply(s, 0, { t: "bet", amount: 100 }, ctx());
    // bot (hard) also bet; hand settles once the bot stands on 18 and dealer stands on 17
    expect(s.phase).toBe("betting");
    const r = s.results.find((x) => x.seat === 0)!;
    expect(r.hands[0].result).toBe("blackjack");
    expect(r.net).toBe(150);
    expect(s.seats[0].stack).toBe(1150);
    expect(s.ledger.map((l) => l.delta)).toEqual([-100, 250]);
  });
  it("dealer blackjack (ten up) settles immediately", () => {
    let s = table(["TS", "9C", "KD", "KH", "9H", "AC"]);
    s = apply(s, 0, { t: "bet", amount: 50 }, ctx());
    expect(s.results[0].hands[0].result).toBe("lose");
    expect(s.seats[0].stack).toBe(950);
  });
  it("offers insurance on an ace and pays 2:1", () => {
    let s = table(["TS", "9C", "AD", "KH", "9H", "QC"]);
    s = apply(s, 0, { t: "bet", amount: 100 }, ctx());
    expect(s.phase).toBe("insurance");
    expect(publicView(s).dealer).toEqual(["AD", null]);
    s = apply(s, 0, { t: "insurance", take: true }, ctx());
    expect(s.results[0].net).toBe(0); // lose 100, win 2*50
    expect(s.seats[0].stack).toBe(1000);
  });
  it("splits, doubles after split, dealer hits 16 and stands on soft 17", () => {
    // s0: 8,8  bot: T,T  dealer: 6 up, T hole ; split hands get 3 and T ; hand1 doubles gets 9? -> 8,3 double +T=21
    let s = table(["8S", "TC", "6D", "8H", "TH", "TS", "3C", "TD", "TC", "5S"]);
    s = apply(s, 0, { t: "bet", amount: 100 }, ctx());
    expect(legalMoves(s, 0)).toContain("split");
    s = apply(s, 0, { t: "split" }, ctx());
    expect(s.seats[0].hands.map((h) => h.cards)).toEqual([["8S", "3C"], ["8H", "TD"]]);
    s = apply(s, 0, { t: "double" }, ctx()); // 8,3 + T = 21
    expect(s.seats[0].hands[0].cards).toEqual(["8S", "3C", "TC"]);
    s = apply(s, 0, { t: "stand" }, ctx()); // 18
    // bot stands on 20; dealer 6+T=16 hits 5 -> 21
    expect(s.dealer).toEqual(["6D", "TS", "5S"]);
    const r = s.results.find((x) => x.seat === 0)!;
    expect(r.hands.map((h) => h.result)).toEqual(["push", "lose"]);
    expect(r.net).toBe(-100);
    expect(s.seats[0].stack).toBe(900);
  });
  it("dealer stands on soft 17", () => {
    let s = table(["TS", "TC", "6D", "8H", "TH", "AS"]);
    s = apply(s, 0, { t: "bet", amount: 10 }, ctx());
    s = apply(s, 0, { t: "stand" }, ctx());
    expect(s.dealer).toEqual(["6D", "AS"]);
    expect(s.results[0].hands[0].result).toBe("win");
  });
  it("split aces get one card each and 21 is not a blackjack", () => {
    let s = table(["AS", "TC", "6D", "AH", "TH", "TS", "KC", "9D"]);
    s = apply(s, 0, { t: "bet", amount: 10 }, ctx());
    s = apply(s, 0, { t: "split" }, ctx());
    const r = s.results.find((x) => x.seat === 0)!;
    expect(r.hands.map((h) => h.cards.length)).toEqual([2, 2]);
    expect(r.hands[0].result).toBe("win"); // 21 vs dealer 16 -> draws
    expect(r.hands[0].net).toBe(10); // even money, not 3:2
  });
  it("rejects illegal moves", () => {
    let s = table(["TS", "9C", "7D", "6H", "9H", "TC"]);
    expect(() => apply(s, 0, { t: "hit" }, ctx())).toThrow(IllegalMove);
    expect(() => apply(s, 0, { t: "bet", amount: 5 }, ctx())).toThrow(IllegalMove);
    expect(() => apply(s, 0, { t: "bet", amount: 5000 }, ctx())).toThrow(IllegalMove);
    s = apply(s, 0, { t: "bet", amount: 10 }, ctx());
    expect(() => apply(s, 1, { t: "hit" }, ctx())).toThrow(IllegalMove);
    expect(() => apply(s, 0, { t: "split" }, ctx())).toThrow(IllegalMove);
  });
  it("public view never contains the shoe, hole card or tokens", () => {
    let s = table(["TS", "9C", "7D", "6H", "9H", "QC"]);
    s = apply(s, 0, { t: "bet", amount: 10 }, ctx());
    expect(s.phase).toBe("play");
    const v = JSON.stringify(publicView(s));
    expect(v).not.toContain("shoe\"");
    expect(v).not.toContain("h1");
    expect(publicView(s).dealer).toEqual(["7D", null]);
    expect(v).not.toContain("tokenHash");
  });
  it("a joining human waits for the hand to end; a leaving human becomes a bot", () => {
    let s = table(["TS", "9C", "7D", "6H", "9H", "QC"]);
    s = apply(s, 0, { t: "bet", amount: 10 }, ctx());
    s = seatHuman(s, 1, { name: "Ana", tokenHash: "h2", stack: 500 }, ctx());
    expect(s.seats[1].kind).toBe("bot");
    s = apply(s, 0, { t: "stand" }, ctx());
    expect(s.seats[1]).toMatchObject({ kind: "human", name: "Ana", stack: 500 });
    s = leaveSeat(s, 1, ctx());
    expect(s.seats[1].kind).toBe("bot");
  });
  it("times out idle humans: stand, then sit out, then hand the seat to a bot", () => {
    let s = table(["TS", "9C", "7D", "6H", "9H", "QC"]);
    s = seatHuman(s, 1, { name: "Ana", tokenHash: "h2", stack: 500 }, ctx());
    s = apply(s, 0, { t: "bet", amount: 10 }, ctx(0));
    expect(s.deadline).toBe(30000);
    s = timeout(s, ctx(31000)); // Ana never bet -> sits out, hand deals for Ryan
    expect(s.phase).toBe("play");
    s = timeout(s, ctx(62000)); // Ryan stands by default
    expect(s.phase).toBe("betting");
    for (let k = 0; k < 2; k++) { s = apply(s, 0, { t: "bet", amount: 10 }, ctx(100000 * (k + 1))); s = timeout(s, ctx(100000 * (k + 1) + 31000)); while (s.phase === "play") s = s.deadline ? timeout(s, ctx(s.deadline + 1)) : apply(s, 0, { t: "stand" }, ctx()); }
    expect(s.seats[1].kind).toBe("bot");
  });
  it("fuzz: 800 hands with 4 seats conserve chips and never break", () => {
    const rng = seededRng(42);
    let s = newTable({ seats: 4, botLevel: "easy", now: 0, rng });
    s = seatHuman(s, 2, { name: "Ryan", tokenHash: "h", stack: 1000 }, { rng, now: 0 });
    let ledger = 0;
    for (let k = 0; k < 800; k++) {
      if (s.seats[2].stack < 60) { s.seats[2].stack += 1000; ledger += 1000; }
      s = apply(s, 2, { t: "bet", amount: 10 + Math.floor(rng() * 50) }, { rng, now: k });
      let g = 0;
      while (s.phase !== "betting" && g++ < 20) {
        const L = legalMoves(s, 2);
        if (L.includes("insurance")) s = apply(s, 2, { t: "insurance", take: rng() < 0.5 }, { rng, now: k });
        else { const m = L[Math.floor(rng() * L.length)] as "hit"; s = apply(s, 2, { t: m }, { rng, now: k }); }
      }
      expect(s.phase).toBe("betting");
      const net = s.ledger.reduce((a, l) => a + l.delta, 0);
      expect(s.seats[2].stack).toBe(1000 + ledger + net);
      expect(s.shoe.length).toBeGreaterThan(0);
    }
  }, 30000);
});

describe("train-mode Monte Carlo", () => {
  const rng = seededRng(5);
  it("composition removes visible cards", () => {
    const c = composition(["AS", "TD", "KH", null]);
    expect(c[11]).toBe(23); expect(c[10]).toBe(94);
  });
  it("ranks doubling 11 vs 6 first and standing 20 vs 6 first, with sane numbers", () => {
    const a = evaluate({ cards: ["5S", "6H"], dealerUp: "6D", seen: ["5S", "6H", "6D"], legal: ["hit", "stand", "double"], n: 8000, rng });
    expect(a[0].action).toBe("double");
    expect(a[0].ev).toBeGreaterThan(0.4);
    expect(a.find((r) => r.action === "stand")!.ev).toBeLessThan(-0.05);
    for (const r of a) { expect(r.win + r.push + r.lose).toBeCloseTo(1, 6); expect(r.n).toBe(8000); }
    const b = evaluate({ cards: ["TS", "KH"], dealerUp: "6D", seen: ["TS", "KH", "6D"], legal: ["hit", "stand", "double", "split"], n: 5000, rng });
    expect(b[0].action).toBe("stand");
    expect(b[0].ev).toBeGreaterThan(0.55);
    expect(b[0].dealerBust).toBeGreaterThan(0.35);
  });
  it("splits 8s vs 10 over hitting/standing 16", () => {
    const r = evaluate({ cards: ["8S", "8H"], dealerUp: "TD", seen: ["8S", "8H", "TD"], legal: ["hit", "stand", "split"], n: 20000, rng });
    expect(r[0].action).toBe("split");
  });
  it("insurance is negative EV off the top", () => {
    const r = evaluate({ cards: ["TS", "9H"], dealerUp: "AD", seen: ["TS", "9H", "AD"], legal: [], insurancePhase: true, n: 20000, rng });
    expect(r[0].action).toBe("noinsure");
    expect(r[1].ev).toBeLessThan(-0.02);
  });
  it("sampleOnce keeps the known cards", () => {
    const x = sampleOnce({ cards: ["TS", "6H"], dealerUp: "9D", seen: [], legal: ["hit"], rng }, "hit", rng);
    expect(x.hands[0].slice(0, 2)).toEqual(["TS", "6H"]);
    expect(x.dealer[0]).toBe("9D");
  });
});
