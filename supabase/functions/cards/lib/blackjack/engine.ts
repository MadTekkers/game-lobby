// Blackjack rules engine: pure, deterministic given an RNG. Used by the edge function (authoritative) and the client (UI, hints, train mode).
// Rules: 6-deck shoe (reshuffle below 25%), dealer stands on all 17s (hits soft 16), dealer peeks on A/10, blackjack pays 3:2,
// double on any first two cards (also after split), split up to 3 hands (aces: one card each, no resplit), insurance 2:1, no surrender.
import { type Card, type Rng, makeDeck, shuffle, IllegalMove, clone } from "../core.ts";
import { handValue, isBlackjack, sameValue, basicStrategy, cardValue, type Action } from "./strategy.ts";

export type Level = "easy" | "medium" | "hard";
export type Hand = { cards: Card[]; bet: number; doubled?: boolean; done?: boolean; split?: boolean; aces?: boolean; result?: "blackjack" | "win" | "push" | "lose" | "bust"; net?: number };
export type Pending = { name: string; tokenHash: string; stack: number };
export type Seat = {
  kind: "human" | "bot" | "empty"; name: string; level?: Level; tokenHash?: string; stack: number;
  bet: number; decided: boolean; insurance: number | null; hands: Hand[]; inRound: boolean; idle: number; pending?: Pending | null; hints?: number;
};
export type Ev = { t: string; seat?: number; hand?: number; card?: Card; text?: string; at: number };
export type Ledger = { seat: number; name: string; delta: number; reason: string };
export type BJState = {
  game: "blackjack"; seats: Seat[]; shoe: Card[]; decks: number; dealer: Card[]; holeHidden: boolean;
  phase: "betting" | "insurance" | "play"; turn: { seat: number; hand: number } | null; round: number;
  minBet: number; maxBet: number; deadline: number | null; timeoutMs: number; botLevel: Level;
  log: Ev[]; ledger: Ledger[]; results: { seat: number; name: string; kind: string; bet: number; net: number; hands: Hand[] }[]; reshuffled: boolean; startedAt: number; tutorial?: boolean; live?: boolean;
};
export type Move = { t: "bet"; amount: number } | { t: "sitout" } | { t: "insurance"; take: boolean } | { t: Action };
export type Ctx = { rng: Rng; now: number };

export const BOT_NAMES = ["Dot", "Ace", "Lucky", "Penny", "Chip", "Rosie", "Duke", "Mo"];
const START_STACK = 1000;
const ERR: Record<Level, number> = { easy: 0.22, medium: 0.07, hard: 0 };

const emptySeat = (): Seat => ({ kind: "empty", name: "", stack: 0, bet: 0, decided: false, insurance: null, hands: [], inRound: false, idle: 0 });
export function botSeat(i: number, level: Level): Seat { return { ...emptySeat(), kind: "bot", name: `${BOT_NAMES[i % BOT_NAMES.length]} 🤖`, level, stack: START_STACK }; }

export function newTable(o: { seats: number; botLevel: Level; now: number; rng: Rng; minBet?: number; maxBet?: number; timeoutMs?: number; shoe?: Card[]; tutorial?: boolean; live?: boolean }): BJState {
  const n = Math.max(1, Math.min(4, o.seats));
  return {
    game: "blackjack", seats: Array.from({ length: n }, (_, i) => botSeat(i, o.botLevel)), shoe: o.shoe ?? shuffle(makeDeck(6), o.rng), decks: 6,
    dealer: [], holeHidden: true, phase: "betting", turn: null, round: 1, minBet: o.minBet ?? 10, maxBet: o.maxBet ?? 500,
    deadline: null, timeoutMs: o.timeoutMs ?? 30000, botLevel: o.botLevel, log: [], ledger: [], results: [], reshuffled: false, startedAt: o.now, tutorial: !!o.tutorial, live: !!o.live,
  };
}
const humans = (s: BJState) => s.seats.filter((x) => x.kind === "human");
const log = (s: BJState, e: Omit<Ev, "at">, now: number) => { s.log.push({ ...e, at: now }); if (s.log.length > 60) s.log.splice(0, s.log.length - 60); };
const debit = (s: BJState, i: number, amt: number, reason: string) => {
  const seat = s.seats[i]; if (seat.stack < amt) throw new IllegalMove("Not enough chips");
  seat.stack -= amt; if (seat.kind === "human") s.ledger.push({ seat: i, name: seat.name, delta: -amt, reason });
};
const credit = (s: BJState, i: number, amt: number, reason: string) => {
  if (amt <= 0) return; const seat = s.seats[i]; seat.stack += amt; if (seat.kind === "human") s.ledger.push({ seat: i, name: seat.name, delta: amt, reason });
};
function draw(s: BJState, ctx: Ctx): Card {
  if (!s.shoe.length) { s.shoe = shuffle(makeDeck(s.decks), ctx.rng); s.reshuffled = true; }
  return s.shoe.shift()!;
}

