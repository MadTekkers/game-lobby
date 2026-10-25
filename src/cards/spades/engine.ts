// Spades table engine: authoritative in the edge function, mirrored on the client for UI/coach. Pure TS.
// 4 seats: partnerships (0&2 vs 1&3). 3 seats: cutthroat (2♣ removed, 17 cards each). 2 seats: draw variant (keep-or-take from the stock).
// Nil ±100, blind nil ±200 (offered when you trail by 100+, before you look), 10 bags = −100, game to 500 (or a side falls to −200).
import { type Card, type Rng, shuffle, IllegalMove, clone, frame } from "../core.ts";
import { sortHand } from "../tricks.ts";
import * as Sim from "./sim.ts";
import { type BaseSeat, type Ctx, type Level, type Pending, type TableBase, botBase, humanBase, paramsFor, pushLog, humanCount, stripSeat } from "../seats.ts";

export type SSeat = BaseSeat & { looked: boolean; seenDiscard: Card[] };
export type LastHand = { handNo: number; bids: (number | null)[]; nil: number[]; tricks: number[]; score: Sim.HandScore; penalties: number[]; totals: number[] };
export type SpState = TableBase<SSeat> & {
  game: "spades"; v: Sim.Variant; n: number; phase: "waiting" | "draw" | "bidding" | "play" | "gameover";
  dealer: number; h: Sim.Hs; stock: Card[]; turn: number; scores: number[]; bags: number[]; target: number; floor: number;
  handNo: number; lastHand: LastHand | null; lastTrick: Sim.Trick | null; stake: number; winner: number[] | null; est: number[]; nextDeck?: Card[];
};
export type Move = { t: "bid"; n: number; blind?: boolean } | { t: "look" } | { t: "play"; card: Card } | { t: "keep" } | { t: "discard" } | { t: "start" };
export const variantFor = (n: number): Sim.Variant => (n >= 4 ? "partners" : n === 3 ? "cutthroat" : "draw");
export const SEATS = { min: 2, max: 4 };

const bot = (i: number, level: Level, rng: Rng): SSeat => ({ ...botBase(i, level, rng), looked: false, seenDiscard: [] });
export function newTable(o: { seats: number; botLevel: Level; now: number; rng: Rng; timeoutMs?: number; tutorial?: boolean; live?: boolean; deck?: Card[]; target?: number }): SpState {
  const n = Math.max(2, Math.min(4, o.seats)); const v = variantFor(n);
  const seats = Array.from({ length: n }, (_, i) => bot(i, o.botLevel, o.rng));
  return {
    game: "spades", v, n, seats, phase: "waiting", dealer: n - 1, h: Sim.newHs(v, seats.map(() => []), 0), stock: [], turn: 0,
    scores: Array(Sim.nTeams(v, n)).fill(0), bags: Array(Sim.nTeams(v, n)).fill(0), target: o.target ?? 500, floor: -200,
    handNo: 0, lastHand: null, lastTrick: null, stake: 100, winner: null, est: Array(n).fill(0), nextDeck: o.deck,
    log: [], ledger: [], results: [], resultSeq: 0, reviews: [], reviewSeq: 0, deadline: null, timeoutMs: o.timeoutMs ?? 30000,
    botLevel: o.botLevel, tutorial: !!o.tutorial, live: !!o.live, startedAt: o.now, round: 0,
  };
}
export const team = (s: SpState, i: number) => Sim.teamOf(s.v, i);
export function actor(s: SpState) { return s.phase === "draw" || s.phase === "bidding" ? s.turn : s.phase === "play" ? s.h.turn : -1; }
export function blindEligible(s: SpState, i: number) {
  if (s.v === "draw" || s.phase !== "bidding" || s.h.bids[i] !== null || s.seats[i].looked) return false;
  const t = team(s, i); const opp = Math.max(...s.scores.filter((_, k) => k !== t));
  return s.scores[t] <= opp - 100;
}

