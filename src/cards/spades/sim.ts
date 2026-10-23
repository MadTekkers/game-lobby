// Spades hand model + bots. Pure TS (browser, vitest, Deno edge function).
// Variants: "partners" (4 seats, 0&2 vs 1&3), "cutthroat" (3 seats, 2♣ removed, 17 cards each), "draw" (2 seats, hands drawn from the stock).
import { type Card, type Rng, makeDeck } from "../core.ts";
import { RV, SI, beats, trickWinner, isBoss, dedupeEquivalent, sampleHands, sampleHandsLoose, bySuit } from "../tricks.ts";

export type Variant = "partners" | "cutthroat" | "draw";
export type Level = "easy" | "medium" | "hard";
export type Trick = { seats: number[]; cards: Card[]; winner: number };
/** A hand in progress with every hand known (the server's truth, or one sampled "world" inside a bot/coach simulation). */
export type Hs = {
  n: number; v: Variant; hands: Card[][]; trick: Card[]; trickSeats: number[]; leader: number; turn: number;
  broken: boolean; tricks: number[]; bids: (number | null)[]; nil: number[]; history: Trick[]; voids: boolean[][];
};
/** Tunable bot knobs (the nightly tuner adjusts these per level). */
export type BotParams = { bidOffset: number; nilMax: number; bagCost: number; samples: number; setAggro: number; err: number };
export const DEFAULT_PARAMS: Record<Level, BotParams> = {
  easy: { bidOffset: 0.4, nilMax: -9, bagCost: 0, samples: 0, setAggro: 0, err: 0.45 },
  medium: { bidOffset: 0, nilMax: 0.7, bagCost: 3, samples: 0, setAggro: 0.45, err: 0.06 },
  hard: { bidOffset: 0, nilMax: 1.1, bagCost: 4, samples: 24, setAggro: 0.5, err: 0 },
};
export const PARAM_BOUNDS: Record<keyof BotParams, [number, number]> = { bidOffset: [-1.5, 1.5], nilMax: [-9, 2], bagCost: [0, 15], samples: [0, 40], setAggro: [0, 1], err: [0, 0.6] };
export const deckFor = (v: Variant) => (v === "cutthroat" ? makeDeck().filter((c) => c !== "2C") : makeDeck());
export const teamOf = (v: Variant, i: number) => (v === "partners" ? i % 2 : i);
export const nTeams = (v: Variant, n: number) => (v === "partners" ? 2 : n);
export const partnerOf = (v: Variant, i: number) => (v === "partners" ? (i + 2) % 4 : -1);
export const handSize = (v: Variant) => (v === "cutthroat" ? 17 : 13);

export function newHs(v: Variant, hands: Card[][], leader: number): Hs {
  const n = hands.length;
  return { n, v, hands, trick: [], trickSeats: [], leader, turn: leader, broken: false, tricks: Array(n).fill(0), bids: Array(n).fill(null), nil: Array(n).fill(0), history: [], voids: hands.map(() => [false, false, false, false]) };
}
export function cloneHs(h: Hs): Hs {
  return { ...h, hands: h.hands.map((x) => x.slice()), trick: h.trick.slice(), trickSeats: h.trickSeats.slice(), tricks: h.tricks.slice(), bids: h.bids.slice(), nil: h.nil.slice(), history: h.history.slice(), voids: h.voids.map((x) => x.slice()) };
}
export function legal(h: Hs, seat: number): Card[] {
  const hand = h.hands[seat];
  if (!h.trick.length) { if (!h.broken) { const non = hand.filter((c) => c[1] !== "S"); if (non.length) return non; } return hand.slice(); }
  const f = bySuit(hand, h.trick[0][1]); return f.length ? f : hand.slice();
}
/** Play a card (mutates). Completes the trick when everyone has played. */
export function play(h: Hs, seat: number, card: Card) {
  const i = h.hands[seat].indexOf(card); if (i < 0) throw new Error("card not in hand");
  h.hands[seat].splice(i, 1);
  if (h.trick.length && card[1] !== h.trick[0][1]) h.voids[seat][SI[h.trick[0][1]]] = true;
  if (card[1] === "S") h.broken = true;
  h.trick.push(card); h.trickSeats.push(seat);
  if (h.trick.length === h.n) {
    const w = h.trickSeats[trickWinner(h.trick, "S")]; h.tricks[w]++;
    h.history.push({ seats: h.trickSeats, cards: h.trick, winner: w });
    h.trick = []; h.trickSeats = []; h.leader = h.turn = w;
  } else h.turn = (seat + 1) % h.n;
}
export const handDone = (h: Hs) => !h.trick.length && h.hands.every((x) => !x.length);

