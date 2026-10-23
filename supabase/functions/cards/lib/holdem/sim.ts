// Hold'em strategy core: Chen-formula preflop charts, Monte Carlo equity, and the easy/medium/hard bot policies.
// Shared by the engine (server bots), the coach (client) and the tuner. Pure TS.
import { type Card, type Rng, makeDeck } from "../core.ts";
import { evalInts, toInt, rankIdx, category, evaluate } from "./eval.ts";

export type Level = "easy" | "medium" | "hard";
export type BotParams = { open: number; slack: number; bluff: number; aggr: number; samples: number; valueTh: number; tight: number };
export const DEFAULT_PARAMS: Record<Level, BotParams> = {
  // easy: a calling station — plays most hands, calls with any pair or draw, rarely raises, never reads ranges
  easy: { open: -4, slack: 0.2, bluff: 0.02, aggr: 0.15, samples: 0, valueTh: 0.75, tight: 0 },
  // medium: fixed chart, plays its equity against random hands, a few bluffs
  medium: { open: 0, slack: 0.02, bluff: 0.06, aggr: 0.5, samples: 160, valueTh: 0.62, tight: 0 },
  // hard: position-aware chart, equity against narrowed ranges, semi-bluffs and c-bets, balanced sizing
  hard: { open: 0, slack: -0.02, bluff: 0.06, aggr: 0.95, samples: 360, valueTh: 0.58, tight: 1 },
};
export const PARAM_BOUNDS: Record<keyof BotParams, [number, number]> = { open: [-5, 3], slack: [-0.1, 0.3], bluff: [0, 0.3], aggr: [0, 1], samples: [0, 600], valueTh: [0.5, 0.85], tight: [0, 1] };

// ---------- preflop ----------
const CHEN_HI: Record<string, number> = { A: 10, K: 8, Q: 7, J: 6, T: 5, "9": 4.5, "8": 4, "7": 3.5, "6": 3, "5": 2.5, "4": 2, "3": 1.5, "2": 1 };
/** Bill Chen's starting-hand score (−1 … 20): AA 20, KK 16, AKs 12, 72o −1. */
export function chen(hole: Card[]) {
  const [a, b] = rankIdx(hole[0]) >= rankIdx(hole[1]) ? hole : [hole[1], hole[0]];
  let s = CHEN_HI[a[0]];
  if (a[0] === b[0]) return Math.max(5, s * 2);
  if (a[1] === b[1]) s += 2;
  const gap = rankIdx(a) - rankIdx(b) - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && rankIdx(a) < 10) s += 1; // both below Q, connected or one-gap
  return Math.ceil(s);
}
export type Pos = "early" | "middle" | "late" | "sb" | "bb";
/** Position of `seat` among the players dealt in, counted from the button. */
export function position(order: number[], seat: number, button: number): Pos {
  const n = order.length; const k = (order.indexOf(seat) - order.indexOf(button) + n) % n; // 0 = button
  if (n === 2) return k === 0 ? "sb" : "bb";
  if (k === 0) return "late"; if (k === 1) return "sb"; if (k === 2) return "bb";
  const fromBtn = n - k; // 1 = cutoff
  return fromBtn <= 2 ? "late" : fromBtn <= Math.ceil((n - 3) / 2) + 1 ? "middle" : "early";
}
/** Minimum Chen score to open-raise from each position. The hard bot uses these; medium uses the middle line everywhere. */
export const OPEN_CHART: Record<Pos, number> = { early: 9, middle: 8, late: 6, sb: 7, bb: 7 };

