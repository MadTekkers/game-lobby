import cw from "../data/crosswords.json";
import bee from "../data/bee.json";
type Entry = { n: number; row: number; col: number; answer: string; clue: string };
export type CW = { size: number; difficulty: string; grid: string[]; across: Entry[]; down: Entry[] };
export const CROSSWORDS = cw as unknown as Record<string, CW[]>;
export type Bee = { center: string; outer: string; answers: string[]; pangrams: string[]; max: number };
export const BEES = bee as Bee[];
export const wordScore = (w: string) => (w.length === 4 ? 1 : w.length) + (new Set(w).size === 7 ? 7 : 0);
