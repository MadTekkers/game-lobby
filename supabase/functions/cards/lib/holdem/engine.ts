// No-limit Texas Hold'em cash table: authoritative in the edge function, mirrored on the client for UI/coach. Pure TS.
// 2–8 seats, blinds 5/10, 1,000-chip buy-ins (capped by bankroll). Min-raise = last full raise; a short all-in doesn't reopen
// betting for players who already acted. Pots split into side pots by contribution level; odd chips go left of the button.
// Heads-up: the button posts the small blind and acts first preflop, last after. Chips settle against the bankroll every hand.
import { type Card, type Rng, shuffle, IllegalMove, clone, makeDeck } from "../core.ts";
import { evaluate, describe } from "./eval.ts";
import * as Sim from "./sim.ts";
import { type BaseSeat, type Ctx, type Level, type Pending, type TableBase, botBase, humanBase, paramsFor, pushLog, humanCount, stripSeat } from "../seats.ts";

export type PSeat = BaseSeat & { chips: number; sitOut: boolean; buyins: number };
export type Hand = {
  deck: Card[]; holes: Card[][]; board: Card[]; inHand: boolean[]; folded: boolean[]; allIn: boolean[]; bet: number[]; contrib: number[];
  acted: boolean[]; canRaise: boolean[]; maxBet: number; lastRaise: number; street: 0 | 1 | 2 | 3; turn: number; sbSeat: number; bbSeat: number;
  startChips: number[]; pfRaised: boolean[]; pfCalled: boolean[]; aggr: boolean[]; last: (string | null)[]; vpip: boolean[]; raiser: number; bluffs: boolean[];
};
export type Pot = { amount: number; winners: number[]; eligible: number[]; refund: boolean };
export type LastHand = { handNo: number; board: Card[]; pots: Pot[]; shown: { seat: number; hole: Card[]; desc: string }[]; net: number[]; winners: number[]; uncontested: boolean };
export type PkState = TableBase<PSeat> & {
  game: "holdem"; n: number; phase: "waiting" | "betting" | "handover"; button: number; handNo: number; sb: number; bb: number; buyIn: number;
  h: Hand | null; lastHand: LastHand | null; nextDeck?: Card[];
};
export type Move = { t: "fold" } | { t: "check" } | { t: "call" } | { t: "raise"; to: number } | { t: "start" } | { t: "next" } | { t: "rebuy" };
export const SEATS = { min: 2, max: 8 };
const fresh = (b: BaseSeat, chips: number): PSeat => ({ ...b, chips, sitOut: chips <= 0, buyins: 1 });

export function newTable(o: { seats: number; botLevel: Level; now: number; rng: Rng; timeoutMs?: number; tutorial?: boolean; live?: boolean; deck?: Card[]; sb?: number; bb?: number; buyIn?: number }): PkState {
  const n = Math.max(2, Math.min(8, o.seats)); const buyIn = o.buyIn ?? 1000;
  return {
    game: "holdem", n, seats: Array.from({ length: n }, (_, i) => fresh(botBase(i, o.botLevel, o.rng), buyIn)), phase: "waiting", button: n - 1, handNo: 0,
    sb: o.sb ?? 5, bb: o.bb ?? 10, buyIn, h: null, lastHand: null, nextDeck: o.deck,
    log: [], ledger: [], results: [], resultSeq: 0, reviews: [], reviewSeq: 0, deadline: null, timeoutMs: o.timeoutMs ?? 30000,
    botLevel: o.botLevel, tutorial: !!o.tutorial, live: !!o.live, startedAt: o.now, round: 0,
  };
}
const canAct = (h: Hand, i: number) => h.inHand[i] && !h.folded[i] && !h.allIn[i];
const live = (h: Hand) => h.inHand.map((x, i) => (x && !h.folded[i] ? i : -1)).filter((i) => i >= 0);
const nextFrom = (s: PkState, from: number, ok: (i: number) => boolean) => { for (let k = 1; k <= s.n; k++) { const i = (from + k) % s.n; if (ok(i)) return i; } return -1; };
export const actor = (s: PkState) => (s.phase === "betting" && s.h ? s.h.turn : -1);
export const potTotal = (h: Hand) => h.contrib.reduce((a, x) => a + x, 0);

