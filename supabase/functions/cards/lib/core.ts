// Shared card primitives. Pure TS, no imports: runs in the browser, in vitest and in the Deno edge function.
export type Card = string; // rank + suit, e.g. "AS", "TD", "7H"
export const RANKS = "23456789TJQKA";
export const SUITS = "SHDC";
export type Rng = () => number;

export function makeDeck(decks = 1): Card[] {
  const out: Card[] = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) out.push(r + s);
  return out;
}
/** Fisher-Yates using the given RNG (server: cryptoRng). */
export function shuffle<T>(a: T[], rng: Rng): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}
/** Cryptographically secure RNG (Web Crypto exists in browsers, Node 20 and Deno). */
export function cryptoRng(): Rng {
  const buf = new Uint32Array(64); let i = 64;
  return () => { if (i >= 64) { crypto.getRandomValues(buf); i = 0; } return buf[i++] / 4294967296; };
}
/** Deterministic RNG for tests and simulations. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export class IllegalMove extends Error {}
export const rankOf = (c: Card) => c[0];
export const suitOf = (c: Card) => c[1];
export const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const RANK_LABEL = (r: string) => (r === "T" ? "10" : r);
export const isRed = (c: Card) => c[1] === "H" || c[1] === "D";
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Presentation frames: the server sets `frameRec.on` while it applies a move, and the engines call `frame(s)` after each visible
 *  step (a bot's action, a dealer draw, a street, a card into the trick). The server turns each into a *public* snapshot so the client
 *  can replay the steps one by one. No-op on the client and in tests. `over` patches the snapshot (e.g. a full trick before it's collected). */
export const frameRec: { on: ((s: unknown, over?: Record<string, unknown>) => void) | null } = { on: null };
export function frame(s: unknown, over?: Record<string, unknown>) { frameRec.on?.(s, over); }
