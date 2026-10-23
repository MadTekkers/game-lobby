// Hold'em coach: Monte Carlo over opponents' hole cards (drawn from ranges implied by their actions) and the rest of the board.
// Every option is scored on the SAME samples. Model: after a bet/raise, each opponent continues iff their hand strength beats the
// pot odds you offer them (+ a margin); called hands are checked down to showdown. EV = chips you get back from now, vs folding (0).
import { type Card, type Rng, makeDeck } from "../core.ts";
import { evalInts, toInt, category, evaluate } from "./eval.ts";
import * as Sim from "./sim.ts";

export type OppInfo = { seat: number; bet: number; chips: number; pfRaised: boolean; pfCalled: boolean; aggr: boolean };
export type CoachSpot = { hole: Card[]; board: Card[]; pot: number; toCall: number; myBet: number; chips: number; minRaiseTo: number; maxBet: number; canRaise: boolean; bb: number; opps: OppInfo[] };
export type Option = { key: string; label: string; t: "fold" | "check" | "call" | "raise"; to?: number };
export type OptRow = Option & { n: number; ev: number; se: number; seGap: number; eq: number; foldPct: number; calledWin: number; calledN: number; risk: number };

export function options(s: CoachSpot): Option[] {
  const out: Option[] = [];
  if (s.toCall > 0) out.push({ key: "fold", label: "Fold", t: "fold" }, { key: "call", label: `Call ${s.toCall}`, t: "call" });
  else out.push({ key: "check", label: "Check", t: "check" });
  if (s.canRaise) {
    const maxTo = s.myBet + s.chips; const word = s.maxBet > 0 ? "Raise to" : "Bet";
    const after = s.pot + s.toCall; const seen = new Set<number>();
    const add = (to: number, lbl: string) => { to = Math.round(Math.max(s.minRaiseTo, Math.min(maxTo, to))); if (seen.has(to)) return; seen.add(to); out.push({ key: `r${to}`, label: to >= maxTo ? `All-in (${to})` : `${word} ${to}${lbl}`, t: "raise", to }); };
    if (!s.board.length && s.maxBet <= s.bb) { add(3 * s.bb, " (3 bb)"); }
    else if (!s.board.length) { add(s.maxBet * 3, " (3×)"); }
    else { add(s.myBet + s.toCall + after / 3, " (⅓ pot)"); add(s.myBet + s.toCall + (after * 2) / 3, " (⅔ pot)"); }
    add(s.myBet + s.toCall + after, " (pot)"); add(maxTo, "");
  }
  return out;
}
/** Range filter per opponent from what they did this hand. */
const rangeOf = (o: OppInfo, board: Card[]) => Sim.rangeFor({ pfRaised: o.pfRaised, pfCalled: o.pfCalled, aggrStreet: o.aggr }, board);

