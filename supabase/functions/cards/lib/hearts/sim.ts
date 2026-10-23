// Hearts hand model + bots. Pure TS (browser, vitest, Deno edge function).
// Variants: "four" (52 cards, 13 each), "three" (2♦ removed, 17 each), "two" (13 each + 26-card stock: after each trick the winner
// draws the top stock card, the other player the next, until the stock runs out). Hearts 1 point each, Q♠ 13; taking all 26 = moon.
import { type Card, type Rng, makeDeck } from "../core.ts";
import { RV, SI, trickWinner, dedupeEquivalent, sampleHands, sampleHandsLoose, bySuit } from "../tricks.ts";

export type Variant = "four" | "three" | "two";
export type Level = "easy" | "medium" | "hard";
export type Trick = { seats: number[]; cards: Card[]; winner: number };
export type Hs = {
  n: number; v: Variant; hands: Card[][]; trick: Card[]; trickSeats: number[]; leader: number; turn: number; broken: boolean;
  pts: number[]; qs: number; history: Trick[]; voids: boolean[][]; stock: Card[]; drawn: Card[][];
};
export type BotParams = { err: number; samples: number; qKeep: number; moonMin: number; flush: number };
export const DEFAULT_PARAMS: Record<Level, BotParams> = {
  easy: { err: 0.4, samples: 0, qKeep: 9, moonMin: 9, flush: 0 },
  medium: { err: 0.05, samples: 0, qKeep: 5, moonMin: 0.8, flush: 0.6 },
  hard: { err: 0, samples: 24, qKeep: 4, moonMin: 0.7, flush: 0.8 },
};
export const PARAM_BOUNDS: Record<keyof BotParams, [number, number]> = { err: [0, 0.6], samples: [0, 40], qKeep: [3, 9], moonMin: [0.5, 9], flush: [0, 1] };
export const deckFor = (v: Variant) => (v === "three" ? makeDeck().filter((c) => c !== "2D") : makeDeck());
export const handSize = (v: Variant) => (v === "three" ? 17 : 13);
export const variantFor = (n: number): Variant => (n >= 4 ? "four" : n === 3 ? "three" : "two");
export const cardPts = (c: Card) => (c[1] === "H" ? 1 : c === "QS" ? 13 : 0);
/** Pass offset by hand number (1-based): 4p left/right/across/hold, 3p left/right/hold, 2p pass/hold. */
export function passOffset(n: number, handNo: number) {
  const cyc = n >= 4 ? [1, 3, 2, 0] : n === 3 ? [1, 2, 0] : [1, 0];
  return cyc[(handNo - 1) % cyc.length];
}
export const passName = (n: number, off: number) => (off === 0 ? "hold" : n === 2 ? "across" : off === 1 ? "left" : off === n - 1 ? "right" : "across");

