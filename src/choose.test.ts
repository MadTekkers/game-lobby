import { describe, it, expect } from "vitest";
import { choose } from "./lib/choose";
describe("next-puzzle picker", () => {
  it("prefers puzzles nobody in the room has played", () => {
    for (let k = 0; k < 50; k++) expect([3, 4]).toContain(choose([0, 1, 2, 3, 4], 0, [{ 1: 5 }, { 2: 9 }]));
  });
  it("falls back to the oldest-played, never the current one", () => {
    expect(choose([0, 1, 2], 0, [{ 1: 50, 2: 10 }, { 1: 20 }])).toBe(2);
  });
});
