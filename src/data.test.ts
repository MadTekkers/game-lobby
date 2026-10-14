import { describe, it, expect } from "vitest";
import { puzzles, adjacent, key, spans, ROWS, COLS } from "./games/strandsLogic";
import { ANSWERS, score } from "./games/wordleLogic";
import conn from "./data/connections.json";
import guesses from "../public/wordle-guesses.json";

describe("Strands boards", () => {
  it("has several puzzles", () => expect(puzzles.length).toBeGreaterThanOrEqual(8));
  puzzles.forEach((p, i) => it(`#${i} ${p.theme} tiles the grid exactly`, () => {
    expect(p.grid.length).toBe(ROWS); p.grid.forEach((r) => expect(r.length).toBe(COLS));
    const all = [p.spangram, ...p.words]; expect(Object.keys(p.paths).sort()).toEqual([...all].sort());
    const used = new Set<string>();
    for (const w of all) {
      const path = p.paths[w]; expect(path.length).toBe(w.length);
      path.forEach((c, j) => { expect(p.grid[c[0]][c[1]]).toBe(w[j]); if (j) expect(adjacent(path[j - 1], c)).toBe(true); expect(used.has(key(c))).toBe(false); used.add(key(c)); });
    }
    expect(used.size).toBe(ROWS * COLS);
    expect(spans(p.paths[p.spangram])).toBe(true);
  }));
});
describe("Wordle", () => {
  const set = new Set(guesses as string[]);
  it("answers are unique, 5 letters, and valid guesses", () => { expect(new Set(ANSWERS).size).toBe(ANSWERS.length); ANSWERS.forEach((a) => { expect(a).toMatch(/^[a-z]{5}$/); expect(set.has(a)).toBe(true); }); });
  it("scores duplicates like NYT", () => { expect(score("speed", "abide")).toEqual(["absent", "absent", "present", "absent", "present"]); expect(score("eerie", "there")).toEqual(["present", "absent", "present", "absent", "correct"]); });
});
describe("Connections", () => {
  it("has many puzzles", () => expect(conn.length).toBeGreaterThanOrEqual(30));
  (conn as any[]).forEach((p) => it(`#${p.id} has 4 groups of 4 unique words, one per difficulty`, () => {
    expect(p.groups.length).toBe(4); expect(p.groups.map((g: any) => g.level).sort()).toEqual([0, 1, 2, 3]);
    const w = p.groups.flatMap((g: any) => g.words); expect(w.length).toBe(16); expect(new Set(w).size).toBe(16);
  }));
});
// @ts-ignore
import { makePuzzle } from "../scripts/connectionsGen.mjs";
describe("Connections runtime generator", () => {
  it("produces valid puzzles for the next 2 years of weeks", () => {
    for (let id = 61; id < 61 + 730; id++) { const p = makePuzzle(id); const w = p.groups.flatMap((g: any) => g.words); expect(new Set(w).size).toBe(16); expect(p.groups.map((g: any) => g.level).sort()).toEqual([0, 1, 2, 3]); }
  });
});