/** Seat a human: immediately if the seat is not in a hand, otherwise when the current hand ends (a bot keeps playing until then). */
export function seatHuman(s0: BJState, seatIdx: number, p: Pending, ctx: Ctx): BJState {
  const s = clone(s0); const seat = s.seats[seatIdx];
  if (!seat) throw new IllegalMove("No such seat");
  if (seat.kind === "human") { if (seat.tokenHash === p.tokenHash) { seat.stack = p.stack; return s; } throw new IllegalMove("Seat taken"); }
  if (s.phase === "betting" && !seat.inRound) {
    s.seats[seatIdx] = { ...emptySeat(), kind: "human", name: p.name, tokenHash: p.tokenHash, stack: p.stack, hints: 0 };
    log(s, { t: "join", seat: seatIdx, text: `${p.name} sat down` }, ctx.now);
  } else { seat.pending = p; log(s, { t: "queue", seat: seatIdx, text: `${p.name} takes over after this hand` }, ctx.now); }
  return advance(s, ctx);
}
/** A human leaves: a bot takes the seat (immediately if not in a hand, else after it, playing basic strategy meanwhile). */
export function leaveSeat(s0: BJState, seatIdx: number, ctx: Ctx): BJState {
  const s = clone(s0); const seat = s.seats[seatIdx]; if (seat?.kind !== "human") return s;
  log(s, { t: "leave", seat: seatIdx, text: `${seat.name} left` }, ctx.now);
  const bot = botSeat(seatIdx, s.botLevel);
  if (seat.inRound) { seat.kind = "bot"; seat.level = s.botLevel; seat.name = bot.name; seat.tokenHash = undefined; seat.stack = START_STACK; }
  else s.seats[seatIdx] = bot;
  return advance(s, ctx);
}
export function findSeat(s: BJState, tokenHash: string) { return s.seats.findIndex((x) => x.kind === "human" && x.tokenHash === tokenHash); }

/** Legal moves for a seat right now. */
export function legalMoves(s: BJState, i: number): Move["t"][] {
  const seat = s.seats[i]; if (!seat || seat.kind === "empty") return [];
  if (s.phase === "betting") return seat.decided ? [] : ["bet", "sitout"];
  if (s.phase === "insurance") return seat.inRound && seat.insurance === null ? ["insurance"] : [];
  if (!s.turn || s.turn.seat !== i) return [];
  const h = seat.hands[s.turn.hand]; const out: Move["t"][] = ["hit", "stand"];
  if (h.cards.length === 2 && seat.stack >= h.bet) {
    out.push("double");
    if (sameValue(h.cards[0], h.cards[1]) && seat.hands.length < 3) out.push("split");
  }
  return out;
}