export type HandScore = { points: number[]; bags: number[]; made: boolean[]; contract: number[]; taken: number[]; nilOk: (boolean | null)[] };
/** Score one hand: contract 10×bid (+1 per overtrick = bag) or −10×bid; nil ±100, blind nil ±200 (a nil bidder's tricks don't count for the partner). */
export function scoreHand(v: Variant, bids: (number | null)[], nil: number[], tricks: number[]): HandScore {
  const n = bids.length, T = nTeams(v, n);
  const points = Array(T).fill(0), bags = Array(T).fill(0), made = Array(T).fill(true), contract = Array(T).fill(0), taken = Array(T).fill(0);
  const nilOk: (boolean | null)[] = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const t = teamOf(v, i);
    if (nil[i]) { const ok = tricks[i] === 0; nilOk[i] = ok; points[t] += (ok ? 1 : -1) * (nil[i] === 2 ? 200 : 100); }
    else { contract[t] += bids[i] ?? 0; taken[t] += tricks[i]; }
  }
  for (let t = 0; t < T; t++) {
    if (contract[t] > 0) {
      if (taken[t] >= contract[t]) { bags[t] = taken[t] - contract[t]; points[t] += 10 * contract[t] + bags[t]; }
      else { points[t] -= 10 * contract[t]; made[t] = false; }
    }
  }
  return { points, bags, made, contract, taken, nilOk };
}
/** Add a hand's bags; every 10 accumulated bags costs 100 points. */
export function applyBags(score: number, bagTotal: number, add: number) {
  let s = score, b = bagTotal + add, pen = 0;
  while (b >= 10) { s -= 100; b -= 10; pen++; }
  return { score: s, bags: b, penalties: pen };
}

