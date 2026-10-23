import { describe, it, expect } from "vitest";
import { hiLoTag, runningCount, trueCount, decksLeft, betUnits, indexPlay } from "./count.ts";

describe("Hi-Lo count", () => {
  it("tags cards", () => {
    expect(["2S", "6H", "7D", "9C", "TS", "KD", "AH"].map(hiLoTag)).toEqual([1, 1, 0, 0, -1, -1, -1]);
  });
  it("a full deck sums to zero", () => {
    let s = 0; for (const r of "23456789TJQKA") for (const u of "SHDC") s += hiLoTag(r + u); expect(s).toBe(0);
  });
  it("adds visible table cards to the server tally, skipping the hidden hole card", () => {
    const pub = { rcPrev: 3, seats: [{ hands: [{ cards: ["5S", "6D"] }] }, { hands: [{ cards: ["KS", "8D"] }] }], dealer: ["4H", null] };
    expect(runningCount(pub).rc).toBe(3 + 2 - 1 + 1);
  });
  it("converts to a true count", () => {
    expect(decksLeft(156)).toBe(3); expect(trueCount(7, 156)).toBe(2); expect(trueCount(-7, 156)).toBe(-2); expect(trueCount(4, 20)).toBe(8);
    expect(betUnits(0)).toBe(1); expect(betUnits(3)).toBe(4); expect(betUnits(9)).toBe(8);
  });
  it("finds index plays", () => {
    expect(indexPlay(["TS", "6D"], "KH", 0)).toMatchObject({ label: "16 vs 10", on: true, play: "stand" });
    expect(indexPlay(["TS", "6D"], "KH", -1)?.on).toBe(false);
    expect(indexPlay(["TS", "QD"], "6H", 4)).toMatchObject({ label: "10,10 vs 6", on: true });
    expect(indexPlay(["9S", "3D"], "4H", 1)).toMatchObject({ label: "12 vs 4", on: false });
    expect(indexPlay(["9S", "3D"], "4H", -1)?.on).toBe(true);
    expect(indexPlay(["TS", "6D"], "AH", 3, true)).toMatchObject({ label: "Insurance", on: true });
    expect(indexPlay(["AS", "5D"], "KH", 0)).toBeNull();
  });
});
