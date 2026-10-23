// Monte Carlo evaluator for Train mode / hints. Every probability shown in the UI comes from here (sample size reported).
// Unknown cards are drawn without replacement from the 6-deck shoe minus every card visible on the table.
import { type Card, type Rng, SUITS } from "../core.ts";
import { basicStrategy, cardValue, handValue, type Action } from "./strategy.ts";

export type Row = { action: Action | "insure" | "noinsure"; n: number; win: number; push: number; lose: number; ev: number; se: number; dealerBust: number; bustNext: number; strong: number };
type Comp = number[]; // index 2..11 -> remaining count

export function composition(seen: (Card | null)[], decks = 6): Comp {
  const c = new Array(12).fill(0);
  for (let v = 2; v <= 11; v++) c[v] = v === 10 ? 16 * decks : 4 * decks;
  for (const x of seen) if (x) { const v = cardValue(x); if (c[v] > 0) c[v]--; }
  return c;
}
const total = (c: Comp) => { let t = 0; for (let v = 2; v <= 11; v++) t += c[v]; return t; };
function drawV(c: Comp, rng: Rng): number {
  let r = Math.floor(rng() * total(c));
  for (let v = 2; v <= 11; v++) { if (r < c[v]) { c[v]--; return v; } r -= c[v]; }
  return 10;
}
const R = (v: number) => (v === 11 ? "A" : v === 10 ? "T" : String(v));
const asCard = (v: number, rng?: Rng) => R(v) + (rng ? SUITS[Math.floor(rng() * 4)] : "S");

type Trial = { net: number; hands: number[][]; dealer: number[]; dealerBust: boolean; bustNext: boolean; strong: boolean };

function playOut(cards: number[], up: number, c: Comp, rng: Rng, canDouble: boolean, handsLeft: number, out: { cards: number[]; bet: number }[]) {
  // continue a hand with basic strategy
  let bet = 1;
  for (;;) {
    const cc = cards.map((v) => asCard(v));
    if (handValue(cc).total >= 21) break;
    const pair = cards.length === 2 && cards[0] === cards[1] && handsLeft > 0;
    const a = basicStrategy(cc, asCard(up), canDouble && cards.length === 2, pair);
    if (a === "stand") break;
    if (a === "hit") { cards.push(drawV(c, rng)); continue; }
    if (a === "double") { bet = 2; cards.push(drawV(c, rng)); break; }
    if (a === "split") { splitHands(cards[0], up, c, rng, handsLeft, out); return; }
  }
  out.push({ cards, bet });
}
function splitHands(v: number, up: number, c: Comp, rng: Rng, handsLeft: number, out: { cards: number[]; bet: number }[]) {
  // handsLeft counts extra hands still allowed
  let left = handsLeft - 1;
  for (let k = 0; k < 2; k++) {
    const h = [v, drawV(c, rng)];
    if (v === 11) { out.push({ cards: h, bet: 1 }); continue; }
    const sub: { cards: number[]; bet: number }[] = [];
    const before = left;
    playOut(h, up, c, rng, true, left, sub);
    if (sub.length > 1) left = Math.max(0, before - (sub.length - 1));
    out.push(...sub);
  }
}
const val = (h: number[]) => handValue(h.map((v) => asCard(v))).total;

export type EvalInput = { cards: Card[]; dealerUp: Card; seen: (Card | null)[]; handsSoFar?: number; legal: Action[]; n?: number; rng: Rng; insurancePhase?: boolean };