export function apply(s0: BJState, i: number, m: Move, ctx: Ctx): BJState {
  const s = clone(s0); const seat = s.seats[i];
  if (!seat || seat.kind === "empty") throw new IllegalMove("Empty seat");
  if (!legalMoves(s, i).includes(m.t)) throw new IllegalMove(`Can't ${m.t} now`);
  if (m.t === "bet") {
    const a = Math.floor(m.amount);
    if (!(a >= s.minBet && a <= s.maxBet)) throw new IllegalMove(`Bet must be ${s.minBet}-${s.maxBet}`);
    debit(s, i, a, "bet"); seat.bet = a; seat.decided = true; seat.idle = 0; log(s, { t: "bet", seat: i, text: `${seat.name} bets ${a}` }, ctx.now);
  } else if (m.t === "sitout") { seat.decided = true; seat.bet = 0; }
  else if (m.t === "insurance") {
    const cost = Math.floor(seat.bet / 2);
    if (m.take && cost > 0 && seat.stack >= cost) { debit(s, i, cost, "insurance"); seat.insurance = cost; } else seat.insurance = 0;
  } else {
    const t = s.turn!; const h = seat.hands[t.hand];
    if (m.t === "hit") { const c = draw(s, ctx); h.cards.push(c); log(s, { t: "card", seat: i, hand: t.hand, card: c }, ctx.now); const v = handValue(h.cards).total; if (v >= 21) h.done = true; }
    else if (m.t === "stand") h.done = true;
    else if (m.t === "double") { debit(s, i, h.bet, "double"); h.bet *= 2; h.doubled = true; const c = draw(s, ctx); h.cards.push(c); h.done = true; log(s, { t: "card", seat: i, hand: t.hand, card: c, text: "double" }, ctx.now); }
    else if (m.t === "split") {
      debit(s, i, h.bet, "split"); const aces = h.cards[0][0] === "A";
      const nh: Hand = { cards: [h.cards[1]], bet: h.bet, split: true, aces };
      h.cards = [h.cards[0]]; h.split = true; h.aces = aces; seat.hands.splice(t.hand + 1, 0, nh);
      for (const hh of [h, nh]) { const c = draw(s, ctx); hh.cards.push(c); if (aces || handValue(hh.cards).total === 21) hh.done = true; }
      log(s, { t: "split", seat: i, hand: t.hand }, ctx.now);
    }
  }
  return advance(s, ctx);
}

