// Hold'em coach card + tutorial tips built from the Monte Carlo rows in coach.ts.
import type { ReactNode } from "react";
import { seededRng, type Card } from "../core.ts";
import type { CoachRow } from "../ui/TrainCard.tsx";
import { CardRow } from "../ui/PlayingCard.tsx";
import { cardName } from "../ui/TrickTable.tsx";
import { evaluate, describe } from "./eval.ts";
import * as Sim from "./sim.ts";
import { evalOptions, options, outs, replayOption, type CoachSpot, type OptRow, type Option } from "./coach.ts";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const chipsS = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x))}`;
export type Coached = { rows: CoachRow[]; chosen: string | null; gap: string; sample: string; raw: OptRow[]; replay?: (k: string) => ReactNode };
const rng = () => seededRng((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
export const keyOf = (m: { t: string; to?: number }) => (m.t === "raise" ? `r${m.to}` : m.t);

function why(r: OptRow, s: CoachSpot) {
  const potOdds = s.toCall / (s.pot + s.toCall || 1);
  if (r.t === "fold") return "Gives up the pot — right when your equity is below the price.";
  if (r.t === "check") return `Free card: you realize ${pct(r.eq)} equity without risking chips.`;
  if (r.t === "call") return r.eq >= potOdds ? `Equity ${pct(r.eq)} beats the ${pct(potOdds)} you need — a profitable call.` : `You need ${pct(potOdds)} but have ${pct(r.eq)} — you're paying too much.`;
  if (r.foldPct > 0.5) return `Mostly a bluff/protection bet: wins at once ${pct(r.foldPct)} of the time.`;
  return r.calledWin > 0.55 ? `Value bet: worse hands call and you win ${pct(r.calledWin)} of those showdowns.` : `Semi-bluff: folds out ${pct(r.foldPct)}, and you still have ${pct(r.calledWin)} when called.`;
}
const bar = (r: OptRow) => r.t === "raise" ? [{ frac: r.foldPct, cls: "good" as const }, { frac: (1 - r.foldPct) * r.calledWin, cls: "mid" as const }, { frac: (1 - r.foldPct) * (1 - r.calledWin), cls: "bad" as const }]
  : r.t === "fold" ? [{ frac: 1, cls: "mid" as const }] : [{ frac: r.eq, cls: "good" as const }, { frac: 1 - r.eq, cls: "bad" as const }];
function metric(r: OptRow, s: CoachSpot) {
  if (r.t === "fold") return "Equity forfeited · EV 0 by definition";
  if (r.t === "raise") return `Folds out ${pct(r.foldPct)} · equity when called ${r.calledN ? pct(r.calledWin) : "—"} · risks ${Math.round(r.risk)}`;
  return `Equity ${pct(r.eq)}${s.toCall ? ` vs ${pct(s.toCall / (s.pot + s.toCall))} needed` : ""}`;
}
function gapLine(best: OptRow, mine: OptRow | null, second: OptRow | undefined, bb: number) {
  const b = (x: number) => `${(x / bb).toFixed(2)} bb`;
  if (!mine) return `Best: ${best.label} (EV ${chipsS(best.ev)} chips = ${b(best.ev)}).`;
  if (mine.key === best.key) return second ? `✓ ${best.label} is the best option — ${Math.round(best.ev - second.ev)} chips (${b(best.ev - second.ev)}) better than ${second.label} (±${Math.round(1.96 * second.seGap)}).` : `✓ ${best.label} was the only option.`;
  const d = best.ev - mine.ev, noise = 1.96 * mine.seGap;
  if (d <= noise) return `≈ ${mine.label} is within simulation noise of the best (${best.label}, ${Math.round(d)} ± ${Math.round(noise)} chips) — fine.`;
  return `${best.label} gains ${Math.round(d)} chips (${b(d)}) on average vs ${mine.label}: EV ${chipsS(best.ev)} instead of ${chipsS(mine.ev)} (±${Math.round(noise)}).`;
}
const mathOf = (r: OptRow, best: OptRow, s: CoachSpot): ReactNode => (
  <ul className="coach-ul">
    <li>{r.n} samples: opponents' hole cards drawn from the ranges their actions imply (raised pre-flop → top ~20%, called → top ~50%, bet this street → a pair or a draw), then the rest of the board.</li>
    {r.t === "call" && <li>Pot odds: call {s.toCall} to win {s.pot} → need {pct(s.toCall / (s.pot + s.toCall))}; EV = {pct(r.eq)} × {s.pot + s.toCall} − {s.toCall} = {chipsS(r.ev)}.</li>}
    {r.t === "check" && <li>EV = {pct(r.eq)} × pot {s.pot} = {chipsS(r.ev)} (checked down).</li>}
    {r.t === "raise" && <li>Each opponent calls when their hand strength beats the price you lay them (+8%); everyone folded in {Math.round(r.foldPct * r.n)}/{r.n} samples. EV = P(fold) × {s.pot} + P(call) × (equity × final pot − {Math.round(r.risk)}) → {chipsS(r.ev)}.</li>}
    <li>EV {chipsS(r.ev)} ± {Math.round(1.96 * r.se)} chips (95%), i.e. {(r.ev / s.bb).toFixed(2)} bb. Folding is the 0 baseline; called hands are checked down.</li>
    {r.key !== best.key && <li>Gap to best ({best.label}): {Math.round(best.ev - r.ev)} ± {Math.round(1.96 * r.seGap)} chips on the same samples.</li>}
  </ul>);
