import { describe, it, expect, afterEach } from "vitest";
import { seededRng, frameRec, makeDeck, shuffle } from "./cards/core.ts";
import * as BJ from "./cards/blackjack/engine.ts";
import * as SP from "./cards/spades/engine.ts";
import * as HT from "./cards/hearts/engine.ts";
import * as PK from "./cards/holdem/engine.ts";

const ctx = (seed = 1, now = 1000) => ({ rng: seededRng(seed), now });
const P = (n = "Ann", t = "tok-ann-000000000000", stack = 5000) => ({ name: n, tokenHash: t, stack });
/** Same recorder the edge function installs: a public snapshot per step. */
function record<V>(view: (s: never) => V) {
  const out: (V & Record<string, unknown>)[] = [];
  frameRec.on = (s, over) => { out.push(JSON.parse(JSON.stringify({ ...view(s as never), ...(over ?? {}) }))); };
  return out;
}
afterEach(() => { frameRec.on = null; });

describe("replay frames", () => {
  it("blackjack: bot moves, then the hole flips, then each dealer draw — the hole stays hidden until the flip", () => {
    for (let seed = 1; seed < 30; seed++) {
      let s = BJ.newTable({ seats: 3, botLevel: "hard", now: 0, rng: seededRng(seed), shoe: shuffle(makeDeck(6), seededRng(seed)) });
      s = BJ.seatHuman(s, 1, { name: "Ryan", tokenHash: "h1", stack: 1000 }, ctx());
      s = BJ.apply(s, 1, { t: "bet", amount: 10 }, ctx(seed));
      if (s.phase !== "play" || s.turn?.seat !== 1) continue;
      const f = record(BJ.publicView);
      const end = BJ.apply(s, 1, { t: "stand" }, ctx(seed));
      expect(end.phase).toBe("betting");
      const flip = f.findIndex((x) => !x.holeHidden);
      expect(flip).toBeGreaterThan(0);
      for (const x of f.slice(0, flip)) { expect(x.dealer[1]).toBeNull(); expect(x.results).toEqual(s.results); }
      // seat 2 (the bot after you) acts in frames before the flip, and dealer cards only ever grow by one per frame
      expect(f.slice(0, flip).some((x) => x.turn?.seat === 2)).toBe(true);
      for (let k = flip + 1; k < f.length; k++) expect(f[k].dealer.length - f[k - 1].dealer.length).toBe(1);
      expect(end.dealer.slice(0, f[f.length - 1].dealer.length)).toEqual(f[f.length - 1].dealer);
      return;
    }
    throw new Error("no seed reached the human's turn");
  });
  it("spades: every card into the trick is its own frame, and the full trick is shown before it's collected", () => {
    let s = SP.newTable({ seats: 4, botLevel: "medium", now: 0, rng: seededRng(5) });
    s = SP.seatHuman(s, 0, P(), ctx());
    for (let g = 0; g < 40 && s.phase !== "play"; g++) { s.seats[0].idle = -9999; s.deadline = 1; s = SP.timeout(s, ctx(g, 10)); }
    for (let g = 0; g < 10 && SP.actor(s) !== 0; g++) { s.deadline = 1; s = SP.timeout(s, ctx(g, 10)); }
    expect(SP.actor(s)).toBe(0);
    const f = record(SP.publicView);
    const card = (SP.privateView(s, 0)!.hand ?? []).find((c: string) => { try { SP.apply(s, 0, { t: "play", card: c }, ctx()); return true; } catch { return false; } })!;
    f.length = 0;
    SP.apply(s, 0, { t: "play", card }, ctx(3));
    const full = f.find((x) => x.trick.length === 4)!;
    expect(full).toBeTruthy();
    expect(full.trick).toContain(card);
    const sizes = f.map((x) => x.trick.length);
    for (let k = 1; k < sizes.length; k++) expect([sizes[k - 1] + 1, 0, 4]).toContain(sizes[k]);
    expect(JSON.stringify(f)).not.toContain("tok-ann");
  });
  it("hearts: frames per card with the full trick before collection", () => {
    let s = HT.newTable({ seats: 4, botLevel: "medium", now: 0, rng: seededRng(6) });
    s = HT.seatHuman(s, 0, P(), ctx());
    for (let g = 0; g < 60 && (s.phase !== "play" || HT.actor(s) !== 0); g++) { s.seats[0].idle = -9999; s.deadline = 1; s = HT.timeout(s, ctx(g, 10)); }
    const f = record(HT.publicView);
    s.seats[0].idle = -9999; s.deadline = 1; HT.timeout(s, ctx(2, 10)); // the human's timed-out card + bots after
    expect(f.some((x) => x.trick.length === 4)).toBe(true);
    expect(f.length).toBeGreaterThanOrEqual(2);
  });
  it("hold'em: one frame per action and per street; bot hole cards never appear before showdown", () => {
    let s = PK.newTable({ seats: 6, botLevel: "medium", now: 0, rng: seededRng(11) });
    s = PK.seatHuman(s, 0, P(), ctx());
    for (let g = 0; g < 20 && PK.actor(s) !== 0; g++) s = PK.apply(s, 0, { t: s.phase === "handover" ? "next" : "start" } as never, ctx(g));
    expect(PK.actor(s)).toBe(0);
    const holes = s.h!.holes.filter((_, i) => i !== 0).flat();
    const f = record(PK.publicView);
    const toCall = s.h!.maxBet - s.h!.bet[0];
    const end = PK.apply(s, 0, toCall > 0 ? { t: "call" } : { t: "check" }, ctx(4));
    expect(f.length).toBeGreaterThan(1);
    for (const x of f) {
      const { lastHand: _l, ...rest } = x; const j = JSON.stringify(rest);
      for (const c of holes) expect(j).not.toContain(`"${c}"`);
      expect(x.holes).toBeNull();
    }
    const endBoard = end.lastHand ? (end.lastHand as { board: string[] }).board : end.h!.board;
    for (const x of f) expect(endBoard.slice(0, x.board.length)).toEqual(x.board);
  });
});
