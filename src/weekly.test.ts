import { describe, it, expect } from "vitest";
import guessList from "../public/wordle-guesses.json";
const mods = import.meta.glob("../puzzles/weekly/*.json", { eager: true, import: "default" }) as Record<string, any>;
const guesses = new Set(guessList as string[]);

describe("weekly snapshots", () => {
  it("has snapshots", () => expect(Object.keys(mods).length).toBeGreaterThanOrEqual(10));
  for (const [f, j] of Object.entries(mods)) it(f, () => {
    expect(new Date(j.week_start + "T12:00:00Z").getUTCDay()).toBe(1);
    expect(j.puzzles.length).toBe(49);
    for (const p of j.puzzles) {
      if (p.game === "wordle") expect(guesses.has(p.data.answer)).toBe(true);
      if (p.game === "connections") expect(new Set(p.data.groups.flatMap((g: any) => g.words)).size).toBe(16);
      if (p.game === "strands") for (const w of [...p.data.words, p.data.spangram]) expect(p.data.paths[w].map(([r, c]: number[]) => p.data.grid[r][c]).join("")).toBe(w);
      if (p.game === "bee") expect(p.data.pangrams.length).toBeGreaterThan(0);
      if (p.game === "mini") expect(p.data.grid.length).toBe(5);
    }
  });
});
