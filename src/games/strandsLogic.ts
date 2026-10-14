import data from "../data/strands.json";
export type Cell = [number, number];
export type StrandsPuzzle = { theme: string; clue: string; spangram: string; words: string[]; grid: string[]; paths: Record<string, Cell[]> };
export const puzzles = data as unknown as StrandsPuzzle[];
export const ROWS = 6, COLS = 5;
export const adjacent = (a: Cell, b: Cell) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1;
export const key = (c: Cell) => `${c[0]},${c[1]}`;
export function matchWord(p: StrandsPuzzle, path: Cell[]): string | null {
  const w = path.map(([r, c]) => p.grid[r][c]).join("");
  const target = p.paths[w];
  if (!target || target.length !== path.length) return null;
  return target.every((c, i) => key(c) === key(path[i])) ? w : null;
}
export function spans(path: Cell[]) {
  const rs = path.map((c) => c[0]), cs = path.map((c) => c[1]);
  return (rs.includes(0) && rs.includes(ROWS - 1)) || (cs.includes(0) && cs.includes(COLS - 1));
}
