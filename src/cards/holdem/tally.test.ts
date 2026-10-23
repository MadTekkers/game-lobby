import { describe, it, expect } from "vitest";
import { currentScore, describeNow, tally, showdownOdds } from "./tally.ts";
import { evaluate } from "./eval.ts";
import { seededRng } from "../core.ts";

describe("hand tally", () => {
  it("describes pre-flop hands and orders them", () => {
    expect(describeNow(["QS", "QD"])).toBe("Pair of Queens");
    expect(describeNow(["AS", "7D"])).toBe("Ace-high");
    expect(currentScore(["QS", "QD"])).toBeGreaterThan(currentScore(["AS", "KD"]));
    expect(currentScore(["AS", "KD"])).toBeGreaterThan(currentScore(["AS", "QD"]));
  });
  it("matches the 5+ card evaluator", () => {
    const c = ["KS", "KD", "7H", "7C", "2S"]; expect(currentScore(c)).toBe(evaluate(c)); expect(describeNow(c)).toBe("Two pair, Kings and Sevens");
  });
  it("ranks the table with shared ranks for ties", () => {
    const t = tally({ 0: ["AS", "KD"], 2: ["QS", "QH"], 3: ["AH", "KC"] }, ["2D", "7S", "9C"]);
    expect(t.map((r) => r.seat)).toEqual([2, 0, 3]); expect(t.map((r) => r.rank)).toEqual([1, 2, 2]);
  });
  it("gives multiway showdown odds that sum to 1", () => {
    const rng = seededRng(7);
    const pre = showdownOdds({ 0: ["AS", "AD"], 1: ["7C", "2H"] }, [], 3000, rng);
    expect(pre.odds[0]).toBeGreaterThan(0.83); expect(pre.odds[0]).toBeLessThan(0.92); expect(pre.exact).toBe(false);
    const flop = showdownOdds({ 0: ["AS", "AD"], 1: ["KS", "KD"], 4: ["9H", "8H"] }, ["7H", "6H", "2C"], 0, rng);
    expect(flop.exact).toBe(true); expect(flop.n).toBe(903);
    expect(flop.odds[0] + flop.odds[1] + flop.odds[4]).toBeCloseTo(1, 6);
    const river = showdownOdds({ 0: ["AS", "AD"], 1: ["KS", "KD"] }, ["AH", "KH", "2C", "3D", "9S"], 0, rng);
    expect(river.odds[0]).toBe(1);
  });
});