export function coachSpot(s: CoachSpot, chosen: { t: string; to?: number } | null, n = 400): Coached {
  let opts = options(s);
  if (chosen?.t === "raise" && !opts.some((o) => o.key === keyOf(chosen))) opts = [...opts, { key: keyOf(chosen), label: `${s.maxBet ? "Raise to" : "Bet"} ${chosen.to} (yours)`, t: "raise", to: chosen.to }];
  const raw = evalOptions(s, opts, { n, rng: rng() }); const best = raw[0];
  const mine = chosen ? raw.find((r) => r.key === keyOf(chosen)) ?? null : null;
  let shown = raw.slice(0, 4); if (mine && !shown.includes(mine)) shown = [...shown.slice(0, 3), mine];
  const rows = shown.map((r): CoachRow => ({ key: r.key, label: r.label, winFrac: r.t === "raise" ? r.foldPct + (1 - r.foldPct) * r.calledWin : r.eq, evNum: r.ev, bar: bar(r),
    metric: metric(r, s), ev: `${chipsS(r.ev)} (${(r.ev / s.bb).toFixed(1)} bb)`, why: why(r, s), math: mathOf(r, best, s) }));
  return { rows, raw, chosen: mine?.key ?? null, gap: gapLine(best, mine, raw[1], s.bb), sample: `Monte Carlo: ${n} samples per option (same samples for every option).`,
    replay: (k) => { const op = raw.find((r) => r.key === k); return op ? <Replay s={s} op={op} /> : null; } };
}
function Replay({ s, op }: { s: CoachSpot; op: Option }) {
  const x = replayOption(s, op, seededRng((Math.random() * 2 ** 32) >>> 0));
  const callers = s.opps.map((_, i) => i).filter((i) => x.resp[i] !== "fold");
  const best = Math.max(...callers.map((i) => x.sc[i]), -1);
  const res = op.t === "fold" ? "You fold." : !callers.length ? `Everyone folds — you win ${s.pot}.` : x.me > best ? `You win with ${describe(x.me)}.` : x.me === best ? "Split pot." : `You lose to ${describe(best)}.`;
  return (<div className="replay pop-in">
    {s.opps.map((o, i) => <div key={o.seat} className="replay-line"><span className="muted small">Seat {o.seat + 1}</span><CardRow cards={x.holes[i]} small /><b>{x.resp[i] === "fold" ? "folds" : x.resp[i] === "call" ? "calls" : ""}</b></div>)}
    <div className="replay-line"><span className="muted small">Board</span><CardRow cards={x.board} small /></div>
    <p className="small"><b>{res}</b> (one sampled run — the EV above averages hundreds.)</p></div>);
}
/** Tutorial tips at every decision. `peek` = everyone's cards (tutorial tables reveal them). */
export function tips(s: CoachSpot, raw: OptRow[], pos: Sim.Pos, peek: Card[][] | null) {
  const potOdds = s.toCall / (s.pot + s.toCall || 1);
  const ch = Sim.chen(s.hole);
  const made = s.board.length ? describe(evaluate([...s.hole, ...s.board])) : s.hole[0][0] === s.hole[1][0] ? `Pocket pair (${cardName(s.hole[0])} ${cardName(s.hole[1])})` : `${cardName(s.hole[0])} ${cardName(s.hole[1])}${s.hole[0][1] === s.hole[1][1] ? " suited" : ""}`;
  const beginner = !s.board.length
    ? `${made}. Chen score ${ch} (AA = 20). ${ch >= 10 ? "A premium hand — raise." : ch >= Sim.OPEN_CHART[pos] ? `Good enough to open from ${pos === "sb" || pos === "bb" ? "the blinds" : `${pos} position`}.` : "Below the opening line for this seat — usually fold unless it's free."}`
    : `You have ${made}. ${s.toCall ? `It costs ${s.toCall} to stay in.` : "You can check for free."}`;
  const o = outs(s.hole, s.board);
  const inter = s.board.length && s.board.length < 5
    ? `${o.length ? `${o.length} outs (${o.slice(0, 8).map(cardName).join(" ")}${o.length > 8 ? "…" : ""}) → about ${o.length * (s.board.length === 3 ? 4 : 2)}% to improve by the river (rule of 4 and 2). ` : "No clean outs to two pair or better. "}${s.toCall ? `Pot odds: you need ${pct(potOdds)} equity to call.` : ""}`
    : s.toCall ? `Pot odds: call ${s.toCall} into ${s.pot} → you need ${pct(potOdds)} equity.` : "Position matters: acting last lets you see what others do first.";
  const b = raw[0], r2 = raw[1];
  const expert = b ? <>Best: <b>{b.label}</b> — EV {chipsS(b.ev)} chips{b.t === "raise" ? `, folds out ${pct(b.foldPct)}` : `, equity ${pct(b.eq)}`}{r2 ? <>; next {r2.label} {chipsS(r2.ev)}</> : null} ({b.n} samples).</> : "";
  const out = [{ tier: "Beginner", text: beginner as ReactNode }, { tier: "Intermediate", text: inter as ReactNode }, { tier: "Expert", text: expert as ReactNode }];
  if (peek && peek.length) { const eq = Sim.equityVsKnown(s.hole, s.board, peek, 600, rng()); out.push({ tier: "Peek", text: <>Against the hands actually out there ({peek.map((h) => h.map(cardName).join(" ")).join(" · ")}) you have <b>{pct(eq)}</b> equity{s.board.length >= 3 ? " (exact over every runout)" : " (600-sample Monte Carlo)"}.</> }); }
  return out;
}