function deal(s: SpState, ctx: Ctx) {
  const deck = s.nextDeck ?? shuffle(Sim.deckFor(s.v), ctx.rng); s.nextDeck = undefined;
  s.handNo++; s.round = s.handNo; s.dealer = (s.dealer + 1) % s.n; const first = (s.dealer + 1) % s.n;
  for (const x of s.seats) { x.looked = false; x.seenDiscard = []; }
  s.lastTrick = null;
  if (s.v === "draw") { s.stock = deck; s.h = Sim.newHs(s.v, [[], []], first); s.phase = "draw"; s.turn = first; }
  else {
    const hs = Sim.handSize(s.v); s.h = Sim.newHs(s.v, s.seats.map((_, i) => deck.slice(i * hs, (i + 1) * hs)), first);
    startBidding(s);
  }
  pushLog(s, `Hand ${s.handNo} dealt`, ctx.now);
}
function startBidding(s: SpState) { s.phase = "bidding"; s.turn = s.h.leader; s.est = s.h.hands.map((x) => Math.round(Sim.estimate(x, s.v) * 10) / 10); }

function doBid(s: SpState, i: number, n: number, blind: boolean, ctx: Ctx) {
  const hs = Sim.handSize(s.v);
  if (!Number.isInteger(n) || n < 0 || n > hs) throw new IllegalMove(`Bid 0–${hs}`);
  if (blind && (n !== 0 || !blindEligible(s, i))) throw new IllegalMove("Blind nil isn't available");
  s.h.bids[i] = n; s.h.nil[i] = n === 0 ? (blind ? 2 : 1) : 0; s.seats[i].looked = true;
  pushLog(s, `${s.seats[i].name} bids ${n === 0 ? (blind ? "blind nil" : "nil") : n}`, ctx.now);
  if (s.h.bids.every((b) => b !== null)) { s.phase = "play"; s.h.turn = s.h.leader; } else s.turn = (i + 1) % s.n;
}
function doDraw(s: SpState, i: number, keep: boolean) {
  const seat = s.seats[i]; const top = s.stock.shift()!; const next = s.stock.shift()!;
  if (keep) { s.h.hands[i].push(top); seat.seenDiscard.push(next); } else { seat.seenDiscard.push(top); s.h.hands[i].push(next); }
  if (!s.stock.length) startBidding(s); else s.turn = (i + 1) % s.n;
}
function doPlay(s: SpState, i: number, card: Card, ctx: Ctx) {
  if (!Sim.legal(s.h, i).includes(card)) throw new IllegalMove(s.h.hands[i].includes(card) ? "You must follow suit (and spades can't lead until broken)" : "That card isn't in your hand");
  if (s.h.trick.length === s.n - 1) frame(s, { trick: [...s.h.trick, card], trickSeats: [...s.h.trickSeats, i], actor: i, counts: s.h.hands.map((x, k) => x.length - (k === i ? 1 : 0)) }); // full trick, before it's collected
  const before = s.h.history.length; Sim.play(s.h, i, card);
  if (s.h.history.length > before) { s.lastTrick = s.h.history[s.h.history.length - 1]; }
  if (Sim.handDone(s.h)) endHand(s, ctx);
  frame(s);
}
function endHand(s: SpState, ctx: Ctx) {
  const h = s.h; const sc = Sim.scoreHand(s.v, h.bids, h.nil, h.tricks); const pen: number[] = [];
  for (let t = 0; t < s.scores.length; t++) { const r = Sim.applyBags(s.scores[t] + sc.points[t], s.bags[t], sc.bags[t]); s.scores[t] = r.score; s.bags[t] = r.bags; pen.push(r.penalties); }
  s.lastHand = { handNo: s.handNo, bids: h.bids.slice(), nil: h.nil.slice(), tricks: h.tricks.slice(), score: sc, penalties: pen, totals: s.scores.slice() };
  s.reviews = s.seats.map((x, i) => ({ seat: i, kind: x.kind, level: x.kind === "bot" ? x.level : null, variant: x.kind === "bot" ? x.variant : null,
    metrics: { v: s.v, bid: h.bids[i] ?? 0, nil: h.nil[i], tricks: h.tricks[i], est: s.est[i], made: sc.made[team(s, i)], nilOk: sc.nilOk[i] ?? "", bags: sc.bags[team(s, i)], points: sc.points[team(s, i)] } }));
  s.reviewSeq++;
  pushLog(s, `Hand ${s.handNo}: ${sc.points.map((p, t) => `${teamName(s, t)} ${p >= 0 ? "+" : ""}${p}`).join(" · ")}`, ctx.now);
  for (let i = 0; i < s.n; i++) { const p = s.seats[i].pending; if (p) { s.seats[i] = { ...humanBase(p), looked: false, seenDiscard: [] }; pushLog(s, `${p.name} sat down`, ctx.now); } }
  const top = Math.max(...s.scores); const leaders = s.scores.map((x, t) => (x === top ? t : -1)).filter((t) => t >= 0);
  const over = (top >= s.target && leaders.length === 1) || Math.min(...s.scores) <= s.floor;
  if (over) {
    s.phase = "gameover"; s.winner = leaders; s.results = [];
    for (let i = 0; i < s.n; i++) {
      const x = s.seats[i]; if (x.kind !== "human") continue;
      const won = leaders.includes(team(s, i)); const net = won ? s.stake : -s.stake;
      s.ledger.push({ seat: i, name: x.name, delta: net, reason: "game", clamp: true });
      s.results.push({ seat: i, name: x.name, kind: x.kind, net, won, detail: { variant: s.v, scores: s.scores, team: team(s, i), hands: s.handNo, net } });
    }
    s.resultSeq++; pushLog(s, `Game over — ${leaders.map((t) => teamName(s, t)).join(" & ")} win${leaders.length > 1 ? "" : "s"}`, ctx.now);
  } else deal(s, ctx);
}
export function teamName(s: { v: Sim.Variant; seats: { name: string }[] }, t: number) {
  return s.v === "partners" ? `${s.seats[t].name.replace(" 🤖", "")} & ${s.seats[t + 2].name.replace(" 🤖", "")}` : s.seats[t].name;
}