export function newHs(v: Variant, hands: Card[][], leader: number, stock: Card[] = []): Hs {
  const n = hands.length;
  return { n, v, hands, trick: [], trickSeats: [], leader, turn: leader, broken: false, pts: Array(n).fill(0), qs: -1, history: [], voids: hands.map(() => [false, false, false, false]), stock, drawn: hands.map(() => []) };
}
export function cloneHs(h: Hs): Hs {
  return { ...h, hands: h.hands.map((x) => x.slice()), trick: h.trick.slice(), trickSeats: h.trickSeats.slice(), pts: h.pts.slice(), history: h.history.slice(), voids: h.voids.map((x) => x.slice()), stock: h.stock.slice(), drawn: h.drawn.map((x) => x.slice()) };
}
const lowClub = (hand: Card[]) => { const c = bySuit(hand, "C"); return c.length ? c.reduce((a, x) => (RV(x) < RV(a) ? x : a)) : null; };
/** Who leads the first trick: the holder of the lowest club in play (2♣ in the 3/4-player games). */
export function firstLeader(hands: Card[][]) {
  let best = -1, br = 99; hands.forEach((h, i) => { const c = lowClub(h); if (c && RV(c) < br) { br = RV(c); best = i; } }); return best < 0 ? 0 : best;
}
export function legal(h: Hs, seat: number): Card[] {
  const hand = h.hands[seat]; const first = h.history.length === 0;
  if (!h.trick.length) {
    if (first) { const c = lowClub(hand); if (c) return [c]; }
    if (!h.broken) { const non = hand.filter((c) => c[1] !== "H"); if (non.length) return non; }
    return hand.slice();
  }
  const f = bySuit(hand, h.trick[0][1]); if (f.length) return f;
  if (first) { const safe = hand.filter((c) => !cardPts(c)); if (safe.length) return safe; }
  return hand.slice();
}
export function play(h: Hs, seat: number, card: Card) {
  const i = h.hands[seat].indexOf(card); if (i < 0) throw new Error("card not in hand");
  h.hands[seat].splice(i, 1);
  if (h.trick.length && card[1] !== h.trick[0][1]) h.voids[seat][SI[h.trick[0][1]]] = true;
  if (card[1] === "H") h.broken = true;
  h.trick.push(card); h.trickSeats.push(seat);
  if (h.trick.length === h.n) {
    const w = h.trickSeats[trickWinner(h.trick, null)];
    for (const c of h.trick) { h.pts[w] += cardPts(c); if (c === "QS") h.qs = w; }
    h.history.push({ seats: h.trickSeats, cards: h.trick, winner: w });
    h.trick = []; h.trickSeats = []; h.leader = h.turn = w;
    if (h.stock.length >= h.n) { // two-hand draw: winner first
      for (let k = 0; k < h.n; k++) { const s = (w + k) % h.n; const c = h.stock.shift()!; h.hands[s].push(c); h.drawn[s].push(c); h.voids[s] = [false, false, false, false]; }
    }
  } else h.turn = (seat + 1) % h.n;
}
export const handDone = (h: Hs) => !h.trick.length && h.hands.every((x) => !x.length) && h.stock.length < h.n;
/** Hand points after the moon rule: whoever takes all 26 scores 0 and everyone else 26. */
export function scoreHand(pts: number[]) {
  const moon = pts.findIndex((p) => p === 26);
  return { points: moon >= 0 ? pts.map((_, i) => (i === moon ? 0 : 26)) : pts.slice(), moon };
}

// ---------- passing ----------
/** Three cards to pass. easy: the three highest; medium/hard: Q♠/A♠/K♠ unless spade-long, high hearts, then void a short suit. */
export function botPass(hand: Card[], level: Level, P: BotParams, rng: Rng): Card[] {
  if (level === "easy") return [...hand].sort((a, b) => RV(b) - RV(a) || rng() - 0.5).slice(0, 3);
  const sp = bySuit(hand, "S"); const lowSp = sp.filter((c) => RV(c) < RV("QS")).length;
  const keepQ = lowSp >= P.qKeep - 1; // enough low spades to guard the queen
  const score = (c: Card) => {
    const r = RV(c), L = bySuit(hand, c[1]).length;
    if (c === "QS") return keepQ ? -5 : 100;
    if (c === "AS" || c === "KS") return keepQ ? 5 : hand.includes("QS") ? 60 : 90;
    if (c[1] === "S") return -10;
    if (c[1] === "H") return r >= RV("TH") ? 60 + r : r * 0.5;
    return r * 3 + (L <= 2 ? 30 : L === 3 ? 10 : 0);
  };
  const s = [...hand].sort((a, b) => score(b) - score(a)); return s.slice(0, 3);
}