function trial(inp: EvalInput, action: Action, rng: Rng): Trial {
  const c = composition(inp.seen);
  const up = cardValue(inp.dealerUp);
  // dealer already peeked: condition the hole card on "no blackjack"
  let hole = drawV(c, rng);
  for (let g = 0; g < 50 && ((up === 11 && hole === 10) || (up === 10 && hole === 11)); g++) { c[hole]++; hole = drawV(c, rng); }
  const start = inp.cards.map(cardValue);
  const hands: { cards: number[]; bet: number }[] = [];
  let bustNext = false;
  const extra = 3 - (inp.handsSoFar ?? 1);
  if (action === "stand") hands.push({ cards: start, bet: 1 });
  else if (action === "double") { const h = [...start, drawV(c, rng)]; bustNext = val(h) > 21; hands.push({ cards: h, bet: 2 }); }
  else if (action === "hit") { const h = [...start, drawV(c, rng)]; bustNext = val(h) > 21; playOut(h, up, c, rng, false, 0, hands); }
  else splitHands(start[0], up, c, rng, extra, hands);
  const dealer = [up, hole];
  const anyLive = hands.some((h) => val(h.cards) <= 21);
  if (anyLive) while (val(dealer) < 17) dealer.push(drawV(c, rng));
  const d = val(dealer); let net = 0;
  for (const h of hands) { const v = val(h.cards); net += v > 21 ? -h.bet : d > 21 || v > d ? h.bet : v === d ? 0 : -h.bet; }
  return { net, hands: hands.map((h) => h.cards), dealer, dealerBust: d > 21, bustNext, strong: hands.every((h) => { const v = val(h.cards); return v >= 18 && v <= 21; }) };
}

/** Evaluate each legal action by Monte Carlo (default 20,000 trials each). Sorted best EV first. */
export function evaluate(inp: EvalInput): Row[] {
  const n = inp.n ?? 20000;
  if (inp.insurancePhase) return evaluateInsurance(inp, n);
  const rows: Row[] = [];
  for (const a of inp.legal) {
    let sum = 0, sq = 0, w = 0, p = 0, l = 0, db = 0, bn = 0, st = 0;
    for (let k = 0; k < n; k++) {
      const t = trial(inp, a, inp.rng);
      sum += t.net; sq += t.net * t.net; if (t.net > 0) w++; else if (t.net < 0) l++; else p++;
      if (t.dealerBust) db++; if (t.bustNext) bn++; if (t.strong) st++;
    }
    const ev = sum / n, sd = Math.sqrt(Math.max(0, sq / n - ev * ev));
    rows.push({ action: a, n, win: w / n, push: p / n, lose: l / n, ev, se: sd / Math.sqrt(n), dealerBust: db / n, bustNext: bn / n, strong: st / n });
  }
  return rows.sort((x, y) => y.ev - x.ev);
}
/** Insurance: side bet of half the wager pays 2:1 if the hole card is ten-valued. EV per $1 of the main bet. */
function evaluateInsurance(inp: EvalInput, n: number): Row[] {
  let bj = 0;
  for (let k = 0; k < n; k++) { const c = composition(inp.seen); if (drawV(c, inp.rng) === 10) bj++; }
  const p = bj / n, ev = 0.5 * (2 * p - (1 - p)), sd = 0.5 * 3 * Math.sqrt(p * (1 - p));
  const take: Row = { action: "insure", n, win: p, push: 0, lose: 1 - p, ev, se: sd / Math.sqrt(n), dealerBust: 0, bustNext: 0, strong: p };
  const no: Row = { action: "noinsure", n, win: 0, push: 1, lose: 0, ev: 0, se: 0, dealerBust: 0, bustNext: 0, strong: p };
  return [take, no].sort((a, b) => b.ev - a.ev);
}

/** One random playout of an action, with real-looking cards, for the "replay this choice" view. */
export function sampleOnce(inp: EvalInput, action: Action, rng: Rng) {
  const t = trial(inp, action, rng);
  const conv = (vs: number[], keep: Card[]) => vs.map((v, i) => keep[i] ?? asCard(v, rng));
  return { net: t.net, hands: t.hands.map((h) => conv(h, action === "split" ? [inp.cards[0]] : inp.cards)), dealer: conv(t.dealer, [inp.dealerUp]) };
}
