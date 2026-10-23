// Hearts coach card + tutorial tips built from the Monte Carlo rows in coach.ts.
import type { ReactNode } from "react";
import { seededRng, type Card } from "../core.ts";
import { isBoss, RV } from "../tricks.ts";
import type { CoachRow } from "../ui/TrainCard.tsx";
import { CardRow } from "../ui/PlayingCard.tsx";
import { cardName } from "../ui/TrickTable.tsx";
import * as Sim from "./sim.ts";
import { evalPlay, evalPass, passCandidates, replayPlay, knownHs, type View, type PlayRow, type PassRow, type Given } from "./coach.ts";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sg = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" } as Record<string, string>;
export type Coached = { rows: CoachRow[]; chosen: string | null; gap: string; sample: string; kind: "play" | "pass"; replay?: (k: string) => ReactNode };
const rng = () => seededRng((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
const passKey = (c: Card[]) => [...c].sort().join(",");
const passLabel = (r: { cards: Card[]; label: string }) => `${r.label}: ${r.cards.map(cardName).join(" ")}`;

function pickRows<R>(rows: R[], isMine: (r: R) => boolean, k = 4) { const top = rows.slice(0, k); const mine = rows.find(isMine); if (mine && !top.includes(mine)) top[k - 1] = mine; return top; }
type G = { ev: number; label: string; qs: number; pts: number; seGap: number };
function gapLine(best: G, mine: G | null, second?: G) {
  if (!mine) return `Best: ${best.label} (${best.pts.toFixed(1)} points expected for you, ${pct(best.qs)} chance of eating Q♠).`;
  if (mine.label === best.label) return second ? `✓ ${best.label} is the best option — ${(best.ev - second.ev).toFixed(1)} pts better on average than ${second.label} (±${(1.96 * second.seGap).toFixed(1)}).` : `✓ ${best.label} was the only real option.`;
  const d = best.ev - mine.ev, noise = 1.96 * mine.seGap;
  if (d <= noise) return `≈ ${mine.label} is within simulation noise of the best (${best.label}, ${d.toFixed(1)} ± ${noise.toFixed(1)} pts) — fine.`;
  const dq = mine.qs - best.qs;
  return `${best.label} ${Math.abs(dq) >= 0.02 ? `${dq > 0 ? "takes the Q♠" : "risks the Q♠"} ${pct(Math.abs(dq))} ${dq > 0 ? "less" : "more"} often and ` : ""}gains ${d.toFixed(1)} pts on average vs ${mine.label} (you'd score ${best.pts.toFixed(1)} instead of ${mine.pts.toFixed(1)}; ±${noise.toFixed(1)}).`;
}
const mathRows = (r: { n: number; ev: number; se: number; pts: number; qs: number; moon: number; oppMoon: number; seGap: number }, best: { ev: number }, bestLabel: string, what: string): ReactNode => (
  <ul className="coach-ul">
    <li>{r.n} {what}; every seat then plays out the hand with the card-counting bot.</li>
    <li>Your expected points this hand: {r.pts.toFixed(2)} (hearts 1 each, Q♠ 13; a moon gives everyone else 26).</li>
    <li>Q♠ lands on you in {Math.round(r.qs * r.n)}/{r.n}; you shoot the moon in {Math.round(r.moon * r.n)}/{r.n}; someone else shoots in {Math.round(r.oppMoon * r.n)}/{r.n}.</li>
    <li>EV = average opponent points − yours: {r.ev.toFixed(2)} ± {(1.96 * r.se).toFixed(2)} (95%).</li>
    {r.ev !== best.ev && <li>Gap to best ({bestLabel}): {(best.ev - r.ev).toFixed(2)} ± {(1.96 * r.seGap).toFixed(2)} on the same deals.</li>}
  </ul>);
const bar = (r: { qs: number; pts: number }) => { const q = Math.min(1, r.qs); const h = Math.max(0, Math.min(1 - q, (r.pts - 13 * r.qs) / 13)); return [{ frac: 1 - q - h, cls: "good" as const }, { frac: h, cls: "mid" as const }, { frac: q, cls: "bad" as const }]; };

export function coachPlay(p: View, seat: number, hand: Card[], chosen: Card | null, given: Given, n = 200): Coached & { raw: PlayRow[] } {
  const raw = evalPlay(p, seat, hand, { n, rng: rng(), given }); const best = raw[0]; const deck = Sim.deckFor(p.v);
  const gone = new Set<Card>([...hand, ...p.history.flatMap((x) => x.cards), ...p.trick]);
  const equiv = (a: Card, b: Card) => { if (a[1] !== b[1]) return false; const lo = Math.min(RV(a), RV(b)), hi = Math.max(RV(a), RV(b)); return deck.every((c) => c[1] !== a[1] || RV(c) <= lo || RV(c) >= hi || gone.has(c)); };
  const mineRow = chosen ? raw.find((r) => r.card === chosen) ?? raw.find((r) => equiv(r.card, chosen)) ?? null : null;
  const L = (r: PlayRow) => cardName(r.card);
  const rows = pickRows(raw, (r) => r === mineRow).map((r): CoachRow => ({
    key: r.card, label: L(r) + (mineRow === r && chosen && chosen !== r.card ? ` (= ${cardName(chosen)})` : ""), winFrac: 1 - r.qs, evNum: r.ev, bar: bar(r),
    metric: `${p.qs >= 0 ? "" : `Q♠ to you ${pct(r.qs)} · `}your pts ${r.pts.toFixed(1)} · moon ${pct(r.moon)}${r.oppMoon > 0.005 ? ` · opp. moon ${pct(r.oppMoon)}` : ""} · takes trick ${pct(r.trick)}`,
    ev: `${sg(r.ev)} vs avg`,
    why: r.trick < 0.03 ? "Ducks — someone else takes this trick." : r.trick > 0.97 ? "Wins this trick for certain — fine only if it's clean or you want the lead." : `Wins this trick ${pct(r.trick)} of the time.`,
    math: mathRows(r, best, L(best), `sampled deals of the hidden cards, consistent with every void shown${p.counts.length ? " and the cards you passed" : ""}`),
  }));
  const g = (r: PlayRow): G => ({ ev: r.ev, label: L(r), qs: r.qs, pts: r.pts, seGap: r.seGap });
  return { rows, raw, chosen: mineRow?.card ?? null, gap: gapLine(g(best), mineRow ? g(mineRow) : null, raw[1] ? g(raw[1]) : undefined),
    sample: `Monte Carlo: ${n} sampled deals per card (same deals for every card).`, kind: "play", replay: (k) => <ReplayPlay p={p} seat={seat} hand={hand} card={k} given={given} /> };
}
export function coachPass(v: Sim.Variant, n: number, seat: number, hand: Card[], off: number, chosen: Card[] | null, N = 160): Coached & { raw: PassRow[] } {
  const R = rng(); const raw = evalPass(v, n, seat, hand, off, passCandidates(hand, R, chosen ?? undefined), { n: N, rng: R });
  const best = raw[0]; const mine = chosen ? raw.find((r) => passKey(r.cards) === passKey(chosen)) ?? null : null;
  const rows = pickRows(raw, (r) => r === mine).map((r): CoachRow => ({
    key: passKey(r.cards), label: passLabel(r), winFrac: 1 - r.qs, evNum: r.ev, bar: bar(r),
    metric: `Q♠ to you ${pct(r.qs)} · your pts ${r.pts.toFixed(1)} · moon ${pct(r.moon)} · opp. moon ${pct(r.oppMoon)}`, ev: `${sg(r.ev)} vs avg`,
    why: r.cards.includes("QS") ? "Gets rid of the queen — but the receiver knows where it is." : r.cards.some((c) => c === "AS" || c === "KS") ? "Sheds a spade that could be forced to catch the queen." : r.cards.every((c) => c[1] === r.cards[0][1]) ? "Clears one suit." : "Dumps high cards that win tricks.",
    math: mathRows(r, best, passLabel(best), `deals of the other hands; the other players pass like the medium bot`),
  }));
  const g = (r: PassRow): G => ({ ev: r.ev, label: passLabel(r), qs: r.qs, pts: r.pts, seGap: r.seGap });
  return { rows, raw, chosen: mine ? passKey(mine.cards) : null, gap: gapLine(g(best), mine ? g(mine) : null, raw[1] ? g(raw[1]) : undefined), sample: `Monte Carlo: ${N} sampled deals per pass (same deals for every pass).`, kind: "pass" };
}
function ReplayPlay({ p, seat, hand, card, given }: { p: View; seat: number; hand: Card[]; card: Card; given: Given }) {
  const x = replayPlay(p, seat, hand, card, seededRng((Math.random() * 2 ** 32) >>> 0), given);
  return (
    <div className="replay pop-in">
      {x.tricks.slice(0, 17).map((tr, k) => <div key={k} className="replay-line"><span className="muted small">#{p.history.length + k + 1}</span><CardRow cards={tr.cards} small /><b>{tr.winner === seat ? `you +${tr.cards.reduce((a, c) => a + Sim.cardPts(c), 0)}` : "theirs"}</b></div>)}
      <p className={x.score.points[seat] <= 5 ? "good" : "bad"}>{x.score.moon === seat ? "You shoot the moon!" : `You score ${x.score.points[seat]} this hand`} — one sampled deal; tap again for another.</p>
    </div>
  );
}

// ---------- tutorial tips ----------
export function tipsPlay(p: View, seat: number, hand: Card[], names: string[], raw: PlayRow[]) {
  const h = knownHs(p, seat, hand); const L = Sim.legal(h, seat); const led = p.trick[0]?.[1]; const deck = Sim.deckFor(p.v);
  const seen = new Set<Card>([...hand, ...p.history.flatMap((t) => t.cards), ...p.trick]);
  const first = p.history.length === 0;
  const beginner = !p.trick.length ? (first ? "First trick: the lowest club must lead." : p.broken ? "You're leading: any suit — hearts are broken." : "You're leading: any suit except ♥ — hearts can't be led until one has been thrown.")
    : L.every((c) => c[1] === led) ? `Follow suit: play a ${SUIT[led]}. The highest ${SUIT[led]} takes the trick — and every heart and Q♠ in it.` : `You have no ${SUIT[led]}, so you can throw anything${first ? " (except points on the first trick)" : " — a perfect time to dump Q♠ or a high heart"}.`;
  const voids: string[] = []; h.voids.forEach((v, i) => { if (i !== seat) v.forEach((x, s) => { if (x) voids.push(`${names[i]} has no ${SUIT["SHDC"[s]]}`); }); });
  const qsGone = p.qs >= 0 || p.trick.includes("QS"); const hOut = 13 - [...seen].filter((c) => c[1] === "H").length;
  const sureLosers = hand.filter((c) => deck.filter((x) => x[1] === c[1] && RV(x) < RV(c) && !seen.has(x)).length === 0);
  const inter = `${qsGone ? `Q♠ is gone${p.qs >= 0 ? ` (${names[p.qs] === "You" ? "you" : names[p.qs]} took it)` : ""}. ` : hand.includes("QS") ? "You hold Q♠ — dump it when void, or drop it under A♠/K♠. " : "Q♠ is still out — don't win a spade trick with A♠/K♠ unless it's safe. "}${hOut} heart${hOut === 1 ? "" : "s"} still out. ${voids.length ? voids.join("; ") + ". " : ""}${sureLosers.length ? `Safe low cards (nothing lower unseen): ${sureLosers.map(cardName).join(" ")}. ` : ""}Points so far: ${p.pts.map((x, i) => `${names[i]} ${x}`).join(", ")}.`;
  void isBoss;
  const b = raw[0], s2 = raw[1];
  const qx = (r: PlayRow) => (p.qs >= 0 ? "" : `Q♠ to you ${pct(r.qs)}, `);
  const expert = b ? <>Best: <b>{cardName(b.card)}</b> — {qx(b)}{b.pts.toFixed(1)} expected points, moon {pct(b.moon)}, takes this trick {pct(b.trick)}{s2 ? <>; next best {cardName(s2.card)} costs {(b.ev - s2.ev).toFixed(1)} pts ({qx(s2)}{s2.pts.toFixed(1)} pts)</> : null}.</> : "Only one card to play.";
  return [{ tier: "Beginner", text: beginner }, { tier: "Intermediate", text: inter }, { tier: "Expert", text: expert }];
}
export function tipsPass(hand: Card[], off: number, to: string, raw: PassRow[]) {
  const sp = hand.filter((c) => c[1] === "S"); const low = sp.filter((c) => RV(c) < RV("QS")).length;
  const beginner = `Pick 3 cards to pass ${off ? `to ${to}` : ""}. Pass cards that win tricks you don't want: Q♠, A♠/K♠, high hearts, and aces/kings.`;
  const inter = `${hand.includes("QS") ? (low >= 4 ? `You hold Q♠ with ${low} low spades — keeping it is reasonable (you can duck spade leads).` : `Q♠ with only ${low} low spade${low === 1 ? "" : "s"} is dangerous — consider passing it.`) : hand.some((c) => c === "AS" || c === "KS") ? "A♠/K♠ without the queen can be forced to catch her — pass them unless you have many low spades." : "No high spades: work on voiding a short suit so you can dump points later."} Short suits: ${(["C", "D", "H"] as const).map((s) => `${SUIT[s]}${hand.filter((c) => c[1] === s).length}`).join(" ")}.`;
  const b = raw[0];
  const expert = b ? <>Best pass: <b>{b.cards.map(cardName).join(" ")}</b> ({b.label}) — Q♠ to you {pct(b.qs)}, {b.pts.toFixed(1)} expected points. {raw.slice(1, 3).map((r) => `${r.label}: Q♠ ${pct(r.qs)}, ${r.pts.toFixed(1)} pts`).join(" · ")}</> : "";
  return [{ tier: "Beginner", text: beginner }, { tier: "Intermediate", text: inter }, { tier: "Expert", text: expert }];
}