// ---------- equity ----------
const FULL = makeDeck().map(toInt);
export type Range = ((hole: number[]) => boolean) | null;
/** Monte Carlo equity of `hole` vs `opps` random hands (optionally filtered by a range test each), completing the board. Ties split. */
export function equity(hole: Card[], board: Card[], opps: Range[], n: number, rng: Rng, dead: Card[] = []): { eq: number; n: number; win: number; tie: number } {
  const h = hole.map(toInt), b = board.map(toInt); const used = new Set([...h, ...b, ...dead.map(toInt)]);
  const deck = FULL.filter((c) => !used.has(c)); let eq = 0, win = 0, tie = 0;
  const need = 5 - b.length; const mine = [...h, ...b, 0, 0, 0, 0, 0].slice(0, 7); const opp = [0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < n; k++) {
    // partial Fisher–Yates on a copy of the index space
    let m = deck.length; const d = deck.slice(); const draw = () => { const j = Math.floor(rng() * m); const c = d[j]; d[j] = d[--m]; return c; };
    const holes: number[][] = [];
    for (const r of opps) {
      let pick: number[] = [draw(), draw()];
      if (r) for (let t = 0; t < 20 && !r(pick); t++) { d[m++] = pick[0]; d[m++] = pick[1]; pick = [draw(), draw()]; }
      holes.push(pick);
    }
    const run: number[] = []; for (let i = 0; i < need; i++) run.push(draw());
    for (let i = 0; i < need; i++) mine[2 + b.length + i] = run[i];
    const me = evalInts(mine); let best = -1, ties = 0;
    for (const oh of holes) { opp[0] = oh[0]; opp[1] = oh[1]; for (let i = 0; i < b.length; i++) opp[2 + i] = b[i]; for (let i = 0; i < need; i++) opp[2 + b.length + i] = run[i];
      const v = evalInts(opp); if (v > best) { best = v; ties = 0; } if (v === best) ties++; }
    if (me > best) { eq += 1; win++; } else if (me === best) { eq += 1 / (ties + 1); tie++; }
  }
  return { eq: eq / n, n, win: win / n, tie: tie / n };
}
/** Exact-ish equity against known opponent hands (tutorial "peek"): enumerates the board when ≤ 2 cards remain, otherwise samples. */
export function equityVsKnown(hole: Card[], board: Card[], others: Card[][], n: number, rng: Rng): number {
  const all = [...hole, ...board, ...others.flat()].map(toInt); const used = new Set(all);
  const deck = FULL.filter((c) => !used.has(c)); const need = 5 - board.length; const b = board.map(toInt);
  const score = (run: number[]) => { const me = evalInts([...hole.map(toInt), ...b, ...run]); let best = -1, ties = 0;
    for (const o of others) { const v = evalInts([...o.map(toInt), ...b, ...run]); if (v > best) { best = v; ties = 0; } if (v === best) ties++; }
    return me > best ? 1 : me === best ? 1 / (ties + 1) : 0; };
  let s = 0, k = 0;
  if (need === 0) return score([]);
  if (need === 1) { for (const c of deck) { s += score([c]); k++; } return s / k; }
  if (need === 2) { for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) { s += score([deck[i], deck[j]]); k++; } return s / k; }
  for (let t = 0; t < n; t++) { const d = deck.slice(); const run: number[] = []; for (let i = 0; i < need; i++) { const j = Math.floor(rng() * d.length); run.push(d[j]); d.splice(j, 1); } s += score(run); }
  return s / n;
}
const intChen = (h: number[]) => chen(h.map(fromInt));
const RN = "23456789TJQKA", SN = "SHDC";
export const fromInt = (c: number) => RN[c >> 2] + SN[c & 3];
/** Range filter from what an opponent has done this hand (hard bot + coach): raised preflop → top ~20 %, called → top ~50 %. */
export function rangeFor(o: { pfRaised: boolean; pfCalled: boolean; aggrStreet: boolean }, board: Card[]): Range {
  const minChen = o.pfRaised ? 8 : o.pfCalled ? 5 : 3;
  const b = board.map(toInt);
  return (h) => { if (intChen(h) < minChen) return false;
    if (o.aggrStreet && b.length >= 3) { const cat = Math.floor(evalInts([...h, ...b]) / 13 ** 5); if (cat === 0 && !hasDraw(h, b)) return false; }
    return true; };
}
function hasDraw(h: number[], b: number[]) {
  const cs = [...h, ...b]; const sc = [0, 0, 0, 0]; let mask = 0; for (const c of cs) { sc[c & 3]++; mask |= 1 << (c >> 2); }
  if (sc.some((x) => x >= 4)) return true;
  for (let top = 12; top >= 3; top--) { let k = 0; for (let r = top; r > top - 5 && r >= -1; r--) if (mask & (1 << (r < 0 ? 12 : r))) k++; if (k >= 4) return true; }
  return false;
}
export const drawish = (hole: Card[], board: Card[]) => hasDraw(hole.map(toInt), board.map(toInt));
/** Made-hand category of hole + board (0 high card … 8 straight flush). */
export const madeCat = (hole: Card[], board: Card[]) => (board.length ? category(evaluate([...hole, ...board])) : hole[0][0] === hole[1][0] ? 1 : 0);