// ---------- bidding ----------
/** Expected tricks from hand strength: high cards, spade length, and ruffing chances with spare spades. */
export function estimate(hand: Card[], v: Variant): number {
  const len = (s: string) => hand.reduce((k, c) => k + (c[1] === s ? 1 : 0), 0);
  const has = (r: string, s: string) => hand.includes(r + s);
  const sp = len("S"); let e = 0, spHigh = 0;
  if (has("A", "S")) { e += 1; spHigh++; }
  if (has("K", "S")) { e += sp >= 2 ? 0.95 : 0.5; spHigh++; }
  if (has("Q", "S")) { e += sp >= 3 ? 0.8 : 0.3; spHigh++; }
  if (has("J", "S")) { e += sp >= 4 ? 0.5 : 0.1; spHigh++; }
  const longSp = Math.max(0, sp - 4); e += longSp * 0.85;
  let spare = Math.max(0, sp - spHigh - longSp);
  for (const s of "HDC") {
    const L = len(s);
    if (has("A", s)) e += L <= 5 ? 0.95 : L === 6 ? 0.7 : 0.45;
    if (has("K", s)) e += L === 1 ? 0.15 : L <= 4 ? (has("A", s) ? 0.85 : 0.7) : 0.3;
    if (has("Q", s)) e += L >= 3 && L <= 4 ? (has("A", s) || has("K", s) ? 0.5 : 0.3) : 0.05;
    if (L === 0 && spare > 0) { const r = Math.min(spare, 2); e += r * 0.8; spare -= r; }
    else if (L === 1 && spare > 0) { e += 0.55; spare--; }
    else if (L === 2 && spare > 0 && sp >= 3) { e += 0.25; spare--; }
  }
  if (v === "cutthroat") e *= 1.05;
  if (v === "draw") e *= 1.2; // two hands: high cards and spades are worth more
  return e;
}
export type Bid = { n: number; nil: number };
export type BidCtx = { v: Variant; seat: number; hand: Card[]; bids: (number | null)[]; nil: number[]; teamBags?: number; level: Level; P: BotParams; rng: Rng };
/** Bot bid: hand estimate (+ tuned offset), nil when the hand is weak and safe, partner-aware adjustments, bag-aware rounding. */
export function botBid(b: BidCtx): Bid {
  const { v, seat, hand, bids, nil, level, P, rng } = b; const hs = handSize(v);
  const est = estimate(hand, v) + P.bidOffset;
  const clampB = (x: number) => Math.max(1, Math.min(hs, Math.round(x)));
  if (level === "easy") return { n: clampB(est + (rng() - 0.5) * 2.6), nil: 0 };
  const pt = partnerOf(v, seat);
  const partnerNil = pt >= 0 && bids[pt] !== null && nil[pt] > 0;
  const len = (s: string) => hand.reduce((k, c) => k + (c[1] === s ? 1 : 0), 0);
  const highSp = hand.some((c) => c[1] === "S" && RV(c) >= RV("JS"));
  const unguarded = "HDC".split("").some((s) => { const L = len(s); return (hand.includes("A" + s) && L <= 4) || (hand.includes("K" + s) && L <= 2); });
  if (!partnerNil && est <= P.nilMax && !highSp && len("S") <= 3 && !unguarded) return { n: 0, nil: 1 };
  let x = est;
  if (pt >= 0) {
    if (partnerNil) x += 0.8; // cover the partner
    const others = bids.reduce<number>((a, y, i) => a + (i !== seat && y !== null ? y : 0), 0);
    const unbid = bids.filter((y, i) => i !== seat && y === null).length;
    if (unbid === 0 && others + x > hs + 0.5) x = Math.max(est - 1, hs - others); // last to bid: keep the table total sane
  }
  if (level === "hard" && (b.teamBags ?? 0) >= 6) x += 0.35; // close to a bag penalty: bid up rather than collect bags
  return { n: clampB(x), nil: 0 };
}

// ---------- card play ----------
export type PlayCtx = { level: Level; P: BotParams; rng: Rng; deck: Card[] };
function seenBy(h: Hs, seat: number): Set<Card> {
  const s = new Set<Card>(h.hands[seat]);
  for (const t of h.history) for (const c of t.cards) s.add(c);
  for (const c of h.trick) s.add(c);
  return s;
}
const teamNeed = (h: Hs, t: number) => {
  let need = 0, any = false;
  for (let i = 0; i < h.n; i++) if (teamOf(h.v, i) === t && !h.nil[i]) { need += (h.bids[i] ?? 0) - h.tricks[i]; any = true; }
  return any ? need : -99;
};
const lowest = (cs: Card[]) => cs.reduce((a, c) => (RV(c) < RV(a) || (RV(c) === RV(a) && c[1] !== "S" && a[1] === "S") ? c : a));
const highest = (cs: Card[]) => cs.reduce((a, c) => (RV(c) > RV(a) ? c : a));
/** Cheapest discard: lowest card of the shortest non-spade suit. */
function discard(hand: Card[], cs: Card[]) {
  const non = cs.filter((c) => c[1] !== "S"); const pool = non.length ? non : cs;
  return pool.reduce((a, c) => { const la = bySuit(hand, a[1]).length, lc = bySuit(hand, c[1]).length; return lc < la || (lc === la && RV(c) < RV(a)) ? c : a; });
}