export function evalOptions(s: CoachSpot, opts: Option[], o: { n?: number; rng: Rng }): OptRow[] {
  const n = o.n ?? 400; const rng = o.rng;
  const used = new Set([...s.hole, ...s.board]); const deck = makeDeck().filter((c) => !used.has(c));
  const ranges = s.opps.map((x) => rangeOf(x, s.board));
  const acc = opts.map(() => ({ v: 0, v2: 0, vals: [] as number[], eq: 0, fold: 0, cw: 0, cn: 0, risk: 0 }));
  const need = 5 - s.board.length; const mine = s.hole.map(toInt);
  for (let k = 0; k < n; k++) {
    // sample opponents' holes (rejection against their ranges), then the runout
    const d = deck.slice(); let m = d.length; const draw = () => { const j = Math.floor(rng() * m); const c = d[j]; d[j] = d[--m]; return c; };
    const holes: Card[][] = ranges.map((r) => { let h = [draw(), draw()]; if (r) for (let t = 0; t < 20 && !r(h.map(toInt)); t++) { d[m++] = h[0]; d[m++] = h[1]; h = [draw(), draw()]; } return h; });
    const run = Array.from({ length: need }, draw); const board = [...s.board, ...run].map(toInt);
    const me = evalInts([...mine, ...board]); const theirs = holes.map((h) => evalInts([...h.map(toInt), ...board]));
    const share = (who: number[]) => { let best = -1, ties = 0; for (const i of who) { if (theirs[i] > best) { best = theirs[i]; ties = 0; } if (theirs[i] === best) ties++; } return me > best ? 1 : me === best ? 1 / (ties + 1) : 0; };
    const all = s.opps.map((_, i) => i); const eqAll = share(all);
    const str = holes.map((h) => Sim.handStrength(h, s.board));
    opts.forEach((op, oi) => {
      const a = acc[oi]; let val = 0;
      if (op.t === "fold") val = 0;
      else if (op.t === "check") { val = eqAll * s.pot; a.eq += eqAll; }
      else if (op.t === "call") { const c = Math.min(s.toCall, s.chips); val = eqAll * (s.pot + c) - c; a.eq += eqAll; a.risk += c; }
      else {
        const extra = op.to! - s.myBet; const callers: number[] = []; let added = 0;
        s.opps.forEach((x, i) => { const needI = Math.min(op.to! - x.bet, x.chips); if (needI <= 0) { callers.push(i); return; }
          const q = needI / (s.pot + extra + needI); if (str[i] >= q + 0.08) { callers.push(i); added += needI; } });
        if (!callers.length) { val = s.pot; a.fold++; }
        else { const sh = share(callers); val = sh * (s.pot + extra + added) - extra; a.cw += sh; a.cn++; a.eq += sh; }
        a.risk += extra;
      }
      a.v += val; a.v2 += val * val; a.vals.push(val);
    });
  }
  const rows = opts.map((op, i) => { const a = acc[i]; const ev = a.v / n; const sd = Math.sqrt(Math.max(0, a.v2 / n - ev * ev));
    const calledN = op.t === "raise" ? a.cn : n;
    return { ...op, n, ev, se: sd / Math.sqrt(n), seGap: 0, eq: op.t === "raise" ? (a.cn ? a.cw / a.cn : 0) : a.eq / n, foldPct: op.t === "raise" ? a.fold / n : 0, calledWin: a.cn ? a.cw / a.cn : 0, calledN, risk: a.risk / n, vals: a.vals }; })
    .sort((x, y) => y.ev - x.ev);
  const b = rows[0].vals;
  return rows.map(({ vals, ...r }) => { const dd = vals.map((x, k) => b[k] - x); const mu = dd.reduce((p, x) => p + x, 0) / n; const sd = Math.sqrt(dd.reduce((p, x) => p + (x - mu) ** 2, 0) / Math.max(1, n - 1)); return { ...r, seGap: sd / Math.sqrt(n) }; });
}
/** Cards that improve you to two pair or better (and don't just improve the board) — the "outs". */
export function outs(hole: Card[], board: Card[], dead: Card[] = []) {
  if (board.length < 3 || board.length > 4) return [];
  const used = new Set([...hole, ...board, ...dead]); const cur = category(evaluate([...hole, ...board]));
  return makeDeck().filter((c) => !used.has(c)).filter((c) => { const nb = [...board, c]; const k = category(evaluate([...hole, ...nb])); return k > cur && k >= 2 && k > (nb.length >= 5 ? category(evaluate(nb)) : boardCat(nb)); });
}
/** Made-hand category of a 4-card board by itself (a pair on the board isn't your improvement). */
export function boardCat(board: Card[]) { const cnt: Record<string, number> = {}; for (const c of board) cnt[c[0]] = (cnt[c[0]] ?? 0) + 1; const v = Object.values(cnt).sort((a, b) => b - a); return v[0] >= 3 ? 3 : v[0] === 2 ? (v[1] === 2 ? 2 : 1) : 0; }
/** One sampled continuation for the Replay button. */
export function replayOption(s: CoachSpot, op: Option, rng: Rng) {
  const used = new Set([...s.hole, ...s.board]); const d = makeDeck().filter((c) => !used.has(c));
  const take = () => d.splice(Math.floor(rng() * d.length), 1)[0];
  const ranges = s.opps.map((x) => rangeOf(x, s.board));
  const holes = ranges.map((r) => { let h = [take(), take()]; if (r) for (let t = 0; t < 20 && !r(h.map(toInt)); t++) { d.push(...h); h = [take(), take()]; } return h; });
  const board = [...s.board]; while (board.length < 5) board.push(take());
  const extra = op.t === "raise" ? op.to! - s.myBet : 0;
  const resp = s.opps.map((x, i) => { if (op.t !== "raise") return "in"; const needI = Math.min(op.to! - x.bet, x.chips); if (needI <= 0) return "in"; const q = needI / (s.pot + extra + needI); return Sim.handStrength(holes[i], s.board) >= q + 0.08 ? "call" : "fold"; });
  const me = evaluate([...s.hole, ...board]); const sc = holes.map((h) => evaluate([...h, ...board]));
  return { holes, board, resp, me, sc, folded: op.t === "fold" };
}
