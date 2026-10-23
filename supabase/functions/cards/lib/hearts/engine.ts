// Hearts table engine: authoritative in the edge function, mirrored on the client for UI/coach. Pure TS.
// 4 seats: 13 each, pass left/right/across/hold. 3 seats: 2♦ removed, 17 each, pass left/right/hold.
// 2 seats: 13 each + 26-card stock drawn after each trick (winner first), pass/hold. Lowest club leads; no points on the first
// trick; hearts can't be led until broken. Hearts 1, Q♠ 13, moon = 0 for the shooter and 26 for everyone else. Game ends at 100: lowest wins.
import { type Card, type Rng, shuffle, IllegalMove, clone } from "../core.ts";
import { sortHand } from "../tricks.ts";
import * as Sim from "./sim.ts";
import { type BaseSeat, type Ctx, type Level, type Pending, type TableBase, botBase, humanBase, paramsFor, pushLog, humanCount, stripSeat } from "../seats.ts";

export type HSeat = BaseSeat & { passed: Card[] | null; received: Card[] };
export type LastHand = { handNo: number; raw: number[]; points: number[]; moon: number; qs: number; totals: number[] };
export type HtState = TableBase<HSeat> & {
  game: "hearts"; v: Sim.Variant; n: number; phase: "waiting" | "pass" | "play" | "gameover";
  dealer: number; h: Sim.Hs; scores: number[]; target: number; handNo: number; passOff: number;
  lastHand: LastHand | null; lastTrick: Sim.Trick | null; stake: number; winner: number[] | null; heldQ: number; nextDeck?: Card[];
};
export type Move = { t: "pass"; cards: Card[] } | { t: "play"; card: Card } | { t: "start" };
export const SEATS = { min: 2, max: 4 };
const fresh = (b: BaseSeat): HSeat => ({ ...b, passed: null, received: [] });

export function newTable(o: { seats: number; botLevel: Level; now: number; rng: Rng; timeoutMs?: number; tutorial?: boolean; live?: boolean; deck?: Card[]; target?: number }): HtState {
  const n = Math.max(2, Math.min(4, o.seats)); const v = Sim.variantFor(n);
  const seats = Array.from({ length: n }, (_, i) => fresh(botBase(i, o.botLevel, o.rng)));
  return {
    game: "hearts", v, n, seats, phase: "waiting", dealer: n - 1, h: Sim.newHs(v, seats.map(() => []), 0), scores: Array(n).fill(0),
    target: o.target ?? 100, handNo: 0, passOff: 0, lastHand: null, lastTrick: null, stake: 100, winner: null, heldQ: -1, nextDeck: o.deck,
    log: [], ledger: [], results: [], resultSeq: 0, reviews: [], reviewSeq: 0, deadline: null, timeoutMs: o.timeoutMs ?? 30000,
    botLevel: o.botLevel, tutorial: !!o.tutorial, live: !!o.live, startedAt: o.now, round: 0,
  };
}
export function actor(s: HtState) { return s.phase === "play" ? s.h.turn : -1; }
export const passTarget = (s: HtState, i: number) => (i + s.passOff) % s.n;

