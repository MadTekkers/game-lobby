import { describe, it, expect } from "vitest";
// @ts-ignore - plain JS generator shared with scripts/
import { BANK, validate2, countSolutions, herringsOf, patternOf } from "../scripts/weekly/connectionsGen2.mjs";
// @ts-ignore
import { weekCtx, genSlot, HIDDEN_PER_WEEK } from "../scripts/weekly/connectionsWeek.mjs";
// @ts-ignore
import { WORDPLAY } from "../scripts/weekly/connectionsTypes.mjs";
import medium from "./data/connections-medium.json";
import hard from "./data/connections-hard.json";

const mods = import.meta.glob("../puzzles/weekly/*.json", { eager: true, import: "default" }) as Record<string, any>;
const rng = (s: number) => () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
type P = { gen?: number; groups: { level: number; category: string; words: string[]; type?: string }[] };

describe("connections v2 bank", () => {
  it("categories are well formed and unique", () => {
    const names = new Set<string>();
    for (const b of BANK as any[]) { expect(b.w.length).toBeGreaterThanOrEqual(4); for (const w of b.w) expect(w).toMatch(/^[A-Z]+$/); expect(names.has(b.c)).toBe(false); names.add(b.c); }
    expect(names.size).toBeGreaterThan(200);
  });
  it("uniqueness solver", () => {
    const cats = [{ set: new Set(["A", "B", "C", "D", "E"]) }, { set: new Set(["E", "F", "G", "H"]) }];
    expect(countSolutions(["A", "B", "C", "D", "E", "F", "G", "H"], cats)).toBe(1);
    expect(countSolutions(["A", "B", "C", "D", "E", "F", "G", "H"], [{ set: new Set(["A", "B", "C", "D", "E", "F"]) }, { set: new Set(["C", "D", "E", "F", "G", "H"]) }])).toBe(2);
  });
});

describe("connections v2 weekly quotas (3 simulated weeks)", () => {
  const fps: Record<string, Set<string>> = { easy: new Set(), medium: new Set(), hard: new Set() }; const groups = new Set<string>();
  for (let w = 0; w < 3; w++) it(`week ${w}`, () => {
    const wc = weekCtx([]); const r = rng(42 + w); const ps: [string, P][] = [];
    for (const d of ["easy", "medium", "hard"]) for (let day = 0; day < 7; day++) ps.push([d, genSlot(d, 777 + w * 100 + day * 3 + d.length, wc, fps[d], groups, r).data]);
    let hidden = 0; const cats = new Set<string>(); const pats: Record<string, Set<string>> = { easy: new Set(), medium: new Set(), hard: new Set() };
    for (const [d, p] of ps) {
      expect(validate2(p, d)).toBe(true);
      const ts = p.groups.map((g) => g.type!);
      expect(ts.filter((t) => WORDPLAY.has(t)).length).toBeLessThanOrEqual(d === "easy" ? 0 : 1);
      if (ts.includes("hidden")) hidden++;
      const pat = patternOf(ts); expect(pats[d].has(pat)).toBe(false); pats[d].add(pat);
      for (const g of p.groups) { expect(cats.has(g.category)).toBe(false); cats.add(g.category); }
      const catObjs = p.groups.map((g) => (BANK as any[]).find((b) => b.c === g.category));
      expect(herringsOf(p.groups, catObjs).length).toBeGreaterThanOrEqual(d === "hard" ? 2 : d === "medium" ? 1 : 0);
    }
    expect(hidden).toBeLessThanOrEqual(HIDDEN_PER_WEEK);
  });
});

describe("bundled classic medium/hard are v2 and within quotas", () => {
  for (const [d, list] of [["medium", medium], ["hard", hard]] as [string, P[]][]) it(d, () => {
    const fp = new Set<string>(); let hidden = 0;
    for (const p of list) { expect(p.gen).toBe(2); expect(validate2(p, d)).toBe(true); const k = p.groups.flatMap((g) => g.words).sort().join("|"); expect(fp.has(k)).toBe(false); fp.add(k); if (p.groups.some((g) => g.type === "hidden")) hidden++; }
    expect(hidden / list.length).toBeLessThanOrEqual(0.1);
  });
});

describe("weekly snapshots: connections", () => {
  it("no duplicate puzzles across weeks; v2 puzzles valid", () => {
    const fp = new Map<string, string>();
    for (const [f, j] of Object.entries(mods)) for (const p of j.puzzles.filter((x: any) => x.game === "connections")) {
      const k = p.data.groups.flatMap((g: any) => g.words).sort().join("|"); expect(fp.has(k), `${f} duplicates ${fp.get(k)}`).toBe(false); fp.set(k, f);
      expect(validate2(p.data, p.difficulty)).toBe(true);
    }
  });
});