export function botMove(s: SpState, i: number, ctx: Ctx, levelOverride?: Level) {
  const x = s.seats[i]; const level = levelOverride ?? x.level;
  const P = paramsFor(Sim.DEFAULT_PARAMS, Sim.PARAM_BOUNDS, level, x.variant, ctx);
  if (s.phase === "draw") return doDraw(s, i, Sim.botKeep(s.stock[0], s.h.hands[i], level, ctx.rng));
  if (s.phase === "bidding") { const b = Sim.botBid({ v: s.v, seat: i, hand: s.h.hands[i], bids: s.h.bids, nil: s.h.nil, teamBags: s.bags[team(s, i)], level, P, rng: ctx.rng }); return doBid(s, i, b.n, false, ctx); }
  if (s.phase === "play") return doPlay(s, i, Sim.botCard(s.h, i, { level, P, rng: ctx.rng, deck: Sim.deckFor(s.v) }), ctx);
}
function advance(s: SpState, ctx: Ctx): SpState {
  for (let g = 0; g < 500; g++) {
    if (!humanCount(s)) break; // bots never play on their own
    if (s.phase === "waiting") { if (!s.live) { deal(s, ctx); continue; } break; }
    if (s.phase === "gameover") break;
    const a = actor(s); if (a < 0 || s.seats[a].kind !== "bot") break;
    botMove(s, a, ctx);
  }
  const a = actor(s);
  s.deadline = a >= 0 && s.seats[a].kind === "human" && humanCount(s) > 1 ? ctx.now + s.timeoutMs : null;
  return s;
}