// ---------- card play ----------
export type PlayCtx = { level: Level; P: BotParams; rng: Rng; deck: Card[] };
function seenBy(h: Hs, seat: number): Set<Card> {
  const s = new Set<Card>(h.hands[seat]); for (const t of h.history) for (const c of t.cards) s.add(c); for (const c of h.trick) s.add(c); return s;
}
const lowest = (cs: Card[]) => cs.reduce((a, c) => (RV(c) < RV(a) ? c : a));
const highest = (cs: Card[]) => cs.reduce((a, c) => (RV(c) > RV(a) ? c : a));
const higherUnseen = (c: Card, seen: Set<Card>, deck: Card[]) => deck.filter((x) => x[1] === c[1] && RV(x) > RV(c) && !seen.has(x)).length;
/** Is `seat` running for the moon? Nobody else has points and most of its hand are winners. */
export function moonMode(h: Hs, seat: number, P: BotParams, seen: Set<Card>, deck: Card[]) {
  if (P.moonMin > 1.5 || h.v === "two") return false;
  if (h.pts.some((p, i) => i !== seat && p > 0)) return false;
  const hand = h.hands[seat]; if (hand.length < 3) return h.pts[seat] >= 14;
  const strong = hand.filter((c) => higherUnseen(c, seen, deck) <= (RV(c) >= RV("QS") ? 1 : 0)).length;
  const hearts = bySuit(hand, "H").length;
  return strong / hand.length >= P.moonMin && (hearts >= 4 || h.pts[seat] >= 6);
}
const others = (h: Hs, seat: number) => [...Array(h.n).keys()].filter((k) => k !== seat);
const moonThreat = (h: Hs, seat: number) => { const o = others(h, seat).find((k) => h.pts[k] >= 10 && h.pts.every((p, j) => j === k || p === 0)); return o ?? -1; };

