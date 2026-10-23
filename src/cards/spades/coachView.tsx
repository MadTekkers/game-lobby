// Spades coach card + tutorial tips built from the Monte Carlo rows in coach.ts.
import type { ReactNode } from "react";
import { seededRng, type Card } from "../core.ts";
import { isBoss, RV } from "../tricks.ts";
import type { CoachRow } from "../ui/TrainCard.tsx";
import { CardRow } from "../ui/PlayingCard.tsx";
import { cardName } from "../ui/TrickTable.tsx";
import * as Sim from "./sim.ts";
import { evalPlay, evalBid, replayPlay, type View, type PlayRow, type BidRow } from "./coach.ts";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" } as Record<string, string>;
export type Coached = { rows: CoachRow[]; chosen: string | null; gap: string; sample: string; kind: "play" | "bid"; replay?: (k: string) => ReactNode };
const rng = () => seededRng((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
export const bidLabel = (b: { bid: number; nil: number }) => (b.nil === 2 ? "Blind nil" : b.nil ? "Nil" : `Bid ${b.bid}`);
const bidKey = (b: { bid: number; nil: number }) => (b.nil === 2 ? "blind" : b.nil ? "nil" : String(b.bid));

/** Pick the rows shown: the best few plus the player's move. */
function pickRows<R>(rows: R[], isMine: (r: R) => boolean, k = 4) { const top = rows.slice(0, k); const mine = rows.find(isMine); if (mine && !top.includes(mine)) top[k - 1] = mine; return top; }
function gapLine(best: { ev: number; label: string; make: number }, mine: { ev: number; label: string; make: number; seGap: number } | null, second?: { ev: number; label: string; seGap: number }) {
  if (!mine) return `Best: ${best.label} (${pts(best.ev)} pts expected vs the opponents).`;
  if (mine.label === best.label) return second ? `✓ ${best.label} is the best option — ${(best.ev - second.ev).toFixed(1)} pts better on average than ${second.label} (±${(1.96 * second.seGap).toFixed(1)}).` : `✓ ${best.label} was the only real option.`;
  const d = best.ev - mine.ev, noise = 1.96 * mine.seGap;
  if (d <= noise) return `≈ ${mine.label} is within simulation noise of the best (${best.label}, ${d.toFixed(1)} ± ${noise.toFixed(1)} pts) — fine.`;
  const dm = best.make - mine.make;
  return `${best.label} ${Math.abs(dm) >= 0.02 ? `${dm > 0 ? "makes" : "misses"} your contract ${pct(Math.abs(dm))} more often and ` : ""}scores ${d.toFixed(1)} pts more on average than ${mine.label} (±${noise.toFixed(1)}).`;
}

export function coachPlay(p: View, seat: number, hand: Card[], chosen: Card | null, deck: Card[], n = 200): Coached & { raw: PlayRow[] } {
  const R = rng(); const raw = evalPlay(p, seat, hand, { n, rng: R, deck });
  const t = Sim.teamOf(p.v, seat); const best = raw[0];
  // equivalent cards (e.g. 7♣ when you also hold 6♣ and 5♣ is gone) share a row: map the chosen card onto its row
  const gone = new Set<Card>([...hand, ...p.history.flatMap((x) => x.cards), ...p.trick, ...Sim.deckFor(p.v).filter((c) => !deck.includes(c))]);
  const equiv = (a: Card, b: Card) => { if (a[1] !== b[1]) return false; const lo = Math.min(RV(a), RV(b)), hi = Math.max(RV(a), RV(b));
    return Sim.deckFor(p.v).every((c) => c[1] !== a[1] || RV(c) <= lo || RV(c) >= hi || gone.has(c)); };
  const mineRow = chosen ? raw.find((r) => r.card === chosen) ?? raw.find((r) => equiv(r.card, chosen)) ?? null : null;
  const rows = pickRows(raw, (r) => r === mineRow).map((r): CoachRow => ({
    key: r.card, label: cardName(r.card) + (mineRow === r && chosen && chosen !== r.card ? ` (= ${cardName(chosen)})` : ""), winFrac: r.make, evNum: r.ev,
    bar: [{ frac: r.make, cls: "good" }, { frac: 1 - r.make, cls: "bad" }],
    metric: `Make ${pct(r.make)} · Set them ${pct(r.set)} · Bags ${r.bags.toFixed(1)}${r.nil !== null ? ` · Nil ${pct(r.nil)}` : ""} · Takes trick ${pct(r.trick)}`,
    ev: `${pts(r.ev)} pts`,
    why: r.trick > 0.97 ? "Wins this trick for certain." : r.trick < 0.03 ? (r.nil !== null ? "Stays under — protects the nil." : "Ducks this trick, saving higher cards.") : `Wins this trick ${pct(r.trick)} of the time.`,
    math: (<ul className="coach-ul">
      <li>{r.n} sampled deals of the {deck.length - hand.length - p.history.length * p.n - p.trick.length}+ unseen cards, consistent with every void shown so far; the rest of the hand is played out by the card-counting bot for all seats.</li>
      <li>Expected points = your {p.v === "partners" ? "team's" : ""} hand score − average opponent score, bags charged 10 each (10 bags = −100): {r.ev.toFixed(1)} ± {(1.96 * r.se).toFixed(1)} (95%).</li>
      <li>Contract made in {Math.round(r.make * r.n)}/{r.n} deals; opponents set in {Math.round(r.set * r.n)}/{r.n}; {r.bags.toFixed(2)} bags on average.</li>
      {r !== best && <li>Gap to best ({cardName(best.card)}): {(best.ev - r.ev).toFixed(1)} ± {(1.96 * r.seGap).toFixed(1)} pts on the same deals.</li>}
    </ul>),
  }));
  const L = (r: PlayRow) => cardName(r.card);
  const gap = gapLine({ ev: best.ev, label: L(best), make: best.make }, mineRow ? { ev: mineRow.ev, label: L(mineRow), make: mineRow.make, seGap: mineRow.seGap } : null, raw[1] ? { ev: raw[1].ev, label: L(raw[1]), seGap: raw[1].seGap } : undefined);
  void t;
  return { rows, raw, chosen: mineRow?.card ?? null, gap, sample: `Monte Carlo: ${n} sampled deals per card (same deals for every card).`, kind: "play",
    replay: (k) => <ReplayPlay p={p} seat={seat} hand={hand} card={k} deck={deck} /> };
}

export function coachBid(p: View, seat: number, hand: Card[], chosen: { bid: number; nil: number } | null, deck: Card[], blind: boolean, n = 300): Coached & { raw: BidRow[] } {
  const raw = evalBid(p, seat, hand, { n, rng: rng(), deck, blind });
  let mine: BidRow | null = chosen ? raw.find((r) => r.bid === chosen.bid && r.nil === chosen.nil) ?? null : null;
  if (chosen && !mine) mine = evalBid({ ...p }, seat, hand, { n, rng: rng(), deck }).find((r) => r.bid === chosen.bid) ?? null;
  const all = mine && !raw.includes(mine) ? [...raw, mine] : raw; const best = raw[0];
  const rows = pickRows(all, (r) => r === mine).map((r): CoachRow => ({
    key: bidKey(r), label: bidLabel(r), winFrac: r.nil ? r.nilOk ?? 0 : r.make, evNum: r.ev,
    bar: r.nil ? [{ frac: r.nilOk ?? 0, cls: "good" }, { frac: 1 - (r.nilOk ?? 0), cls: "bad" }] : [{ frac: r.make, cls: "good" }, { frac: 1 - r.make, cls: "bad" }],
    metric: r.nil ? `Nil succeeds ${pct(r.nilOk ?? 0)} · team makes ${pct(r.make)} · bags ${r.bags.toFixed(1)}` : `Make ${pct(r.make)} · Set them ${pct(r.set)} · Bags ${r.bags.toFixed(1)} · you take ${r.tricks.toFixed(1)}`,
    ev: `${pts(r.ev)} pts`,
    why: r.nil ? `You'd need to take zero tricks — happened in ${pct(r.nilOk ?? 0)} of deals.` : r.make > 0.8 ? "Comfortable — most deals make it." : r.make < 0.5 ? "Ambitious — fails more often than not." : "A coin-flip-plus contract.",
    math: (<ul className="coach-ul"><li>{r.n} deals of the 39 unseen cards; players still to bid bid like the medium bot; every hand then played out by the card-counting bot.</li>
      <li>Your hand-strength estimate: {Sim.estimate(hand, p.v).toFixed(2)} tricks (aces, protected kings, spade length, ruffs).</li>
      <li>Expected points (vs opponents, bags at 10): {r.ev.toFixed(1)} ± {(1.96 * r.se).toFixed(1)}.</li>
      {r !== best && <li>Gap to best ({bidLabel(best)}): {(best.ev - r.ev).toFixed(1)} ± {(1.96 * r.seGap).toFixed(1)} pts on the same deals.</li>}</ul>),
  }));
  const gap = gapLine({ ev: best.ev, label: bidLabel(best), make: best.nil ? best.nilOk ?? 0 : best.make }, mine ? { ev: mine.ev, label: bidLabel(mine), make: mine.nil ? mine.nilOk ?? 0 : mine.make, seGap: mine.seGap } : null, raw[1] ? { ev: raw[1].ev, label: bidLabel(raw[1]), seGap: raw[1].seGap } : undefined);
  return { rows, raw, chosen: mine ? bidKey(mine) : null, gap, sample: `Monte Carlo: ${n} sampled deals per bid (same deals for every bid).`, kind: "bid" };
}

function ReplayPlay({ p, seat, hand, card, deck }: { p: View; seat: number; hand: Card[]; card: Card; deck: Card[] }) {
  const x = replayPlay(p, seat, hand, card, seededRng((Math.random() * 2 ** 32) >>> 0), deck); const t = Sim.teamOf(p.v, seat);
  const mineT = x.final.reduce((a, k, i) => a + (Sim.teamOf(p.v, i) === t && !p.nil[i] ? k : 0), 0);
  const need = p.bids.reduce<number>((a, b, i) => a + (Sim.teamOf(p.v, i) === t && !p.nil[i] ? b ?? 0 : 0), 0);
  return (
    <div className="replay pop-in">
      {x.tricks.slice(0, 13).map((tr, k) => <div key={k} className="replay-line"><span className="muted small">#{p.history.length + k + 1}</span><CardRow cards={tr.cards} small /><b>{Sim.teamOf(p.v, tr.winner) === t ? "✓ yours" : "theirs"}</b></div>)}
      <p className={x.score.points[t] >= 0 ? "good" : "bad"}>You{p.v === "partners" ? "r team" : ""}: {mineT} tricks (bid {need}) → {x.score.points[t] >= 0 ? "+" : ""}{x.score.points[t]} — one sampled deal; tap again for another.</p>
    </div>
  );
}

// ---------- tutorial tips ----------
function seenSet(p: View, hand: Card[]) { return new Set<Card>([...hand, ...p.history.flatMap((t) => t.cards), ...p.trick]); }
export function tipsPlay(p: View, seat: number, hand: Card[], names: string[], deck: Card[], raw: PlayRow[]) {
  const legal = Sim.legal(Object.assign(Sim.newHs(p.v, p.counts.map((_, i) => (i === seat ? hand : [])), p.leader), { trick: p.trick, broken: p.broken }), seat);
  const led = p.trick[0]?.[1]; const seen = seenSet(p, hand);
  const beginner = !p.trick.length ? (p.broken || hand.every((c) => c[1] === "S") ? "You're leading: any card is allowed (spades are broken)." : "You're leading: any suit except ♠ — spades can't be led until someone has trumped with one.")
    : legal.every((c) => c[1] === led) ? `Follow suit: you must play a ${SUIT[led]}. Highest ${SUIT[led]} on the table wins unless someone trumps with a ♠.` : `You have no ${SUIT[led]}, so anything goes: a ♠ trumps the trick, any other card is a throw-away.`;
  const bosses = hand.filter((c) => isBoss(c, seen, deck)); const voids: string[] = [];
  const h = { voids: p.counts.map(() => [false, false, false, false]) };
  for (const tr of [...p.history, { cards: p.trick, seats: p.trickSeats }]) for (let k = 1; k < tr.cards.length; k++) if (tr.cards[k][1] !== tr.cards[0][1]) h.voids[tr.seats[k]]["SHDC".indexOf(tr.cards[0][1])] = true;
  h.voids.forEach((v, i) => { if (i !== seat) v.forEach((x, s) => { if (x) voids.push(`${names[i]} has no ${SUIT["SHDC"[s]]}`); }); });
  const spOut = 13 - [...seen].filter((c) => c[1] === "S").length;
  const t = Sim.teamOf(p.v, seat); const need = p.bids.reduce<number>((a, b, i) => a + (Sim.teamOf(p.v, i) === t && !p.nil[i] ? (b ?? 0) - p.tricks[i] : 0), 0);
  const inter = `${bosses.length ? `Your sure winners (nothing higher left unseen): ${bosses.map(cardName).join(" ")}. ` : "None of your cards is a sure winner yet. "}${spOut} spade${spOut === 1 ? "" : "s"} still out in other hands. ${voids.length ? voids.join("; ") + ". " : ""}${p.nil[seat] ? "You bid nil — stay under every trick." : need > 0 ? `You${p.v === "partners" ? "r side" : ""} still need ${need} trick${need > 1 ? "s" : ""}.` : "Contract is made — extra tricks are bags now."}`;
  const b = raw[0], s2 = raw[1];
  const expert = b ? <>Best: <b>{cardName(b.card)}</b> — makes the contract {pct(b.make)}, sets them {pct(b.set)}, {b.bags.toFixed(1)} bags{b.nil !== null ? `, nil ${pct(b.nil)}` : ""}, takes this trick {pct(b.trick)}{s2 ? <>; next best {cardName(s2.card)} is {(b.ev - s2.ev).toFixed(1)} pts worse (make {pct(s2.make)})</> : null}.</> : "Only one card to play.";
  return [{ tier: "Beginner", text: beginner }, { tier: "Intermediate", text: inter }, { tier: "Expert", text: expert }];
}
export function tipsBid(p: View, seat: number, hand: Card[], raw: BidRow[]) {
  const est = Sim.estimate(hand, p.v); const sp = hand.filter((c) => c[1] === "S").length;
  const aces = hand.filter((c) => c[0] === "A").map(cardName); const pt = Sim.partnerOf(p.v, seat);
  const beginner = `Count your likely tricks: aces (${aces.join(" ") || "none"}), kings with a guard, and spades — you hold ${sp} spade${sp === 1 ? "" : "s"}. A careful count says about ${est.toFixed(1)} tricks.`;
  const highSp = hand.filter((c) => c[1] === "S" && RV(c) >= RV("JS"));
  const inter = `${pt >= 0 && p.bids[pt] !== null ? `Partner bid ${p.nil[pt] ? "nil — plan to cover them" : p.bids[pt]}. ` : ""}Nil wants no high spades (you have ${highSp.map(cardName).join(" ") || "none"}), ≤3 spades and no unguarded aces/kings. Bags: underbidding by 1 costs a bag (10 bags = −100).`;
  const b = raw[0], nil = raw.find((r) => r.nil === 1), nb = raw.filter((r) => !r.nil);
  const expert = <>Best: <b>{bidLabel(b)}</b> ({pts(b.ev)} pts). {nb.map((r) => `Bid ${r.bid}: makes ${pct(r.make)}`).join(" · ")}{nil ? ` · Nil: succeeds ${pct(nil.nilOk ?? 0)}` : ""}.</>;
  return [{ tier: "Beginner", text: beginner }, { tier: "Intermediate", text: inter }, { tier: "Expert", text: expert }];
}
