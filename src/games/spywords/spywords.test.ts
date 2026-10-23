import { describe, it, expect } from "vitest";
import { SPY_WORDS } from "./words";
import { clueProblem } from "./rules";
import sql from "../../../supabase/migrations/20261023150100_spywords_words.sql?raw";

describe("Spy Words", () => {
  it("has 400+ unique single A–Z words that fit a tile", () => {
    expect(SPY_WORDS.length).toBeGreaterThanOrEqual(400);
    expect(new Set(SPY_WORDS).size).toBe(SPY_WORDS.length);
    for (const w of SPY_WORDS) expect(w).toMatch(/^[A-Z]{2,10}$/);
  });
  it("seed migration matches the bundled list", () => {
    const seeded = [...sql.matchAll(/\('([A-Z]+)'\)/g)].map((m) => m[1]);
    expect(seeded.sort()).toEqual([...SPY_WORDS].sort());
  });
  it("validates clues", () => {
    const board = ["APPLE", "DOG", "BOX"];
    expect(clueProblem("fruit", board)).toBeNull();
    expect(clueProblem("apple", board)).not.toBeNull();
    expect(clueProblem("dogs", board)).not.toBeNull();
    expect(clueProblem("boxes", board)).not.toBeNull();
    expect(clueProblem("ice cream", board)).not.toBeNull();
    expect(clueProblem("t-rex", board)).not.toBeNull();
  });
});