/** Rule-based player: duck under the winner, dump Q♠ and high hearts when void, flush the queen with low spades, count cards, block moons. */
export function heuristic(h: Hs, seat: number, c: PlayCtx): Card {
  const L = legal(h, seat); if (L.length === 1) return L[0];
  const hand = h.hands[seat]; const seen = seenBy(h, seat);
  const iHoldQ = hand.includes("QS");
  const qsPlayed = h.qs >= 0 || h.trick.includes("QS"); const qsOut = !qsPlayed && !iHoldQ; // someone else still holds the queen
  if (moonMode(h, seat, c.P, seen, c.deck)) { // take everything: lead bosses, win every trick
    if (!h.trick.length) { const boss = L.filter((x) => higherUnseen(x, seen, c.deck) === 0); return boss.length ? highest(boss) : highest(L); }
    const wi = trickWinner(h.trick, null); const best = h.trick[wi]; const win = L.filter((x) => x[1] === best[1] && RV(x) > RV(best));
    return win.length ? highest(win) : lowest(L);
  }
  const threat = moonThreat(h, seat);
  if (!h.trick.length) { // leading: the card most likely to lose
    const safeSp = L.filter((x) => x[1] === "S" && RV(x) < RV("QS"));
    if (qsOut && !iHoldQ && safeSp.length && !hand.includes("AS") && !hand.includes("KS") && c.rng() < c.P.flush) return highest(safeSp); // flush the queen
    const cand = L.filter((x) => !(x[1] === "S" && RV(x) >= RV("QS") && !qsPlayed));
    const pool = cand.length ? cand : L;
    const risk = (x: Card) => { const hu = higherUnseen(x, seen, c.deck); return (hu === 0 ? 100 : 10 / hu) + (x[1] === "H" ? 1 : 0) + cardPts(x) * 3; };
    return pool.reduce((a, x) => (risk(x) < risk(a) || (risk(x) === risk(a) && RV(x) < RV(a)) ? x : a));
  }
  const led = h.trick[0][1]; const wi = trickWinner(h.trick, null); const best = h.trick[wi]; const bestSeat = h.trickSeats[wi];
  const following = L.every((x) => x[1] === led);
  const last = h.trick.length === h.n - 1; const ptsIn = h.trick.reduce((a, x) => a + cardPts(x), 0);
  if (following) {
    const under = L.filter((x) => RV(x) < RV(best)); const over = L.filter((x) => RV(x) > RV(best));
    if (threat >= 0 && bestSeat === threat && ptsIn > 0 && over.length) return lowest(over); // block the moon
    if (led === "S" && iHoldQ && under.includes("QS")) return "QS"; // A♠/K♠ is winning: drop the queen on it
    if (under.length) { const u = led === "S" && qsOut && !iHoldQ ? under : under.filter((x) => x !== "QS"); return highest(u.length ? u : under); }
    if (last && ptsIn === 0) { const nonQ = L.filter((x) => x !== "QS"); return highest(nonQ.length ? nonQ : L); } // forced to win a clean trick: shed the top card
    if (led === "S" && qsOut && !iHoldQ) { const nonAK = L.filter((x) => RV(x) < RV("QS")); if (nonAK.length) return lowest(nonAK); }
    const nonQ = L.filter((x) => x !== "QS"); return h.n > 2 ? highest(nonQ.length ? nonQ : L) : lowest(nonQ.length ? nonQ : L);
  }
  // void: dump
  if (threat >= 0 && bestSeat !== threat && L.some((x) => x[1] === "H")) { /* someone else is winning: fine to dump */ }
  if (threat >= 0 && bestSeat === threat) { const non = L.filter((x) => !cardPts(x)); if (non.length) return highest(non); }
  if (L.includes("QS")) return "QS";
  const hi = L.filter((x) => x === "AS" || x === "KS"); if (hi.length && qsOut) return hi[0];
  const hearts = L.filter((x) => x[1] === "H"); if (hearts.length) return highest(hearts);
  // highest card of the suit we're shortest in (create voids)
  return L.reduce((a, x) => { const la = bySuit(hand, a[1]).length, lx = bySuit(hand, x[1]).length; return RV(x) > RV(a) + (lx < la ? -3 : lx > la ? 3 : 0) ? x : a; });
}
export function rollout(h: Hs, c: PlayCtx) { for (let g = 0; g < 120 && !handDone(h); g++) play(h, h.turn, heuristic(h, h.turn, c)); }
/** Value of a finished hand for `seat`: average opponent points − own points (after the moon rule). */
export function handValue(h: Hs, seat: number) {
  const p = scoreHand(h.pts).points; const o = others(h, seat); return o.reduce((a, k) => a + p[k], 0) / o.length - p[seat];
}
/** Sample a world consistent with what `seat` knows (own hand, played cards, voids; the 2-hand stock is unknown). */
export type Given = { to: number; cards: Card[] } | null;
export function sampleWorld(h: Hs, seat: number, deck: Card[], rng: Rng, given: Given = null): Hs {
  const seen = seenBy(h, seat);
  const g = given && given.to !== seat ? given.cards.filter((c) => !seen.has(c)) : []; for (const c of g) seen.add(c);
  const unknown = deck.filter((c) => !seen.has(c));
  const sizes = h.hands.map((x, i) => (i === seat ? 0 : x.length - (given && i === given.to ? g.length : 0)));
  const dealt = sampleHands(unknown, sizes, h.voids, rng, 20) ?? sampleHandsLoose(unknown, sizes, rng);
  if (g.length) dealt[given!.to] = [...dealt[given!.to], ...g];
  const w = cloneHs(h); w.hands = w.hands.map((x, i) => (i === seat ? x.slice() : dealt[i]));
  if (h.stock.length) { const used = new Set(dealt.flat()); const rest = unknown.filter((c) => !used.has(c)); for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; } w.stock = rest.slice(0, h.stock.length); }
  return w;
}
export const ROLLOUT_CTX = (rng: Rng, deck: Card[]): PlayCtx => ({ level: "medium", P: DEFAULT_PARAMS.medium, rng, deck });
/** easy: 40% random, else heuristic; medium: heuristic; hard: determinized Monte Carlo over sampled hidden hands. */
export function botCard(h: Hs, seat: number, c: PlayCtx, given: Given = null): Card {
  const L = legal(h, seat); if (L.length === 1) return L[0];
  if (c.rng() < c.P.err) return L[Math.floor(c.rng() * L.length)];
  if (c.level === "easy" || c.P.samples <= 0 || h.hands[seat].length <= 1) return heuristic(h, seat, c);
  const seen = seenBy(h, seat); const cands = dedupeEquivalent(L, seen, c.deck); if (cands.length === 1) return cands[0];
  const sc = new Array(cands.length).fill(0); const rc = ROLLOUT_CTX(c.rng, c.deck);
  for (let k = 0; k < c.P.samples; k++) {
    const w0 = sampleWorld(h, seat, c.deck, c.rng, given);
    for (let i = 0; i < cands.length; i++) { const w = cloneHs(w0); play(w, seat, cands[i]); rollout(w, rc); sc[i] += handValue(w, seat); }
  }
  let bi = 0; for (let i = 1; i < cands.length; i++) if (sc[i] > sc[bi]) bi = i;
  return cands[bi];
}