export function apply(s0: SpState, i: number, m: Move, ctx: Ctx): SpState {
  const s = clone(s0); const x = s.seats[i];
  if (!x || x.kind !== "human") throw new IllegalMove("Not your seat");
  if (m.t === "start") {
    if (s.phase !== "waiting" && s.phase !== "gameover") throw new IllegalMove("A game is already running");
    if (s.phase === "gameover") { s.scores = s.scores.map(() => 0); s.bags = s.bags.map(() => 0); s.winner = null; s.handNo = 0; s.lastHand = null; s.startedAt = ctx.now; }
    deal(s, ctx); return advance(s, ctx);
  }
  if (m.t === "look") { if (s.phase !== "bidding") throw new IllegalMove("Not bidding"); x.looked = true; return s; }
  if (actor(s) !== i) throw new IllegalMove("Not your turn");
  x.idle = 0;
  if (m.t === "bid" && s.phase === "bidding") doBid(s, i, Math.floor(Number(m.n)), !!m.blind, ctx);
  else if ((m.t === "keep" || m.t === "discard") && s.phase === "draw") doDraw(s, i, m.t === "keep");
  else if (m.t === "play" && s.phase === "play") doPlay(s, i, String(m.card), ctx);
  else throw new IllegalMove(`Can't ${m.t} now`);
  return advance(s, ctx);
}
export function seatHuman(s0: SpState, i: number, p: Pending, ctx: Ctx): SpState {
  const s = clone(s0); const x = s.seats[i]; if (!x) throw new IllegalMove("No such seat");
  if (x.kind === "human") { if (x.tokenHash === p.tokenHash) { x.stack = p.stack; return s; } throw new IllegalMove("Seat taken"); }
  if (s.phase === "waiting" || s.phase === "gameover") { s.seats[i] = { ...humanBase(p), looked: false, seenDiscard: [] }; pushLog(s, `${p.name} sat down`, ctx.now); }
  else { x.pending = p; pushLog(s, `${p.name} takes over ${x.name} after this hand`, ctx.now); }
  return advance(s, ctx);
}
export function leaveSeat(s0: SpState, i: number, ctx: Ctx): SpState {
  const s = clone(s0); const x = s.seats[i]; if (x?.kind !== "human") return s;
  pushLog(s, `${x.name} left — a bot takes the seat`, ctx.now);
  const b = bot(i, s.botLevel, ctx.rng); s.seats[i] = { ...b, looked: x.looked, seenDiscard: x.seenDiscard };
  return advance(s, ctx);
}
export { findSeat } from "../seats.ts";
/** A human's clock ran out: a medium bot moves for them; three misses in a row and a bot takes the seat. */
export function timeout(s0: SpState, ctx: Ctx): SpState {
  if (!s0.deadline || ctx.now < s0.deadline) return s0;
  let s = clone(s0); const a = actor(s); if (a < 0 || s.seats[a].kind !== "human") return advance(s, ctx);
  s.seats[a].idle++; botMove(s, a, ctx, "medium");
  if (s.seats[a].idle >= 3) s = leaveSeat(s, a, ctx);
  return advance(s, ctx);
}
const handHidden = (s: SpState, i: number) => blindEligible(s, i) && s.seats[i].kind === "human";
/** Everyone's view: no hands (except a solo tutorial), no stock order, no tokens. */
export function publicView(s: SpState) {
  const h = s.h;
  return {
    game: s.game, v: s.v, n: s.n, phase: s.phase, actor: actor(s), dealer: s.dealer, handNo: s.handNo, round: s.round, scores: s.scores, bags: s.bags, target: s.target, stake: s.stake, winner: s.winner,
    trick: h.trick, trickSeats: h.trickSeats, leader: h.leader, broken: h.broken, bids: h.bids, nil: h.nil, tricks: h.tricks, counts: h.hands.map((x) => x.length),
    history: h.history, lastTrick: s.lastTrick, lastHand: s.lastHand, stockLeft: s.stock.length,
    seats: s.seats.map((x) => { const { seenDiscard: _d, ...r } = stripSeat(x); return r; }),
    deadline: s.deadline, botLevel: s.botLevel, tutorial: s.tutorial, live: s.live, log: s.log.slice(-25), results: s.results, resultSeq: s.resultSeq,
    hands: s.tutorial ? h.hands.map((x, i) => (handHidden(s, i) ? null : sortHand(x))) : null,
  };
}
export type PublicSp = ReturnType<typeof publicView>;
/** Only for the seat's owner: their hand (hidden while a blind nil is on offer), the stock card they may keep, their own discards. */
export function privateView(s: SpState, i: number) {
  const x = s.seats[i]; if (!x) return null;
  return { hand: handHidden(s, i) ? null : sortHand(s.h.hands[i]), blindOffer: blindEligible(s, i), peek: s.phase === "draw" && s.turn === i ? s.stock[0] ?? null : null, seenDiscard: x.seenDiscard };
}
export type PrivateSp = NonNullable<ReturnType<typeof privateView>>;