function deal(s: BJState, ctx: Ctx) {
  s.reshuffled = false;
  if (s.shoe.length < s.decks * 52 * 0.25) { s.shoe = shuffle(makeDeck(s.decks), ctx.rng); s.reshuffled = true; log(s, { t: "shuffle", text: "Fresh 6-deck shoe" }, ctx.now); }
  s.results = []; s.dealer = []; s.holeHidden = true;
  for (const seat of s.seats) { seat.inRound = seat.bet > 0; seat.hands = seat.inRound ? [{ cards: [], bet: seat.bet }] : []; seat.insurance = null; }
  for (let k = 0; k < 2; k++) {
    for (const seat of s.seats) if (seat.inRound) seat.hands[0].cards.push(draw(s, ctx));
    s.dealer.push(draw(s, ctx));
  }
  for (const seat of s.seats) if (seat.inRound && isBlackjack(seat.hands[0].cards)) seat.hands[0].done = true;
  log(s, { t: "deal", text: `Round ${s.round}` }, ctx.now);
  if (s.dealer[0][0] === "A") { s.phase = "insurance"; for (const seat of s.seats) if (!seat.inRound) seat.insurance = 0; }
  else afterInsurance(s, ctx);
}
function afterInsurance(s: BJState, ctx: Ctx) {
  const up = cardValue(s.dealer[0]);
  const dealerBJ = (up === 10 || up === 11) && isBlackjack(s.dealer);
  if (dealerBJ) { s.holeHidden = false; log(s, { t: "dealerbj", text: "Dealer has blackjack" }, ctx.now); return settle(s, ctx); }
  if (up === 11) log(s, { t: "peek", text: "Dealer checked — no blackjack" }, ctx.now);
  s.phase = "play"; s.turn = null; nextTurn(s, ctx);
}
function nextTurn(s: BJState, ctx: Ctx) {
  for (let i = 0; i < s.seats.length; i++) {
    const seat = s.seats[i]; if (!seat.inRound) continue;
    const h = seat.hands.findIndex((x) => !x.done);
    if (h >= 0) { s.turn = { seat: i, hand: h }; return; }
  }
  s.turn = null; dealerPlay(s, ctx);
}
function dealerPlay(s: BJState, ctx: Ctx) {
  s.holeHidden = false;
  const live = s.seats.some((x) => x.inRound && x.hands.some((h) => handValue(h.cards).total <= 21 && !isBlackjack(h.cards, !!h.split)));
  if (live) while (handValue(s.dealer).total < 17) { const c = draw(s, ctx); s.dealer.push(c); log(s, { t: "dealer", card: c }, ctx.now); }
  settle(s, ctx);
}
function settle(s: BJState, ctx: Ctx) {
  s.holeHidden = false; s.turn = null;
  const d = handValue(s.dealer).total, dBJ = isBlackjack(s.dealer), dBust = d > 21;
  for (let i = 0; i < s.seats.length; i++) {
    const seat = s.seats[i]; if (!seat.inRound) continue;
    let net = 0;
    if (seat.insurance) { if (dBJ) { credit(s, i, seat.insurance * 3, "insurance"); net += seat.insurance * 2; } else net -= seat.insurance; }
    for (const h of seat.hands) {
      const v = handValue(h.cards).total, bj = isBlackjack(h.cards, !!h.split);
      let back = 0;
      if (v > 21) { h.result = "bust"; }
      else if (bj && !dBJ) { h.result = "blackjack"; back = h.bet + Math.floor(h.bet * 1.5); }
      else if (dBJ && !bj) h.result = "lose";
      else if (bj && dBJ) { h.result = "push"; back = h.bet; }
      else if (dBust || v > d) { h.result = "win"; back = h.bet * 2; }
      else if (v === d) { h.result = "push"; back = h.bet; }
      else h.result = "lose";
      h.net = back - h.bet; net += h.net; credit(s, i, back, "payout");
    }
    s.results.push({ seat: i, name: seat.name, kind: seat.kind, bet: seat.hands.reduce((a, h) => a + h.bet, 0), net, hands: clone(seat.hands) });
  }
  log(s, { t: "settle", text: `Dealer ${dBJ ? "blackjack" : dBust ? "busts" : d}` }, ctx.now);
  // next round: bets reset, cards stay on the table until the next deal
  s.phase = "betting"; s.round++;
  for (let i = 0; i < s.seats.length; i++) {
    const seat = s.seats[i]; seat.bet = 0; seat.decided = false; seat.inRound = false;
    if (seat.pending) { s.seats[i] = { ...emptySeat(), kind: "human", name: seat.pending.name, tokenHash: seat.pending.tokenHash, stack: seat.pending.stack, hints: 0 }; log(s, { t: "join", seat: i, text: `${seat.pending.name} sat down` }, ctx.now); }
    else if (seat.kind === "bot" && seat.stack < s.minBet) { seat.stack = START_STACK; log(s, { t: "rebuy", seat: i, text: `${seat.name} rebuys` }, ctx.now); }
  }
}

/** Bots act until a human must decide; also deals once every seat has decided. */
function advance(s: BJState, ctx: Ctx): BJState {
  for (let guard = 0; guard < 200; guard++) {
    if (s.phase === "betting") {
      for (let i = 0; i < s.seats.length; i++) { const b = s.seats[i]; if (b.kind === "bot" && !b.decided) { b.bet = botBet(s, b, ctx.rng); b.stack -= b.bet; b.decided = true; } }
      const waiting = s.seats.some((x) => x.kind === "human" && !x.decided);
      if (waiting || !humans(s).length) break; // never deal a bots-only hand
      if (!s.seats.some((x) => x.bet > 0)) { for (const x of s.seats) x.decided = false; break; }
      deal(s, ctx); continue;
    }
    if (s.phase === "insurance") {
      for (const b of s.seats) if (b.kind === "bot" && b.inRound && b.insurance === null) b.insurance = 0; // basic strategy: never insure
      if (s.seats.some((x) => x.inRound && x.insurance === null)) break;
      afterInsurance(s, ctx); continue;
    }
    if (s.phase === "play" && s.turn) {
      const seat = s.seats[s.turn.seat]; const h = seat.hands[s.turn.hand];
      if (h.done) { nextTurn(s, ctx); continue; }
      if (seat.kind !== "bot") break;
      const a = botAction(s, s.turn.seat, ctx.rng);
      const st = s.turn; const legal = legalMoves(s, st.seat);
      applyInPlace(s, st.seat, legal.includes(a) ? a : "stand", ctx); continue;
    }
    break;
  }
  s.deadline = needsHuman(s) && humans(s).length > 1 ? ctx.now + s.timeoutMs : null;
  return s;
}
function applyInPlace(s: BJState, i: number, a: Action, ctx: Ctx) { const n = apply(s, i, { t: a }, ctx); Object.assign(s, n); }
const needsHuman = (s: BJState) =>
  (s.phase === "betting" && s.seats.some((x) => x.kind === "human" && !x.decided)) ||
  (s.phase === "insurance" && s.seats.some((x) => x.kind === "human" && x.inRound && x.insurance === null)) ||
  (s.phase === "play" && !!s.turn && s.seats[s.turn.seat].kind === "human");