/** Rule-based player with card counting (boss cards, voids), partner/nil awareness and bag avoidance. */
export function heuristic(h: Hs, seat: number, c: PlayCtx): Card {
  const L = legal(h, seat); if (L.length === 1) return L[0];
  const hand = h.hands[seat]; const v = h.v; const me = teamOf(v, seat);
  const seen = seenBy(h, seat);
  const pt = partnerOf(v, seat);
  const myNilAlive = h.nil[seat] > 0 && h.tricks[seat] === 0;
  const partnerNilAlive = pt >= 0 && h.nil[pt] > 0 && h.tricks[pt] === 0;
  const remaining = hand.length;
  const myNeed = teamNeed(h, me);
  let oppNeed = -99; for (let t = 0; t < nTeams(v, h.n); t++) if (t !== me) oppNeed = Math.max(oppNeed, teamNeed(h, t));
  const wantSet = oppNeed > 0 && oppNeed / remaining >= 1 - c.P.setAggro;
  const want = myNeed > 0 || wantSet;
  const oppNilAlive = (i: number) => teamOf(v, i) !== me && h.nil[i] > 0 && h.tricks[i] === 0;

  if (!h.trick.length) { // leading
    if (myNilAlive) { const non = L.filter((x) => x[1] !== "S"); return lowest(non.length ? non : L); }
    if (partnerNilAlive) { const boss = L.filter((x) => isBoss(x, seen, c.deck)); return highest(boss.length ? boss : L); }
    if (want) {
      const boss = L.filter((x) => x[1] !== "S" && isBoss(x, seen, c.deck));
      if (boss.length) return boss[0];
      const spBoss = L.filter((x) => x[1] === "S" && isBoss(x, seen, c.deck));
      if (spBoss.length && bySuit(hand, "S").length >= 3) return spBoss[0];
      // lead low from a short side suit to set up a ruff
      if (bySuit(hand, "S").length) { const short = L.filter((x) => x[1] !== "S" && bySuit(hand, x[1]).length <= 2); if (short.length) return lowest(short); }
    }
    const non = L.filter((x) => x[1] !== "S"); return lowest(non.length ? non : L);
  }
  const led = h.trick[0][1];
  const wi = trickWinner(h.trick, "S"); const best = h.trick[wi]; const bestSeat = h.trickSeats[wi];
  const winners = L.filter((x) => beats(x, best, "S")); const losers = L.filter((x) => !beats(x, best, "S"));
  const last = h.trick.length === h.n - 1;
  const following = L[0][1] === led && L.every((x) => x[1] === led);
  if (myNilAlive) { if (losers.length) return highest(losers); return last ? highest(L) : lowest(L); }
  if (partnerNilAlive) {
    const partnerPlayed = h.trickSeats.includes(pt);
    if (!partnerPlayed && winners.length) return highest(winners);
    if (partnerPlayed && bestSeat === pt && winners.length) return lowest(winners);
  }
  if (oppNilAlive(bestSeat) && losers.length) return highest(losers.filter((x) => x[1] === led).length ? losers.filter((x) => x[1] === led) : losers);
  const partnerWinning = teamOf(v, bestSeat) === me && bestSeat !== seat;
  if (partnerWinning) {
    const yetToPlay = [...Array(h.n).keys()].filter((k) => !h.trickSeats.includes(k) && k !== seat);
    const safe = last || (isBoss(best, seen, c.deck) && (best[1] === "S" || !yetToPlay.some((k) => teamOf(v, k) !== me && h.voids[k][SI[led]])));
    if (safe || !winners.length) return following ? lowest(L) : discard(hand, losers.length ? losers : L);
  }
  if (want && winners.length) {
    if (last) return lowest(winners);
    const bossW = winners.filter((x) => isBoss(x, seen, c.deck));
    if (!following) return lowest(winners); // ruff as cheaply as possible
    if (bossW.length) return lowest(bossW);
    if (h.trick.length >= 2) return highest(winners); // third hand high
    return lowest(L); // second hand low
  }
  if (!want && losers.length) return following ? highest(losers) : discard(hand, losers); // shed safely, avoid bags
  return following ? lowest(L) : discard(hand, L);
}

