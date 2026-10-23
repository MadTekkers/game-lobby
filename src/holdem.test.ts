import { describe, it, expect } from "vitest";
import { seededRng, shuffle, makeDeck, type Card } from "./cards/core";
import { evaluate, describe as desc, category } from "./cards/holdem/eval";
import * as E from "./cards/holdem/engine";
import * as Sim from "./cards/holdem/sim";

const ctx = (seed = 1, now = 1000) => ({ rng: seededRng(seed), now });
const P = (n = "Ann", t = "tok-ann-000000000000", stack = 5000) => ({ name: n, tokenHash: t, stack });
const ev = (s: string) => evaluate(s.split(" "));

describe("hand ranking", () => {
  it("orders every category", () => {
    const ladder = ["2S 4D 6H 8C TS 3D 9H", "2S 2D 6H 8C TS 3D 9H", "2S 2D 6H 6C TS 3D 9H", "2S 2D 2H 8C TS 3D 9H", "2S 3D 4H 5C 6S KD 9H",
      "2H 5H 9H JH KH 3D 4C", "2S 2D 2H 8C 8S 3D 9H", "2S 2D 2H 2C TS 3D 9H", "5S 6S 7S 8S 9S 2D 2H"];
    const sc = ladder.map(ev); expect(sc.map(category)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < sc.length; i++) expect(sc[i]).toBeGreaterThan(sc[i - 1]);
  });
  it("kickers, wheel, board plays, best five of seven", () => {
    expect(ev("AS AD KH 7C 5S 3D 2H")).toBeGreaterThan(ev("AC AH QH 7D 5C 3S 2C")); // kicker K > Q
    expect(ev("AS 2D 3H 4C 5S KD KH")).toBeLessThan(ev("2S 3D 4H 5C 6S KD KH")); // wheel is five-high
    expect(desc(ev("AS 2D 3H 4C 5S KD 9H"))).toBe("Straight, Five-high");
    expect(ev("2C 3D AS KS QS JS TS")).toBe(ev("7H 8H AS KS QS JS TS")); // board royal: split
    expect(desc(ev("AS KS QS JS TS 2D 3H"))).toBe("Royal flush");
    expect(ev("KS KD 9H 9C 4S 4D AH")).toBe(ev("KH KC 9S 9D 2S 3C AD")); // two pair: third pair irrelevant, ace kicker
    expect(ev("8S 8D 8H 5C 5S 5D AH")).toBe(ev("8C 8D 8H 5C 5S 2D 3H")); // 888 55: second trips counts as the pair
    expect(desc(ev("8S 8D 8H 5C 5S 5D AH"))).toBe("Full house, Eights over Fives");
    expect(ev("AH 9H 7H 4H 2H 3C 3D")).toBeGreaterThan(ev("KH QH JH 9H 7H 3C 3D")); // flush by high card
    expect(ev("JS JD 4C 4H 3S 3D 9H")).toBe(ev("JS JD 4C 4H 9S 2D 2H")); // two pair kicker 9 in both
  });
  it("random 7-card hands rank identically to a brute-force best-of-21", () => {
    const rng = seededRng(9); const combos = (a: Card[]) => { const o: Card[][] = []; for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) o.push(a.filter((_, k) => k !== i && k !== j)); return o; };
    for (let t = 0; t < 400; t++) { const c = shuffle(makeDeck(), rng).slice(0, 7); expect(evaluate(c)).toBe(Math.max(...combos(c).map((x) => evaluate(x)))); }
  });
  it("Monte Carlo equity is sane (AA vs random ≈ 85%, sample size reported)", () => {
    const r = Sim.equity(["AS", "AD"], [], [null], 3000, seededRng(3)); expect(r.n).toBe(3000); expect(r.eq).toBeGreaterThan(0.82); expect(r.eq).toBeLessThan(0.88);
    expect(Sim.equityVsKnown(["AS", "AD"], ["KS", "7D", "2C", "3H"], [["KD", "KH"]], 0, seededRng(1))).toBeCloseTo(2 / 44, 6); // AA vs a set: two aces left in 44 rivers
  });
  it("Chen formula reference values", () => {
    expect(Sim.chen(["AS", "AD"])).toBe(20); expect(Sim.chen(["AS", "KS"])).toBe(12); expect(Sim.chen(["7S", "2D"])).toBe(-1); expect(Sim.chen(["5S", "5D"])).toBe(5); expect(Sim.chen(["JS", "TS"])).toBe(9);
  });
});