function deal(s: HtState, ctx: Ctx) {
  const deck = s.nextDeck ?? shuffle(Sim.deckFor(s.v), ctx.rng); s.nextDeck = undefined;
  s.handNo++; s.round = s.handNo; s.dealer = (s.dealer + 1) % s.n; s.lastTrick = null;
  const hs = Sim.handSize(s.v);
  const hands = s.seats.map((_, i) => deck.slice(i * hs, (i + 1) * hs));
  s.h = Sim.newHs(s.v, hands, 0, s.v === "two" ? deck.slice(2 * hs) : []);
  for (const x of s.seats) { x.passed = null; x.received = []; }
  s.passOff = Sim.passOffset(s.n, s.handNo);
  pushLog(s, `Hand ${s.handNo} dealt — ${s.passOff ? `pass ${Sim.passName(s.n, s.passOff)}` : "no pass"}`, ctx.now);
  if (s.passOff) s.phase = "pass"; else startPlay(s);
}
function startPlay(s: HtState) {
  s.phase = "play"; const L = Sim.firstLeader(s.h.hands); s.h.leader = s.h.turn = L;
  s.heldQ = s.h.hands.findIndex((x) => x.includes("QS"));
}
function doPass(s: HtState, i: number, cards: Card[], ctx: Ctx) {
  const x = s.seats[i]; if (x.passed) throw new IllegalMove("Already passed");
  const uniq = [...new Set(cards.map(String))];
  if (uniq.length !== 3 || !uniq.every((c) => s.h.hands[i].includes(c))) throw new IllegalMove("Pick three cards from your hand");
  x.passed = uniq;
  if (s.seats.every((y) => y.passed)) {
    for (let k = 0; k < s.n; k++) s.h.hands[k] = s.h.hands[k].filter((c) => !s.seats[k].passed!.includes(c));
    for (let k = 0; k < s.n; k++) { const to = passTarget(s, k); s.h.hands[to].push(...s.seats[k].passed!); s.seats[to].received = s.seats[k].passed!.slice(); }
    pushLog(s, `Cards passed ${Sim.passName(s.n, s.passOff)}`, ctx.now);
    startPlay(s);
  }
}
function doPlay(s: HtState, i: number, card: Card, ctx: Ctx) {
  if (!Sim.legal(s.h, i).includes(card)) throw new IllegalMove(!s.h.hands[i].includes(card) ? "That card isn't in your hand" : s.h.history.length === 0 && !s.h.trick.length ? "The lowest club leads the first trick" : s.h.trick.length ? "Follow suit (no points on the first trick)" : "Hearts aren't broken yet");
  const before = s.h.history.length; Sim.play(s.h, i, card);
  if (s.h.history.length > before) s.lastTrick = s.h.history[s.h.history.length - 1];
  if (Sim.handDone(s.h)) endHand(s, ctx);
}
function endHand(s: HtState, ctx: Ctx) {
  const h = s.h; const sc = Sim.scoreHand(h.pts);
  s.scores = s.scores.map((x, i) => x + sc.points[i]);
  s.lastHand = { handNo: s.handNo, raw: h.pts.slice(), points: sc.points, moon: sc.moon, qs: h.qs, totals: s.scores.slice() };
  s.reviews = s.seats.map((x, i) => ({ seat: i, kind: x.kind, level: x.kind === "bot" ? x.level : null, variant: x.kind === "bot" ? x.variant : null,
    metrics: { v: s.v, points: sc.points[i], raw: h.pts[i], qs: h.qs === i, heldQ: s.heldQ === i, moon: sc.moon === i, oppMoon: sc.moon >= 0 && sc.moon !== i,
      rel: sc.points.reduce((a, p, k) => a + (k === i ? 0 : p), 0) / (s.n - 1) - sc.points[i] } }));
  s.reviewSeq++;
  pushLog(s, sc.moon >= 0 ? `${s.seats[sc.moon].name} shot the moon!` : `Hand ${s.handNo}: ${sc.points.map((p, i) => `${s.seats[i].name.replace(" 🤖", "")} ${p}`).join(" · ")}`, ctx.now);
  for (let i = 0; i < s.n; i++) { const p = s.seats[i].pending; if (p) { s.seats[i] = fresh(humanBase(p)); pushLog(s, `${p.name} sat down`, ctx.now); } }
  if (Math.max(...s.scores) >= s.target) {
    const low = Math.min(...s.scores); const winners = s.scores.map((x, i) => (x === low ? i : -1)).filter((i) => i >= 0);
    s.phase = "gameover"; s.winner = winners; s.results = [];
    for (let i = 0; i < s.n; i++) {
      const x = s.seats[i]; if (x.kind !== "human") continue;
      const won = winners.includes(i); const net = won ? s.stake : -s.stake;
      s.ledger.push({ seat: i, name: x.name, delta: net, reason: "game", clamp: true });
      s.results.push({ seat: i, name: x.name, kind: x.kind, net, won, detail: { variant: s.v, scores: s.scores, hands: s.handNo, net } });
    }
    s.resultSeq++; pushLog(s, `Game over — ${winners.map((i) => s.seats[i].name).join(" & ")} win${winners.length > 1 ? "" : "s"} with ${low}`, ctx.now);
  } else deal(s, ctx);
}
function botParams(s: HtState, i: number, ctx: Ctx, level: Level) { return paramsFor(Sim.DEFAULT_PARAMS, Sim.PARAM_BOUNDS, level, s.seats[i].variant, ctx); }
export function botMove(s: HtState, i: number, ctx: Ctx, levelOverride?: Level) {
  const x = s.seats[i]; const level = levelOverride ?? x.level; const P = botParams(s, i, ctx, level);
  if (s.phase === "pass") return doPass(s, i, Sim.botPass(s.h.hands[i], level, P, ctx.rng), ctx);
  if (s.phase === "play") {
    const given = x.passed && s.passOff ? { to: passTarget(s, i), cards: x.passed } : null;
    return doPlay(s, i, Sim.botCard(s.h, i, { level, P, rng: ctx.rng, deck: Sim.deckFor(s.v) }, given), ctx);
  }
}
function advance(s: HtState, ctx: Ctx): HtState {
  for (let g = 0; g < 500; g++) {
    if (!humanCount(s)) break;
    if (s.phase === "waiting") { if (!s.live) { deal(s, ctx); continue; } break; }
    if (s.phase === "gameover") break;
    if (s.phase === "pass") { const b = s.seats.findIndex((x) => x.kind === "bot" && !x.passed); if (b >= 0) { botMove(s, b, ctx); continue; } break; }
    const a = actor(s); if (a < 0 || s.seats[a].kind !== "bot") break;
    botMove(s, a, ctx);
  }
  const waitingHuman = s.phase === "pass" ? s.seats.some((x) => x.kind === "human" && !x.passed) : actor(s) >= 0 && s.seats[actor(s)].kind === "human";
  s.deadline = waitingHuman && humanCount(s) > 1 ? ctx.now + s.timeoutMs + (s.phase === "pass" ? 15000 : 0) : null;
  return s;
}
export function apply(s0: HtState, i: number, m: Move, ctx: Ctx): HtState {
  const s = clone(s0); const x = s.seats[i];
  if (!x || x.kind !== "human") throw new IllegalMove("Not your seat");
  if (m.t === "start") {
    if (s.phase !== "waiting" && s.phase !== "gameover") throw new IllegalMove("A game is already running");
    if (s.phase === "gameover") { s.scores = s.scores.map(() => 0); s.winner = null; s.handNo = 0; s.lastHand = null; s.startedAt = ctx.now; }
    deal(s, ctx); return advance(s, ctx);
  }
  x.idle = 0;
  if (m.t === "pass" && s.phase === "pass") doPass(s, i, Array.isArray(m.cards) ? m.cards.map(String) : [], ctx);
  else if (m.t === "play" && s.phase === "play") { if (actor(s) !== i) throw new IllegalMove("Not your turn"); doPlay(s, i, String(m.card), ctx); }
  else throw new IllegalMove(`Can't ${m.t} now`);
  return advance(s, ctx);
}
export function seatHuman(s0: HtState, i: number, p: Pending, ctx: Ctx): HtState {
  const s = clone(s0); const x = s.seats[i]; if (!x) throw new IllegalMove("No such seat");
  if (x.kind === "human") { if (x.tokenHash === p.tokenHash) { x.stack = p.stack; return s; } throw new IllegalMove("Seat taken"); }
  if (s.phase === "waiting" || s.phase === "gameover") { s.seats[i] = fresh(humanBase(p)); pushLog(s, `${p.name} sat down`, ctx.now); }
  else { x.pending = p; pushLog(s, `${p.name} takes over ${x.name} after this hand`, ctx.now); }
  return advance(s, ctx);
}
export function leaveSeat(s0: HtState, i: number, ctx: Ctx): HtState {
  const s = clone(s0); const x = s.seats[i]; if (x?.kind !== "human") return s;
  pushLog(s, `${x.name} left — a bot takes the seat`, ctx.now);
  s.seats[i] = { ...fresh(botBase(i, s.botLevel, ctx.rng)), passed: x.passed, received: x.received };
  return advance(s, ctx);
}
export { findSeat } from "../seats.ts";
/** Clock ran out: a medium bot passes/plays for the human; three misses in a row and a bot takes the seat. */
export function timeout(s0: HtState, ctx: Ctx): HtState {
  if (!s0.deadline || ctx.now < s0.deadline) return s0;
  let s = clone(s0);
  const late = s.phase === "pass" ? s.seats.map((x, i) => (x.kind === "human" && !x.passed ? i : -1)).filter((i) => i >= 0) : actor(s) >= 0 && s.seats[actor(s)].kind === "human" ? [actor(s)] : [];
  for (const a of late) { if (s.phase === "pass" && s.seats[a].passed) continue; s.seats[a].idle++; botMove(s, a, ctx, "medium"); }
  for (const a of late) if (s.seats[a]?.kind === "human" && s.seats[a].idle >= 3) s = leaveSeat(s, a, ctx);
  return advance(s, ctx);
}
/** Everyone's view: no hands (except a solo tutorial), no stock, no passed cards, no tokens. */
export function publicView(s: HtState) {
  const h = s.h;
  return {
    game: s.game, v: s.v, n: s.n, phase: s.phase, actor: actor(s), dealer: s.dealer, handNo: s.handNo, round: s.round, scores: s.scores, target: s.target, stake: s.stake, winner: s.winner,
    passOff: s.passOff, passed: s.seats.map((x) => !!x.passed), trick: h.trick, trickSeats: h.trickSeats, leader: h.leader, broken: h.broken, pts: h.pts, qs: h.qs,
    counts: h.hands.map((x) => x.length), history: h.history, lastTrick: s.lastTrick, lastHand: s.lastHand, stockLeft: h.stock.length,
    seats: s.seats.map((x) => { const { passed: _p, received: _r, ...r } = stripSeat(x); return r; }),
    deadline: s.deadline, botLevel: s.botLevel, tutorial: s.tutorial, live: s.live, log: s.log.slice(-25), results: s.results, resultSeq: s.resultSeq,
    hands: s.tutorial ? h.hands.map((x) => sortHand(x)) : null,
  };
}
export type PublicHt = ReturnType<typeof publicView>;
/** Only for the seat's owner: their hand, the three cards they passed (and to whom), the three they received, their stock draws. */
export function privateView(s: HtState, i: number) {
  const x = s.seats[i]; if (!x) return null;
  return { hand: sortHand(s.h.hands[i]), passed: x.passed, passTo: s.passOff ? passTarget(s, i) : -1, received: s.phase === "pass" ? [] : x.received, drawn: s.h.drawn[i].slice(-1) };
}
export type PrivateHt = NonNullable<ReturnType<typeof privateView>>;