/** Play out the rest of a (fully known) hand with the heuristic for every seat. */
export function rollout(h: Hs, c: PlayCtx) {
  for (let g = 0; g < 80 && !handDone(h); g++) play(h, h.turn, heuristic(h, h.turn, c));
}
/** Value of a finished hand for team t: score difference with a cost per bag. */
export function handValue(h: Hs, t: number, bagCost: number) {
  const sc = scoreHand(h.v, h.bids, h.nil, h.tricks);
  const val = (k: number) => sc.points[k] - sc.bags[k] * bagCost;
  const opp = sc.points.map((_, k) => k).filter((k) => k !== t);
  return val(t) - opp.reduce((a, k) => a + val(k), 0) / opp.length;
}
/** Sample a world consistent with what `seat` knows. */
export function sampleWorld(h: Hs, seat: number, deck: Card[], rng: Rng): Hs {
  const seen = seenBy(h, seat);
  const unknown = deck.filter((c) => !seen.has(c));
  const sizes = h.hands.map((x, i) => (i === seat ? 0 : x.length));
  const dealt = sampleHands(unknown, sizes, h.voids, rng, 20) ?? sampleHandsLoose(unknown, sizes, rng);
  const w = cloneHs(h); w.hands = w.hands.map((x, i) => (i === seat ? x.slice() : dealt[i])); return w;
}
export const ROLLOUT_CTX = (rng: Rng, deck: Card[]): PlayCtx => ({ level: "medium", P: DEFAULT_PARAMS.medium, rng, deck });

/** Bot card choice. easy: half random / half greedy; medium: heuristic + counting; hard: determinized Monte Carlo search. */
export function botCard(h: Hs, seat: number, c: PlayCtx): Card {
  const L = legal(h, seat); if (L.length === 1) return L[0];
  if (c.rng() < c.P.err) { if (c.level === "easy" && c.rng() < 0.5) return highest(L); return L[Math.floor(c.rng() * L.length)]; }
  if (c.level === "easy" || c.P.samples <= 0 || h.hands[seat].length <= 1) return heuristic(h, seat, c);
  const seen = seenBy(h, seat); const cands = dedupeEquivalent(L, seen, c.deck); if (cands.length === 1) return cands[0];
  const sc = new Array(cands.length).fill(0); const rc = ROLLOUT_CTX(c.rng, c.deck); const t = teamOf(h.v, seat);
  for (let k = 0; k < c.P.samples; k++) {
    const w0 = sampleWorld(h, seat, c.deck, c.rng);
    for (let i = 0; i < cands.length; i++) { const w = cloneHs(w0); play(w, seat, cands[i]); rollout(w, rc); sc[i] += handValue(w, t, c.P.bagCost); }
  }
  let bi = 0; for (let i = 1; i < cands.length; i++) if (sc[i] > sc[bi]) bi = i;
  return cands[bi];
}
/** 2-player draw variant: keep the top card or take the next one. */
export function botKeep(card: Card, hand: Card[], level: Level, rng: Rng): boolean {
  if (level === "easy") return rng() < 0.5;
  const sp = bySuit(hand, "S").length;
  if (card[1] === "S") return RV(card) >= 5 || sp < 4;
  if (RV(card) >= RV("KS")) return true;
  if (RV(card) >= RV("QS")) return bySuit(hand, card[1]).length >= 1 && bySuit(hand, card[1]).length <= 3;
  return level === "hard" ? bySuit(hand, card[1]).length === 0 && hand.length > 6 ? false : RV(card) <= 2 && hand.length < 4 : false;
}