function botBet(s: BJState, b: Seat, rng: Rng) {
  const base = b.level === "hard" ? Math.round(b.stack * 0.03) : b.level === "medium" ? 25 : [10, 20, 25, 50][Math.floor(rng() * 4)];
  return Math.max(s.minBet, Math.min(s.maxBet, b.stack, Math.round(base / 5) * 5 || s.minBet));
}
export function botAction(s: BJState, i: number, rng: Rng): Action {
  const seat = s.seats[i]; const h = seat.hands[s.turn!.hand]; const legal = legalMoves(s, i);
  const best = basicStrategy(h.cards, s.dealer[0], legal.includes("double"), legal.includes("split"));
  if (rng() < ERR[seat.level || "medium"]) { const alt = (legal.filter((x) => x !== best && x !== "split" && x !== "double") as Action[]); if (alt.length) return alt[Math.floor(rng() * alt.length)]; }
  return best;
}

/** Applies default actions when the current human's deadline passed (stand / no insurance / sit out; 3 missed rounds -> a bot takes the seat). */
export function timeout(s0: BJState, ctx: Ctx): BJState {
  if (!s0.deadline || ctx.now < s0.deadline) return s0;
  let s = clone(s0);
  if (s.phase === "betting") {
    for (let i = 0; i < s.seats.length; i++) { const x = s.seats[i]; if (x.kind === "human" && !x.decided) { x.decided = true; x.idle++; if (x.idle >= 3) s = leaveSeat(s, i, ctx); } }
    return advance(s, ctx);
  }
  if (s.phase === "insurance") { for (const x of s.seats) if (x.kind === "human" && x.inRound && x.insurance === null) x.insurance = 0; return advance(s, ctx); }
  if (s.phase === "play" && s.turn) return apply(s, s.turn.seat, { t: "stand" }, ctx);
  return s;
}

/** What every client may see: no shoe order, dealer hole card hidden until revealed, no seat tokens.
 *  A tutorial table (solo only: the server refuses a second human) shows the hole card and the next cards in the shoe. */
export function publicView(s: BJState) {
  const tut = !!s.tutorial;
  return {
    tutorial: tut, holeHidden: s.holeHidden, next: tut ? s.shoe.slice(0, 4) : null, tutDealer: tut ? s.dealer : null,
    game: s.game, phase: s.phase, round: s.round, turn: s.turn, minBet: s.minBet, maxBet: s.maxBet, deadline: s.deadline, botLevel: s.botLevel,
    shoeLeft: s.shoe.length, shoeSize: s.decks * 52, reshuffled: s.reshuffled,
    dealer: s.holeHidden && s.dealer.length ? [s.dealer[0], null] : s.dealer,
    seats: s.seats.map(({ tokenHash: _t, pending, ...x }) => ({ ...x, pending: pending ? { name: pending.name } : null })),
    results: s.results, log: s.log.slice(-25),
  };
}
export type PublicBJ = ReturnType<typeof publicView>;
