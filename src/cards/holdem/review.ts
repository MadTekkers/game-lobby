// Hold'em decisions for hand review + mistake drills, scored with the same Monte Carlo as the Train comparison cards.
import { seededRng, type Card } from "../core.ts";
import { evaluate, describe } from "./eval.ts";
import { evalOptions, options, type CoachSpot, type OptRow } from "./coach.ts";
import { classify, newId, type Decision } from "../coach/record.ts";
import { cname, pct } from "../coach/trickHelp.ts";

const rng = () => seededRng((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
export const hKey = (m: { t: string; to?: number }) => (m.t === "raise" ? `r${m.to}` : m.t);
export type HoEval = { rows: OptRow[]; s: CoachSpot };
/** Score every standard option (plus the player's own bet size when it isn't one of them). */
export function hoEval(s: CoachSpot, chosen?: { t: string; to?: number }, n = 300): HoEval {
  let opts = options(s);
  if (chosen?.t === "raise" && !opts.some((o) => o.key === hKey(chosen))) opts = [...opts, { key: hKey(chosen), label: `${s.maxBet ? "Raise to" : "Bet"} ${chosen.to}`, t: "raise", to: chosen.to }];
  return { rows: evalOptions(s, opts, { n, rng: rng() }), s };
}
export const hoHas = (e: HoEval, m: { t: string; to?: number }) => e.rows.some((r) => r.key === hKey(m));
const STREET = ["Before the flop", "", "", "On the flop", "On the turn", "On the river"];
export function holdingName(s: CoachSpot) {
  if (s.board.length) return describe(evaluate([...s.hole, ...s.board])).toLowerCase();
  const [a, b] = s.hole; return a[0] === b[0] ? `a pair of ${cname(a)} ${cname(b)}` : `${cname(a)} ${cname(b)}${a[1] === b[1] ? " (same suit)" : ""}`;
}
function why(r: OptRow, s: CoachSpot) {
  const need = s.toCall / (s.pot + s.toCall || 1);
  switch (r.t) {
    case "fold": return `You'd win this pot only about ${pct(r.eq)} of the time, but calling needs ${pct(need)} to pay off — so folding saves chips.`;
    case "check": return `Checking lets you see more cards for free; betting here wouldn't get worse hands to pay you.`;
    case "call": return `You win about ${pct(r.eq)} of the time, and the price only needs ${pct(need)} — so calling makes money over time.`;
    case "raise": return r.foldPct > 0.5 ? `A bet here makes the others fold ${pct(r.foldPct)} of the time, so you often win the pot right away.` : `Your hand is usually best (${pct(r.calledWin)} when called), so bet to get paid by worse hands.`;
  }
}
const bbOf = (x: number, bb: number) => `${Math.max(0.1, x / bb).toFixed(1)} big blind${Math.abs(x / bb - 1) < 0.05 ? "" : "s"}`;
export function hoDecision(e: HoEval, chosen: { t: string; to?: number }, c: { hand: string; handLabel: string }, caught?: { t: string; to?: number }): Decision {
  const { rows, s } = e; const key = hKey(chosen);
  const label = (k: string) => rows.find((r) => r.key === k)?.label ?? (chosen.t === "raise" ? `Bet ${chosen.to}` : k);
  const cl = classify(rows.map((r) => ({ key: r.key, label: r.label.replace(/ \(.*\)$/, ""), ev: r.ev, seGap: r.seGap })), key, Math.max(1, 0.15 * s.bb));
  const best = rows.find((r) => r.key === cl.best.key)!; const mine = rows.find((r) => r.key === key);
  const street = STREET[s.board.length] || "On the board";
  const price = s.toCall ? `It cost ${s.toCall} to call into a pot of ${s.pot}.` : "Nobody had bet yet.";
  const situation = `${street}, holding ${holdingName(s)}. ${price}`;
  let w = why(best, s);
  if (cl.verdict === "mistake" && mine) w += mine.t === "fold" ? ` Folding threw away a pot you win ${pct(best.t === "raise" ? best.calledWin : best.eq)} of the time.` : mine.t === "call" && best.t === "fold" ? ` Calling pays more than your chances are worth.` : mine.t === "raise" && mine.foldPct < 0.3 && mine.calledWin < 0.5 ? ` Your bet rarely makes better hands fold, and they usually beat you when they call.` : "";
  const cards = [{ label: "Your cards", cards: s.hole as Card[] }, ...(s.board.length ? [{ label: "Board", cards: s.board as Card[] }] : [])];
  return { id: newId(), game: "holdem", hand: c.hand, handLabel: c.handLabel, at: Date.now(), step: street,
    situation, chosen: { key, label: cl.mine?.label ?? label(key) }, best: { key: best.key, label: cl.best.label }, verdict: mine ? cl.verdict : "mistake", why: w,
    cost: cl.verdict === "best" ? "" : `About ${bbOf(cl.gap, s.bb)} worse on average${cl.verdict === "close" ? " — close enough" : ""}.`,
    sig: `ho|${[...s.hole].sort().join("")}|${[...s.board].sort().join("")}|${s.toCall}`,
    spot: { prompt: s.toCall ? `${street}. ${s.toCall} to call into ${s.pot}. What do you do?` : `${street}. It's checked to you (pot ${s.pot}). What do you do?`, groups: cards,
      facts: [`${s.opps.length} other player${s.opps.length === 1 ? "" : "s"} still in. Big blind is ${s.bb}.`],
      options: rows.map((r) => ({ key: r.key, label: r.label })), ok: cl.ok, best: best.key, why: why(best, s), state: { s } },
    caught: caught ? { key: hKey(caught), label: label(hKey(caught)) } : undefined };
}
/** Guided-mode suggestion for the current decision. */
export function hoHint(e: HoEval): { key: string; label: string; why: string } { const b = e.rows[0]; return { key: b.key, label: b.label, why: why(b, e.s) }; }