// ---------- decisions ----------
export type Opp = { seat: number; pfRaised: boolean; pfCalled: boolean; aggrStreet: boolean };
export type Spot = {
  hole: Card[]; board: Card[]; pot: number; toCall: number; myBet: number; chips: number; minRaiseTo: number; maxTo: number; bb: number;
  canRaise: boolean; pos: Pos; opps: Opp[]; street: 0 | 1 | 2 | 3; facingRaise: boolean; iRaisedPre: boolean; nPlayers: number;
};
export type Decision = { t: "fold" } | { t: "check" } | { t: "call" } | { t: "raise"; to: number };
export type DecideCtx = { level: Level; P: BotParams; rng: Rng; eqOverride?: number };
/** Clamp a raise target to the legal window (min raise … all-in). */
export const legalTo = (s: Spot, to: number) => Math.round(Math.max(s.minRaiseTo, Math.min(s.maxTo, to)));
export function betSize(s: Spot, frac: number) { return legalTo(s, s.myBet + s.toCall + frac * (s.pot + s.toCall)); }

export function spotEquity(s: Spot, c: DecideCtx) {
  if (c.eqOverride !== undefined) return c.eqOverride;
  const n = Math.round(c.P.samples) || 0;
  if (!n) return crude(s);
  const ranges = s.opps.map((o) => (c.P.tight ? rangeFor(o, s.board) : null));
  return equity(s.hole, s.board, ranges, n, c.rng).eq;
}
/** Easy bot "equity": made-hand category + draws, no simulation. */
function crude(s: Spot) {
  if (!s.board.length) return Math.min(0.85, 0.25 + chen(s.hole) / 30);
  const cat = madeCat(s.hole, s.board); return [0.3, 0.6, 0.75, 0.85, 0.9, 0.92, 0.95, 0.98, 0.99][cat] + (cat === 0 && drawish(s.hole, s.board) ? 0.15 : 0);
}
export function decide(s: Spot, c: DecideCtx): Decision {
  const { level, P, rng } = c;
  const call: Decision = s.toCall > 0 ? { t: "call" } : { t: "check" }; const fold: Decision = s.toCall > 0 ? { t: "fold" } : { t: "check" };
  const raise = (to: number): Decision => (s.canRaise && s.maxTo > s.myBet + s.toCall ? { t: "raise", to: legalTo(s, to) } : call);
  if (s.street === 0) return preflop(s, c, call, fold, raise);
  const eq = spotEquity(s, c); const multi = Math.max(1, s.opps.length);
  const potOdds = s.toCall / (s.pot + s.toCall || 1);
  const value = P.valueTh + (multi - 1) * 0.06;
  const draw = drawish(s.hole, s.board) && s.street < 3;
  if (level === "easy") {
    const cat = madeCat(s.hole, s.board);
    if (s.toCall === 0) return cat >= 2 && rng() < 0.5 ? raise(betSize(s, 0.5)) : rng() < P.bluff ? raise(betSize(s, 0.5)) : call;
    if (cat >= 3 && rng() < P.aggr) return raise(betSize(s, 0.75));
    return cat >= 1 || draw || eq >= potOdds - P.slack ? call : rng() < 0.15 ? call : fold;
  }
  if (s.toCall === 0) {
    if (eq >= value && rng() < 0.5 + P.aggr / 2) return raise(betSize(s, level === "hard" ? (eq > 0.8 ? 0.75 : 0.55) : 0.66));
    // c-bet as the preflop raiser heads-up on the flop (hard), semi-bluff draws, pure bluff at a tuned rate
    if (level === "hard" && s.street === 1 && s.iRaisedPre && multi === 1 && rng() < 0.6) return raise(betSize(s, 0.4));
    if (draw && rng() < P.bluff * 2.5) return raise(betSize(s, 0.6));
    if (eq < 0.3 && rng() < P.bluff) return raise(betSize(s, 0.6));
    return call;
  }
  if (eq >= Math.max(value + 0.12, 0.7) && rng() < P.aggr) return raise(betSize(s, 0.8));
  if (level === "hard" && draw && s.street === 1 && rng() < P.bluff) return raise(betSize(s, 0.75));
  // implied odds for draws with deep stacks
  const implied = draw && s.chips > 6 * s.toCall ? 0.05 : 0;
  return eq >= potOdds - P.slack - implied ? call : fold;
}
function preflop(s: Spot, c: DecideCtx, call: Decision, fold: Decision, raise: (to: number) => Decision): Decision {
  const { level, P, rng } = c; const ch = chen(s.hole) - P.open;
  const hu = s.nPlayers === 2;
  // heads-up the hard bot opens much wider from the button and defends its big blind (ranges widen as players drop out)
  const openMin = level === "hard" ? (hu ? 4 : OPEN_CHART[s.pos] - (s.nPlayers <= 4 ? 1 : 0)) : 8; const limpers = s.toCall <= s.bb && !s.facingRaise;
  const openTo = Math.max(s.minRaiseTo, (level === "hard" && s.pos === "late" ? 2.5 : 3) * s.bb + (s.myBet + s.toCall > s.bb ? 0 : 0));
  if (level === "easy") {
    if (ch >= 12 && rng() < 0.6) return raise(s.myBet + s.toCall + 3 * s.bb);
    if (s.toCall === 0) return call;
    if (ch >= 4 && s.toCall <= 4 * s.bb) return call; if (ch >= 7) return call; return rng() < 0.1 ? call : fold;
  }
  if (limpers) {
    if (ch >= openMin) return raise(openTo);
    if (s.toCall === 0) return call; // big blind option
    if (level === "hard" && s.pos === "sb" && ch >= 5) return call;
    if (level === "medium" && ch >= 6 && s.toCall <= s.bb) return call;
    if (level === "hard" && s.pos === "late" && ch >= 3 && rng() < P.bluff) return raise(openTo); // steal
    return fold;
  }
  // facing a raise
  const potOdds = s.toCall / (s.pot + s.toCall);
  const threeBet = level === "hard" ? 11 : 12; const flat = level === "hard" ? (hu ? 5 : s.pos === "late" || s.pos === "bb" ? 7 : 8) : 9;
  if (ch >= threeBet) return raise(s.myBet + s.toCall + 2.2 * (s.pot + s.toCall) / 2);
  if (level === "hard" && ch >= 6 && ch < flat && s.hole[0][1] === s.hole[1][1] && rng() < P.bluff) return raise(s.myBet + s.toCall + (s.pot + s.toCall));
  if (ch >= flat && s.toCall <= Math.max(0.15 * (s.chips + s.myBet), 4 * s.bb)) return call;
  if (ch >= flat + 2) return call;
  return potOdds < 0.2 && ch >= flat - 2 ? call : fold;
}
/** Cheap strength proxy (0..1) used for opponent responses in the coach and by the easy bot. */
export const handStrength = (hole: Card[], board: Card[]) => crude({ hole, board } as Spot);
export const _test = { crude };