describe("pots and betting", () => {
  it("side pots by contribution level", () => {
    // A all-in 50, B all-in 200, C calls 200 and bets more uncalled → 3 pots + refund level
    const pots = E.buildPots([50, 200, 300, 20], [false, false, false, true], [true, true, true, true]);
    expect(pots).toEqual([{ amount: 170, eligible: [0, 1, 2] }, { amount: 300, eligible: [1, 2] }, { amount: 100, eligible: [2] }]);
  });
  it("blinds, heads-up order, min-raise, chip conservation", () => {
    let s = E.newTable({ seats: 2, botLevel: "medium", now: 0, rng: seededRng(4) });
    s = E.seatHuman(s, 0, P(), ctx());
    // solo table deals immediately; heads-up: button = SB acts first preflop
    expect(s.phase).toBe("betting"); const h = s.h!;
    expect(h.sbSeat).toBe(s.button); expect(h.bet[h.sbSeat]).toBe(5); expect(h.bet[h.bbSeat]).toBe(10);
    if (E.actor(s) === 0) {
      expect(() => E.apply(s, 0, { t: "raise", to: 15 }, ctx())).toThrow(/Minimum/);
      expect(() => E.apply(s, 0, { t: "check" }, ctx())).toThrow();
    }
    for (let g = 0; g < 50 && s.phase === "betting"; g++) s = E.apply(s, 0, E.actor(s) === 0 && s.h!.maxBet > s.h!.bet[0] ? { t: "call" } : { t: "check" }, ctx(g));
    expect(s.phase).toBe("handover"); expect(s.seats[0].chips + s.seats[1].chips).toBe(1000 + 1000);
    expect(s.ledger.length).toBe(s.lastHand!.net[0] ? 1 : 0); expect(s.results.length).toBe(1);
  });
  it("short all-in doesn't reopen betting", () => {
    let s = E.newTable({ seats: 3, botLevel: "medium", now: 0, rng: seededRng(8) });
    s = E.seatHuman(s, 0, P(), ctx()); s = E.seatHuman(s, 1, P("Bob", "tok-bob-000000000000"), ctx());
    s.live = true; s.phase = "waiting"; s.h = null; s.seats[2] = { ...s.seats[2], kind: "human", name: "Cy", tokenHash: "tok-cy", chips: 1000 } as typeof s.seats[2];
    s.button = 2; // next hand: button 0, SB 1, BB 2, seat 0 first
    s = E.apply(s, 0, { t: "start" }, ctx());
    expect(s.button).toBe(0); expect(E.actor(s)).toBe(0);
    s.seats[2].chips = 45; // BB has 45 behind (55 total)
    s = E.apply(s, 0, { t: "raise", to: 40 }, ctx());
    s = E.apply(s, 1, { t: "call" }, ctx());
    s = E.apply(s, 2, { t: "raise", to: 55 }, ctx()); // all-in, raise of 15 < 30: not a full raise
    expect(s.h!.allIn[2]).toBe(true);
    expect(() => E.apply(s, 0, { t: "raise", to: 200 }, ctx())).toThrow(/reopened/);
    s = E.apply(s, 0, { t: "call" }, ctx()); s = E.apply(s, 1, { t: "call" }, ctx());
    expect(s.h!.street).toBe(1); expect(E.potTotal(s.h!)).toBe(165);
  });
  it("all-in run-out with side pots awards correctly and conserves chips", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = E.newTable({ seats: 4, botLevel: "hard", now: 0, rng: seededRng(seed) });
      s.seats.forEach((x, i) => (x.chips = [100, 300, 700, 1000][i]));
      const total = () => s.seats.reduce((a, x) => a + x.chips, 0); const before = total();
      s = E.botsHand(s, ctx(seed), undefined);
      expect(s.phase).toBe("handover"); expect(total()).toBe(before);
      for (const p of s.lastHand!.pots) for (const w of p.winners) expect(p.eligible).toContain(w);
    }
  });
});

describe("table", () => {
  it("full solo sessions at 2, 6 and 8 seats: no leaks, results each hand", () => {
    for (const [n, lv] of [[2, "easy"], [6, "medium"], [8, "hard"]] as const) {
      let s = E.newTable({ seats: n, botLevel: lv, now: 0, rng: seededRng(n) }); s = E.seatHuman(s, 0, P(), ctx());
      let hands = 0;
      for (let g = 0; g < 400 && hands < 12; g++) {
        if (s.phase === "handover") { hands++; if (s.seats[0].chips < s.bb) s = E.apply(s, 0, { t: "rebuy" }, ctx(g)); s = E.apply(s, 0, { t: "next" }, ctx(g)); continue; }
        const pv = E.publicView(s); const str = JSON.stringify({ ...pv, lastHand: null, results: null }); // lastHand/results describe the previous, finished hand
        if (s.h) for (let i = 1; i < n; i++) if (s.h.inHand[i]) for (const c of s.h.holes[i]) expect(str.includes(`"${c}"`)).toBe(false);
        expect(str).not.toContain("tok-ann"); expect(str).not.toContain("deck");
        expect(E.privateView(s, 0)!.hole.length).toBe(s.h?.inHand[0] ? 2 : 0);
        const a = E.actor(s); expect(a).toBe(0);
        const h = s.h!; const r = seededRng(g)();
        s = E.apply(s, 0, h.maxBet > h.bet[0] ? (r < 0.5 ? { t: "call" } : r < 0.8 ? { t: "fold" } : { t: "raise", to: Math.min(h.bet[0] + s.seats[0].chips, h.maxBet + h.lastRaise) }) : { t: "check" }, ctx(g));
      }
      expect(hands).toBeGreaterThanOrEqual(12);
    }
  });
  it("tutorial shows all hole cards; private view only mine", () => {
    let s = E.newTable({ seats: 3, botLevel: "medium", now: 0, rng: seededRng(2), tutorial: true }); s = E.seatHuman(s, 0, P(), ctx());
    expect(E.publicView(s).holes!.filter((x) => x.length === 2).length).toBe(3);
    let t = E.newTable({ seats: 3, botLevel: "medium", now: 0, rng: seededRng(2) }); t = E.seatHuman(t, 0, P(), ctx());
    expect(E.publicView(t).holes).toBeNull();
  });
  it("bot levels: hard > medium > easy over heads-up duplicate matches", async () => {
    const { duplicate } = await import("./cards/holdem/tune");
    const r = seededRng(77);
    const mVsE = duplicate("medium", "easy", 800, r); const hVsM = duplicate("hard", "medium", 1500, r);
    console.log(`holdem edge bb/hand: medium vs easy ${mVsE.toFixed(2)}, hard vs medium ${hVsM.toFixed(2)}`);
    expect(mVsE).toBeGreaterThan(0); expect(hVsM).toBeGreaterThan(0);
  }, 120000);
});
