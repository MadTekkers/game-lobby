// Turns Monte Carlo rows (sim.ts) into coach-card rows for Blackjack.
import { evaluate, sampleOnce, type EvalInput, type Row } from "./sim.ts";
import { ACTION_LABEL, handValue, type Action } from "./strategy.ts";
import { seededRng, RANK_LABEL } from "../core.ts";
import type { CoachRow } from "../ui/TrainCard.tsx";
import { CardRow } from "../ui/PlayingCard.tsx";

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%`;
const money = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}`;
export const LABEL: Record<Row["action"], string> = { ...ACTION_LABEL, insure: "Take insurance", noinsure: "No insurance" };
const GERUND: Record<Row["action"], string> = { hit: "Hitting", stand: "Standing", double: "Doubling", split: "Splitting", insure: "Taking insurance", noinsure: "Declining insurance" };

export type CoachResult = { rows: CoachRow[]; raw: Row[]; n: number; seen: number; input: EvalInput; chosen: string | null; gap: string };

export function runCoach(input: Omit<EvalInput, "rng">, chosen: string | null, n = 20000): CoachResult {
  const inp: EvalInput = { ...input, n, rng: seededRng((Date.now() ^ 0x9e3779b9) >>> 0) };
  const raw = evaluate(inp);
  const total = handValue(input.cards).total;
  const up = RANK_LABEL(input.dealerUp[0]);
  const standRow = raw.find((r) => r.action === "stand");
  const rows: CoachRow[] = raw.map((r) => {
    const ins = r.action === "insure" || r.action === "noinsure";
    const why =
      r.action === "stand" ? `Dealer ${up} busts ${pct(r.dealerBust)} of the time — ${total} wins ${pct(r.win)} as it stands.` :
      r.action === "hit" ? `${pct(r.bustNext)} to bust on the next card${standRow ? `, but standing on ${total} only wins ${pct(standRow.win)}` : ""}.` :
      r.action === "double" ? `Twice the stake on one card: ${pct(r.strong)} chance to finish on 18–21.` :
      r.action === "split" ? `Two hands starting from ${RANK_LABEL(input.cards[0][0])}: each gets a fresh second card.` :
      r.action === "insure" ? `The hole card is a ten ${pct(r.win)} of the time — insurance needs 33.3% to break even.` :
      `Skip the side bet; it only pays when over 1/3 of the unseen cards are tens (now ${pct(r.strong)}).`;
    const ci = 1.96 * r.se;
    return {
      key: r.action, label: LABEL[r.action], winFrac: r.win, evNum: r.ev,
      bar: ins ? (r.action === "insure" ? [{ frac: r.win, cls: "good" }, { frac: r.lose, cls: "bad" }] : [{ frac: 1, cls: "mid" }]) : [{ frac: r.win, cls: "good" }, { frac: r.push, cls: "mid" }, { frac: r.lose, cls: "bad" }],
      metric: ins ? (r.action === "insure" ? `Pays ${pct(r.win)} · loses ${pct(r.lose)}` : "No side bet") : `Win ${pct(r.win)} · Push ${pct(r.push)} · Lose ${pct(r.lose)}`,
      ev: `${money(r.ev)} / $1`, why,
      math: (
        <ul className="coach-ul">
          <li>{r.n.toLocaleString()} simulated hands drawn from the 6-deck shoe minus the {input.seen.filter(Boolean).length} cards visible on the table{!ins && ["A", "T", "J", "Q", "K"].includes(input.dealerUp[0]) ? " (dealer already checked: no blackjack)" : ""}.</li>
          {ins ? <li>EV = ½ × (2 × P(ten) − (1 − P(ten))) = ½ × (2 × {r.win.toFixed(3)} − {(1 - r.win).toFixed(3)}) = {r.ev.toFixed(3)} per $1 of your bet.</li>
            : <li>EV = average net per $1 wagered{r.action === "double" || r.action === "split" ? " (both stakes counted)" : ""} = {r.ev.toFixed(3)} ± {ci.toFixed(3)} (95%).</li>}
          {!ins && <li>Win {(r.win * 100).toFixed(1)}% · push {(r.push * 100).toFixed(1)}% · lose {(r.lose * 100).toFixed(1)}% · dealer busts {(r.dealerBust * 100).toFixed(1)}%{r.action === "hit" || r.action === "double" ? ` · next card busts you ${(r.bustNext * 100).toFixed(1)}%` : ""}.</li>}
          {r.action === "hit" && <li>After the hit, the rest of the hand is played by basic strategy.</li>}
        </ul>
      ),
    };
  });
  const best = raw[0], mine = raw.find((r) => r.action === chosen);
  let gap: string;
  if (!chosen || !mine) gap = `Best play: ${LABEL[best.action]} (${money(best.ev)} per $1).`;
  else if (mine.action === best.action) gap = raw[1] ? `✓ ${LABEL[best.action]} is the best play — ${money(best.ev - raw[1].ev).replace("+", "")} per $1 better than ${LABEL[raw[1].action].toLowerCase()}.` : `✓ ${LABEL[best.action]} is the only sensible play.`;
  else {
    const dw = best.win - mine.win, de = best.ev - mine.ev;
    gap = `${GERUND[best.action]} ${dw >= 0.005 ? `wins ${Math.round(dw * 100)}% more often and ` : ""}earns $${de.toFixed(2)} more per $1 than ${GERUND[mine.action].toLowerCase()}.`;
  }
  return { rows, raw, n, seen: input.seen.length, input: inp, chosen, gap };
}

export function Replay({ input, action }: { input: EvalInput; action: string }) {
  if (action === "insure" || action === "noinsure") return <p className="muted small">Insurance is settled by the hole card alone — see the probability above.</p>;
  const x = sampleOnce({ ...input, rng: seededRng((Math.random() * 2 ** 32) >>> 0) }, action as Action, seededRng((Math.random() * 2 ** 32) >>> 0));
  return (
    <div className="replay pop-in">
      <div className="replay-line"><span className="muted small">Dealer</span><CardRow cards={x.dealer} small /><b>{handValue(x.dealer).total > 21 ? "bust" : handValue(x.dealer).total}</b></div>
      {x.hands.map((h, i) => <div key={i} className="replay-line"><span className="muted small">You{x.hands.length > 1 ? ` ${i + 1}` : ""}</span><CardRow cards={h} small /><b>{handValue(h).total > 21 ? "bust" : handValue(h).total}</b></div>)}
      <p className={x.net > 0 ? "good" : x.net < 0 ? "bad" : "muted"}>{x.net > 0 ? `Won ${x.net}×` : x.net < 0 ? `Lost ${-x.net}×` : "Push"} — one random outcome; tap again for another.</p>
    </div>
  );
}