function push(s: PkState, i: number, amt: number) {
  const h = s.h!; const x = s.seats[i]; const a = Math.max(0, Math.min(amt, x.chips));
  x.chips -= a; h.bet[i] += a; h.contrib[i] += a; if (x.chips === 0) h.allIn[i] = true; return a;
}
function dealHand(s: PkState, ctx: Ctx, force = false) {
  for (let i = 0; i < s.n; i++) {
    const x = s.seats[i]; const p = x.pending;
    if (p) { s.seats[i] = fresh(humanBase(p), Math.min(s.buyIn, Math.max(0, p.stack))); pushLog(s, `${p.name} sat down`, ctx.now); continue; }
    if (x.kind === "bot" && x.chips < s.bb) { x.chips = s.buyIn; x.buyins++; pushLog(s, `${x.name} rebuys for ${s.buyIn}`, ctx.now); }
    if (x.kind === "human" && x.chips <= 0) x.sitOut = true;
  }
  const ok = (i: number) => s.seats[i].chips > 0 && !s.seats[i].sitOut;
  const dealt = s.seats.map((_, i) => ok(i));
  if (dealt.filter(Boolean).length < 2 || (!force && !s.seats.some((x, i) => x.kind === "human" && dealt[i]))) { s.phase = "handover"; s.h = null; return; }
  s.handNo++; s.round = s.handNo; s.button = nextFrom(s, s.button, ok);
  const deck = s.nextDeck ?? shuffle(makeDeck(), ctx.rng); s.nextDeck = undefined;
  const n = s.n; const holes: Card[][] = Array.from({ length: n }, () => []);
  let at = 0; for (let r = 0; r < 2; r++) for (let k = 1; k <= n; k++) { const i = (s.button + k) % n; if (dealt[i]) holes[i].push(deck[at++]); }
  const heads = dealt.filter(Boolean).length === 2;
  const sbSeat = heads ? s.button : nextFrom(s, s.button, ok); const bbSeat = nextFrom(s, sbSeat, ok);
  s.h = { deck: deck.slice(at), holes, board: [], inHand: dealt, folded: Array(n).fill(false), allIn: Array(n).fill(false), bet: Array(n).fill(0), contrib: Array(n).fill(0),
    acted: Array(n).fill(false), canRaise: Array(n).fill(true), maxBet: s.bb, lastRaise: s.bb, street: 0, turn: -1, sbSeat, bbSeat,
    startChips: s.seats.map((x) => x.chips), pfRaised: Array(n).fill(false), pfCalled: Array(n).fill(false), aggr: Array(n).fill(false), last: Array(n).fill(null),
    vpip: Array(n).fill(false), raiser: -1, bluffs: Array(n).fill(false) };
  s.phase = "betting"; s.lastHand = s.lastHand && { ...s.lastHand };
  push(s, sbSeat, s.sb); push(s, bbSeat, s.bb); s.h.last[sbSeat] = `SB ${s.h.bet[sbSeat]}`; s.h.last[bbSeat] = `BB ${s.h.bet[bbSeat]}`;
  pushLog(s, `Hand ${s.handNo} — ${s.seats[s.button].name} has the button`, ctx.now);
  s.h.turn = nextFrom(s, bbSeat, (i) => canAct(s.h!, i));
  settleStreet(s, ctx);
}
/** Called after every action: move the turn on, or close the street / hand. */
function settleStreet(s: PkState, ctx: Ctx) {
  const h = s.h!;
  if (live(h).length === 1) return endHand(s, ctx);
  const pending = (i: number) => canAct(h, i) && (!h.acted[i] || h.bet[i] < h.maxBet);
  const actors = h.inHand.map((_, i) => i).filter((i) => canAct(h, i));
  const someone = actors.some(pending);
  // a lone actor facing no bet (everyone else all-in) has nothing to decide
  if (someone && !(actors.length === 1 && h.bet[actors[0]] >= h.maxBet)) {
    if (!pending(h.turn)) h.turn = nextFrom(s, h.turn, pending);
    return;
  }
  // street over
  while (true) {
    if (h.street === 3) return endHand(s, ctx);
    h.street = (h.street + 1) as 1 | 2 | 3; h.deck.shift(); // burn
    h.board.push(...h.deck.splice(0, h.street === 1 ? 3 : 1));
    h.bet = h.bet.map(() => 0); h.acted = h.acted.map(() => false); h.canRaise = h.canRaise.map(() => true); h.maxBet = 0; h.lastRaise = s.bb;
    h.aggr = h.aggr.map(() => false); h.last = h.last.map((x, i) => (h.folded[i] ? x : h.allIn[i] ? "All-in" : null));
    const acts = h.inHand.map((_, i) => i).filter((i) => canAct(h, i));
    if (acts.length >= 2) { h.turn = nextFrom(s, s.button, (i) => canAct(h, i)); return; }
  }
}
/** Split contributions into pots by level; award each to the best eligible hand(s). Exported for tests. */
export function buildPots(contrib: number[], folded: boolean[], inHand: boolean[]): { amount: number; eligible: number[] }[] {
  const levels = [...new Set(contrib.filter((c, i) => c > 0 && inHand[i]))].sort((a, b) => a - b); const pots: { amount: number; eligible: number[] }[] = []; let prev = 0;
  for (const L of levels) {
    const amount = contrib.reduce((a, c) => a + Math.max(0, Math.min(c, L) - prev), 0);
    const eligible = contrib.map((c, i) => (inHand[i] && !folded[i] && c >= L ? i : -1)).filter((i) => i >= 0);
    if (amount > 0) { const last = pots[pots.length - 1]; if (last && last.eligible.join() === eligible.join()) last.amount += amount; else pots.push({ amount, eligible }); }
    prev = L;
  }
  // a level nobody live reached (can't normally happen) rolls into the previous pot
  for (let k = pots.length - 1; k > 0; k--) if (!pots[k].eligible.length) { pots[k - 1].amount += pots[k].amount; pots.splice(k, 1); }
  return pots;
}
function endHand(s: PkState, ctx: Ctx) {
  const h = s.h!; const alive = live(h); const uncontested = alive.length === 1;
  while (!uncontested && h.board.length < 5) { h.deck.shift(); h.board.push(...h.deck.splice(0, h.board.length === 0 ? 3 : 1)); }
  const score = (i: number) => evaluate([...h.holes[i], ...h.board]);
  const scores = h.holes.map((_, i) => (alive.includes(i) && !uncontested ? score(i) : -1));
  const pots: Pot[] = [];
  for (const p of buildPots(h.contrib, h.folded, h.inHand)) {
    const best = Math.max(...p.eligible.map((i) => (uncontested ? 1 : scores[i])));
    const winners = p.eligible.filter((i) => (uncontested ? 1 : scores[i]) === best);
    const share = Math.floor(p.amount / winners.length); let odd = p.amount - share * winners.length;
    const order = [...winners].sort((a, b) => ((a - s.button + s.n) % s.n) - ((b - s.button + s.n) % s.n));
    for (const w of order) { s.seats[w].chips += share + (odd > 0 ? 1 : 0); odd--; }
    pots.push({ amount: p.amount, winners, eligible: p.eligible, refund: p.eligible.length === 1 && h.contrib.filter((c) => c > 0).length > 1 && pots.length > 0 });
  }
  const net = s.seats.map((x, i) => (h.inHand[i] ? x.chips - h.startChips[i] : 0));
  const winners = [...new Set(pots.filter((p) => !p.refund).flatMap((p) => p.winners))];
  const shown = uncontested ? [] : alive.map((i) => ({ seat: i, hole: h.holes[i].slice(), desc: describe(scores[i]) }));
  s.lastHand = { handNo: s.handNo, board: h.board.slice(), pots, shown, net, winners, uncontested };
  const main = pots.filter((p) => !p.refund).reduce((a, p) => a + p.amount, 0);
  pushLog(s, uncontested ? `${s.seats[alive[0]].name} wins ${main} uncontested` : `${winners.map((w) => s.seats[w].name).join(" & ")} win${winners.length > 1 ? "" : "s"} ${main} with ${describe(scores[winners[0]])}`, ctx.now);
  // ledger + results (humans) and reviews (everyone) — one hand = one game for history/tuning
  s.results = [];
  for (let i = 0; i < s.n; i++) {
    const x = s.seats[i]; if (!h.inHand[i] || x.kind !== "human") continue;
    if (net[i]) s.ledger.push({ seat: i, name: x.name, delta: net[i], reason: "hand", clamp: true });
    s.results.push({ seat: i, name: x.name, kind: "human", net: net[i], won: net[i] > 0, detail: { hand: s.handNo, net: net[i], board: h.board, showdown: !uncontested && alive.includes(i), desc: scores[i] >= 0 ? describe(scores[i]) : null } });
  }
  if (s.results.length) s.resultSeq++;
  s.reviews = s.seats.map((x, i) => ({ seat: i, kind: x.kind, level: x.kind === "bot" ? x.level : null, variant: x.kind === "bot" ? x.variant : null,
    metrics: { dealt: h.inHand[i], bb: h.inHand[i] ? net[i] / s.bb : 0, vpip: h.vpip[i], pfr: h.pfRaised[i], sd: !uncontested && alive.includes(i), won: winners.includes(i),
      folded: h.folded[i], bluff: h.bluffs[i], bluffWon: h.bluffs[i] && net[i] > 0, players: h.inHand.filter(Boolean).length } })).filter((r) => r.metrics.dealt);
  s.reviewSeq++;
  s.phase = "handover"; s.h = { ...h, turn: -1 };
}
function seatSpot(s: PkState, i: number): Sim.Spot {
  const h = s.h!; const x = s.seats[i]; const order = h.inHand.map((d, k) => (d ? k : -1)).filter((k) => k >= 0);
  const toCall = Math.min(h.maxBet - h.bet[i], x.chips);
  return { hole: h.holes[i], board: h.board, pot: potTotal(h), toCall, myBet: h.bet[i], chips: x.chips, minRaiseTo: Math.min(h.maxBet + h.lastRaise, h.bet[i] + x.chips),
    maxTo: h.bet[i] + x.chips, bb: s.bb, canRaise: h.canRaise[i] && x.chips > toCall, pos: Sim.position(order, i, s.button),
    opps: live(h).filter((k) => k !== i).map((k) => ({ seat: k, pfRaised: h.pfRaised[k], pfCalled: h.pfCalled[k], aggrStreet: h.aggr[k] })),
    street: h.street, facingRaise: h.maxBet > s.bb || h.raiser >= 0, iRaisedPre: h.pfRaised[i], nPlayers: order.length };
}
export const spotFor = seatSpot;
function act(s: PkState, i: number, m: Move, ctx: Ctx) {
  const h = s.h!; const x = s.seats[i]; const toCall = h.maxBet - h.bet[i];
  const nm = x.name;
  if (m.t === "fold") { if (toCall <= 0) throw new IllegalMove("Nothing to call — check instead"); h.folded[i] = true; h.last[i] = "Fold"; pushLog(s, `${nm} folds`, ctx.now); }
  else if (m.t === "check") { if (toCall > 0) throw new IllegalMove(`${toCall} to call`); h.last[i] = "Check"; }
  else if (m.t === "call") {
    if (toCall <= 0) throw new IllegalMove("Nothing to call"); const a = push(s, i, toCall);
    if (h.street === 0) { h.pfCalled[i] = true; h.vpip[i] = true; }
    h.last[i] = h.allIn[i] ? `All-in ${h.bet[i]}` : `Call ${a}`; pushLog(s, `${nm} ${h.allIn[i] ? "calls all-in" : "calls"} ${a}`, ctx.now);
  } else if (m.t === "raise") {
    const to = Math.floor(Number(m.to)); const maxTo = h.bet[i] + x.chips;
    if (!Number.isFinite(to)) throw new IllegalMove("Bad amount");
    if (!h.canRaise[i]) throw new IllegalMove("Betting isn't reopened to you — call or fold");
    if (to <= h.maxBet) throw new IllegalMove(`Raise to more than ${h.maxBet}`);
    if (to > maxTo) throw new IllegalMove(`You only have ${maxTo}`);
    const minTo = h.maxBet + h.lastRaise; if (to < minTo && to !== maxTo) throw new IllegalMove(`Minimum ${h.maxBet ? "raise" : "bet"} is to ${minTo}`);
    const inc = to - h.maxBet; const wasBet = h.maxBet === 0;
    push(s, i, to - h.bet[i]);
    if (inc >= h.lastRaise) { h.lastRaise = inc; for (let k = 0; k < s.n; k++) if (k !== i) h.canRaise[k] = true; }
    h.maxBet = to; h.aggr[i] = true; h.raiser = i;
    if (h.street === 0) { h.pfRaised[i] = true; h.vpip[i] = true; }
    h.last[i] = h.allIn[i] ? `All-in ${to}` : `${wasBet ? "Bet" : "Raise to"} ${to}`; pushLog(s, `${nm} ${h.allIn[i] ? "goes all-in for" : wasBet ? "bets" : "raises to"} ${to}`, ctx.now);
  } else throw new IllegalMove(`Can't ${m.t} now`);
  h.acted[i] = true; h.canRaise[i] = false;
  h.turn = i; settleStreet(s, ctx);
}
function botParams(s: PkState, i: number, ctx: Ctx, level: Level) { return paramsFor(Sim.DEFAULT_PARAMS, Sim.PARAM_BOUNDS, level, s.seats[i].variant, ctx); }
export function botMove(s: PkState, i: number, ctx: Ctx, levelOverride?: Level) {
  const level = levelOverride ?? s.seats[i].level; const P = botParams(s, i, ctx, level); const spot = seatSpot(s, i);
  const eq = spot.street > 0 && P.samples > 0 ? Sim.spotEquity(spot, { level, P, rng: ctx.rng }) : undefined;
  const d = Sim.decide(spot, { level, P, rng: ctx.rng, eqOverride: eq });
  if (d.t === "raise" && eq !== undefined && eq < 0.35) s.h!.bluffs[i] = true;
  act(s, i, d, ctx);
}
function advance(s: PkState, ctx: Ctx): PkState {
  for (let g = 0; g < 400; g++) {
    if (!humanCount(s)) break;
    if (s.phase === "waiting") { if (!s.live) { dealHand(s, ctx); continue; } break; }
    if (s.phase !== "betting") break;
    const a = actor(s); if (a < 0 || s.seats[a].kind !== "bot") break;
    botMove(s, a, ctx);
  }
  const a = actor(s); const multi = humanCount(s) > 1;
  s.deadline = s.phase === "betting" && a >= 0 && s.seats[a].kind === "human" && multi ? ctx.now + s.timeoutMs
    : s.phase === "handover" && multi && s.h ? ctx.now + 6000 : null;
  return s;
}
export function apply(s0: PkState, i: number, m: Move, ctx: Ctx): PkState {
  const s = clone(s0); const x = s.seats[i];
  if (!x || x.kind !== "human") throw new IllegalMove("Not your seat");
  x.idle = 0;
  if (m.t === "start") { if (s.phase !== "waiting") throw new IllegalMove("The game is already running"); dealHand(s, ctx); return advance(s, ctx); }
  if (m.t === "next") { if (s.phase !== "handover") throw new IllegalMove("Hand still in progress"); dealHand(s, ctx); return advance(s, ctx); }
  if (m.t === "rebuy") {
    if (s.phase === "betting" && s.h?.inHand[i]) throw new IllegalMove("Finish this hand first");
    if (x.chips >= s.bb) throw new IllegalMove("You still have chips");
    const add = Math.min(s.buyIn, Math.max(0, x.stack)) - x.chips; if (add <= 0) throw new IllegalMove("Your bankroll is empty");
    x.chips += add; x.sitOut = false; x.buyins++; pushLog(s, `${x.name} rebuys to ${x.chips}`, ctx.now);
    if (s.phase === "handover" && !s.h) dealHand(s, ctx);
    return advance(s, ctx);
  }
  if (s.phase !== "betting" || actor(s) !== i) throw new IllegalMove("Not your turn");
  act(s, i, m, ctx);
  return advance(s, ctx);
}
export function seatHuman(s0: PkState, i: number, p: Pending, ctx: Ctx): PkState {
  const s = clone(s0); const x = s.seats[i]; if (!x) throw new IllegalMove("No such seat");
  if (x.kind === "human") { if (x.tokenHash === p.tokenHash) { x.stack = p.stack; x.chips = Math.min(x.chips, Math.max(0, p.stack)); return s; } throw new IllegalMove("Seat taken"); }
  const chips = Math.min(s.buyIn, Math.max(0, p.stack));
  if (s.phase !== "betting") { s.seats[i] = fresh(humanBase(p), chips); pushLog(s, `${p.name} sat down with ${chips}`, ctx.now); if (s.phase === "handover" && !s.h && s.handNo) dealHand(s, ctx); }
  else { x.pending = p; pushLog(s, `${p.name} takes over ${x.name} after this hand`, ctx.now); }
  return advance(s, ctx);
}
export function leaveSeat(s0: PkState, i: number, ctx: Ctx): PkState {
  const s = clone(s0); const x = s.seats[i]; if (x?.kind !== "human") return s;
  const h = s.h; const inHand = s.phase === "betting" && h?.inHand[i];
  if (inHand && h) {
    const lost = x.chips - h.startChips[i]; if (lost) s.ledger.push({ seat: i, name: x.name, delta: lost, reason: "left mid-hand", clamp: true });
    h.startChips[i] = s.buyIn; if (!h.folded[i]) { h.folded[i] = true; h.last[i] = "Fold"; }
  }
  pushLog(s, `${x.name} left — a bot takes the seat`, ctx.now);
  s.seats[i] = fresh(botBase(i, s.botLevel, ctx.rng), s.buyIn);
  if (inHand && h) settleStreet(s, ctx);
  return advance(s, ctx);
}
/** Self-play (tests/tuner): deal one hand and let every seat's bot play it out. `params[i]` overrides seat i's parameters. */
export function botsHand(s: PkState, ctx: Ctx, params?: (Sim.BotParams | undefined)[]) {
  dealHand(s, ctx, true);
  for (let g = 0; g < 400 && s.phase === "betting"; g++) {
    const a = actor(s); const P0 = params?.[a];
    if (!P0) { botMove(s, a, ctx); continue; }
    const spot = seatSpot(s, a); const lv = s.seats[a].level;
    act(s, a, Sim.decide(spot, { level: lv, P: P0, rng: ctx.rng }), ctx);
  }
  return s;
}
export { findSeat } from "../seats.ts";
/** Clock ran out: check if free, else fold; three misses and a bot takes the seat. Between hands, deal the next one. */
export function timeout(s0: PkState, ctx: Ctx): PkState {
  if (!s0.deadline || ctx.now < s0.deadline) return s0;
  let s = clone(s0);
  if (s.phase === "handover") { dealHand(s, ctx); return advance(s, ctx); }
  const a = actor(s); if (a < 0 || s.seats[a].kind !== "human") return advance(s, ctx);
  s.seats[a].idle++; const h = s.h!; act(s, a, h.maxBet > h.bet[a] ? { t: "fold" } : { t: "check" }, ctx);
  if (s.seats[a].idle >= 3) s = leaveSeat(s, a, ctx);
  return advance(s, ctx);
}
/** Everyone's view: no hole cards (except the solo tutorial and hands shown down), no deck. */
export function publicView(s: PkState) {
  const h = s.h; const a = actor(s);
  const toCall = h && a >= 0 ? Math.min(h.maxBet - h.bet[a], s.seats[a].chips) : 0;
  return {
    game: s.game, n: s.n, phase: s.phase, actor: a, button: s.button, handNo: s.handNo, round: s.round, sb: s.sb, bb: s.bb, buyIn: s.buyIn,
    board: h?.board ?? [], street: h?.street ?? 0, pot: h ? potTotal(h) : 0, bets: h?.bet ?? [], contrib: h?.contrib ?? [], maxBet: h?.maxBet ?? 0, lastRaise: h?.lastRaise ?? s.bb,
    inHand: h?.inHand ?? [], folded: h?.folded ?? [], allIn: h?.allIn ?? [], last: h?.last ?? [], sbSeat: h?.sbSeat ?? -1, bbSeat: h?.bbSeat ?? -1,
    pfRaised: h?.pfRaised ?? [], pfCalled: h?.pfCalled ?? [], aggr: h?.aggr ?? [], raiser: h?.raiser ?? -1,
    toCall, canRaise: h && a >= 0 ? h.canRaise[a] && s.seats[a].chips > toCall : false, minRaiseTo: h && a >= 0 ? Math.min(h.maxBet + h.lastRaise, h.bet[a] + s.seats[a].chips) : 0,
    lastHand: s.lastHand, seats: s.seats.map((x) => stripSeat(x)),
    deadline: s.deadline, botLevel: s.botLevel, tutorial: s.tutorial, live: s.live, log: s.log.slice(-25), results: s.results, resultSeq: s.resultSeq,
    holes: s.tutorial && h ? h.holes : null,
  };
}
export type PublicPk = ReturnType<typeof publicView>;
/** Only for the seat's owner: their two hole cards for the current hand. */
export function privateView(s: PkState, i: number) {
  const h = s.h; if (!s.seats[i]) return null;
  return { hole: h && h.inHand[i] ? h.holes[i].slice() : [], handNo: s.handNo };
}
export type PrivatePk = NonNullable<ReturnType<typeof privateView>>;
