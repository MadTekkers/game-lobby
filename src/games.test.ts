import { describe, it, expect } from "vitest";
import { CROSSWORDS, BEES, wordScore } from "./games/puzzleData";
import medium from "./data/connections-medium.json";
import hard from "./data/connections-hard.json";

describe("Crosswords", () => {
  for (const [key, list] of Object.entries(CROSSWORDS)) list.forEach((cw, i) => it(`${key} #${i} is consistent`, () => {
    const n = cw.size; expect(cw.grid.length).toBe(n);
    const covered = new Set<number>(); const answers = new Set<string>();
    const check = (e: any, dr: number, dc: number) => {
      expect(e.answer.length).toBeGreaterThanOrEqual(3);
      expect(answers.has(e.answer)).toBe(false); answers.add(e.answer);
      expect(e.clue.toLowerCase()).not.toContain(e.answer.toLowerCase());
      for (let k = 0; k < e.answer.length; k++) { const r = e.row + dr * k, c = e.col + dc * k; expect(cw.grid[r][c]).toBe(e.answer[k]); covered.add(r * n + c); }
      const br = e.row - dr, bc = e.col - dc; if (br >= 0 && bc >= 0) expect(cw.grid[br][bc]).toBe("#");
      const ar = e.row + dr * e.answer.length, ac = e.col + dc * e.answer.length; if (ar < n && ac < n) expect(cw.grid[ar][ac]).toBe("#");
    };
    cw.across.forEach((e) => check(e, 0, 1)); cw.down.forEach((e) => check(e, 1, 0));
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      expect(cw.grid[r][c] === "#").toBe(cw.grid[n - 1 - r][n - 1 - c] === "#"); // 180° symmetry
      if (cw.grid[r][c] !== "#") expect(covered.has(r * n + c)).toBe(true);
    }
  }));
  it("has every size/difficulty bucket", () => { for (const s of ["mini", "5", "10", "30"]) for (const d of ["easy", "medium", "hard"]) expect(CROSSWORDS[`${s}-${d}`]?.length).toBeGreaterThanOrEqual(3); });
});
describe("Spelling Bee", () => {
  BEES.forEach((b, i) => it(`#${i} valid`, () => {
    const L = new Set([b.center, ...b.outer]); expect(L.size).toBe(7);
    expect(b.pangrams.length).toBeGreaterThan(0);
    for (const w of b.answers) { expect(w.length).toBeGreaterThanOrEqual(4); expect(w).toContain(b.center); for (const c of w) expect(L.has(c)).toBe(true); }
    expect(b.answers.reduce((a, w) => a + wordScore(w), 0)).toBe(b.max);
  }));
});
describe("Connections medium/hard", () => {
  [...(medium as any[]), ...(hard as any[])].forEach((p, i) => it(`#${i} 4x4 unique`, () => {
    const w = p.groups.flatMap((g: any) => g.words); expect(new Set(w).size).toBe(16); expect(p.groups.map((g: any) => g.level).sort()).toEqual([0, 1, 2, 3]);
  }));
});
