// Blackjack tutorial/Train extras: the Hi-Lo counting trainer and the rules check-in quiz.
import { useEffect, useState } from "react";
import { RANK_LABEL, type Card } from "../core.ts";
import { runningCount, trueCount, trueCountExact, decksLeft, betUnits, indexPlay, hiLoTag, ILLUSTRIOUS_18 } from "./count.ts";
import { RULES_QUIZ, loadRules, saveRules, type RulesProgress } from "./rules.ts";
import { ACTION_LABEL } from "./strategy.ts";
import type { PublicBJ } from "./engine.ts";

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export function useCount(pub: PublicBJ | null) {
  if (!pub) return null;
  const { rc, visible } = runningCount(pub as never);
  return { rc, visible, tc: trueCount(rc, pub.shoeLeft), tcx: trueCountExact(rc, pub.shoeLeft), decks: decksLeft(pub.shoeLeft) };
}

export function CountPanel({ pub, myCards, up, insurance, minBet }: { pub: PublicBJ; myCards: Card[] | null; up: Card | null; insurance: boolean; minBet: number }) {
  const c = useCount(pub)!;
  const [show, setShow] = useState(() => load("bj_count_show", false));
  useEffect(() => save("bj_count_show", show), [show]);
  const [stats, setStats] = useState(() => load("bj_count_stats", { asked: 0, right: 0 }));
  const quizDue = pub.phase === "betting" && pub.results.length > 0 && pub.round > 1 && (pub.round - 1) % 3 === 0;
  const [ans, setAns] = useState<{ round: number; rc: string; tc: string; done: boolean }>({ round: 0, rc: "", tc: "", done: false });
  const q = ans.round === pub.round ? ans : { round: pub.round, rc: "", tc: "", done: false };
  const submit = () => {
    const okRc = Number(q.rc) === c.rc, okTc = q.tc === "" || Number(q.tc) === c.tc;
    const st = { asked: stats.asked + 1, right: stats.right + (okRc && okTc ? 1 : 0) }; setStats(st); save("bj_count_stats", st);
    setAns({ ...q, done: true });
  };
  const ip = myCards && up ? indexPlay(myCards, up, c.tc, insurance) : null;
  const roundCards = c.visible;
  return (
    <div className="count">
      <div className="count-top">
        <label className="switch"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show the count</label>
        <span className="muted small">Quiz score {stats.right}/{stats.asked}</span>
      </div>
      {show ? (
        <div className="count-nums" aria-live="polite">
          <div><span className="muted tiny">Running</span><b>{sign(c.rc)}</b></div>
          <div><span className="muted tiny">Decks left</span><b>{c.decks}</b></div>
          <div><span className="muted tiny">True count</span><b>{sign(c.tc)}</b><span className="tiny muted">({c.tcx.toFixed(1)})</span></div>
          <div><span className="muted tiny">Bet</span><b>{betUnits(c.tc)}×</b><span className="tiny muted">{betUnits(c.tc) * minBet}</span></div>
        </div>
      ) : <p className="count-hidden">Count hidden — keep it in your head. {quizDue ? "Quiz time!" : `A quiz pops up every 3 rounds.`}</p>}
      {quizDue && !show && (
        <div className="count-quiz pop-in" role="group" aria-label="Count quiz">
          <b>🧮 What's the count?</b>
          {!q.done ? (<>
            <div className="count-q"><label>Running count <input inputMode="numeric" value={q.rc} onChange={(e) => setAns({ ...q, rc: e.target.value.replace(/[^-\d]/g, "") })} placeholder="e.g. +4" /></label>
              <label>True count <input inputMode="numeric" value={q.tc} onChange={(e) => setAns({ ...q, tc: e.target.value.replace(/[^-\d]/g, "") })} placeholder="optional" /></label></div>
            <button className="pill sm" disabled={q.rc === "" || q.rc === "-"} onClick={submit}>Check</button>
          </>) : (
            <div className={`count-fb ${Number(q.rc) === c.rc ? "ok" : "warn"}`}>
              {Number(q.rc) === c.rc ? "✓ Correct running count" : `✗ The running count is ${sign(c.rc)} (you said ${sign(Number(q.rc))}, off by ${Math.abs(Number(q.rc) - c.rc)})`}.{" "}
              True count {sign(c.rc)} ÷ {c.decks} decks ≈ <b>{sign(c.tc)}</b>{q.tc !== "" && (Number(q.tc) === c.tc ? " ✓" : ` (you said ${sign(Number(q.tc))})`)}.
              <div className="tiny">This round's cards: {roundCards.map((x, i) => <span key={i} className="tag">{RANK_LABEL(x[0])}{sign(hiLoTag(x))}</span>)} — earlier rounds this shoe: {sign(pub.rcPrev ?? 0)}.</div>
            </div>)}
        </div>)}
      {show && roundCards.length > 0 && <div className="tiny count-break">On the table: {roundCards.map((x, i) => <span key={i} className="tag">{RANK_LABEL(x[0])}{sign(hiLoTag(x))}</span>)}</div>}
      {ip && (
        <div className={`count-ip ${ip.on ? "on" : ""}`}>
          <b>Index play · {ip.label}</b>: {ip.play === "insure" ? "take insurance" : ACTION_LABEL[ip.play as keyof typeof ACTION_LABEL]} at true count {ip.dir === "ge" ? "≥" : "≤"} {sign(ip.at)} (basic strategy: {ip.base}).
          {show ? (ip.on ? " The count says deviate now." : " Not at this count — play basic strategy.") : " Hidden count: decide yourself!"}
        </div>)}
      {pub.reshuffled && <p className="tiny muted">New shoe this round — the count restarted at 0.</p>}
      <details className="count-tips">
        <summary>How to count (Hi-Lo)</summary>
        <ol>
          <li><b>Tag every card</b>: 2–6 = +1, 7–9 = 0, 10/J/Q/K/A = −1. A full deck sums to 0, so a positive count means the rest of the shoe is rich in tens and aces (good for you: more blackjacks, dealer busts more).</li>
          <li><b>Keep track while playing</b>: count in pairs — a high and a low card cancel — and add each hand as it's finished, then the dealer's hole card when it's turned. Practise by running through a deck: aim for under 25 seconds.</li>
          <li><b>Convert to a true count</b>: divide the running count by the decks left (estimate from the discard tray, to the half deck). +6 with 3 decks left is TC +2.</li>
          <li><b>Bet spread</b>: each +1 of true count is worth roughly +0.5% to the player. Bet the minimum at TC ≤ +1 and ramp up (2× at +2, 4× at +3, 6× at +4, 8× at +5+).</li>
          <li><b>Index plays</b>: deviate from basic strategy at set true counts. The most valuable: insurance at TC ≥ +3, stand 16 vs 10 at ≥ 0, stand 15 vs 10 at ≥ +4.</li>
        </ol>
        <table className="ip-table"><thead><tr><th>Hand</th><th>Play</th><th>When TC</th></tr></thead>
          <tbody>{ILLUSTRIOUS_18.map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.play === "insure" ? "Insure" : ACTION_LABEL[r.play as keyof typeof ACTION_LABEL]}</td><td>{r.dir === "ge" ? "≥" : "≤"} {sign(r.at)}</td></tr>)}</tbody></table>
        <p className="tiny muted">Sources: Wikipedia “Card counting”; Wizard of Odds, “Introduction to the High-Low card counting strategy”; Don Schlesinger, <i>Blackjack Attack</i> (the Illustrious 18). Counting is legal but casinos may refuse your action. Details in docs/strategy/blackjack.md.</p>
      </details>
    </div>
  );
}

export function RulesQuiz() {
  const [prog, setProg] = useState<RulesProgress>(() => loadRules());
  const firstOpen = RULES_QUIZ.findIndex((q) => !prog[q.id]?.right);
  const [i, setI] = useState(firstOpen < 0 ? 0 : firstOpen);
  const [pick, setPick] = useState<number | null>(null);
  const q = RULES_QUIZ[i]; const right = RULES_QUIZ.filter((x) => prog[x.id]?.right).length;
  const choose = (k: number) => {
    if (pick !== null) return; setPick(k);
    const p = { ...prog, [q.id]: { right: prog[q.id]?.right || k === q.answer, tries: (prog[q.id]?.tries ?? 0) + 1 } }; setProg(p); saveRules(p);
  };
  const next = () => { setPick(null); const n = RULES_QUIZ.findIndex((x, j) => j > i && !prog[x.id]?.right); setI(n >= 0 ? n : (i + 1) % RULES_QUIZ.length); };
  return (
    <div className="rquiz">
      <div className="rq-prog"><span>Rules check-in</span><b>{right}/{RULES_QUIZ.length} mastered</b></div>
      <div className="rq-bar" aria-hidden><i style={{ width: `${(right / RULES_QUIZ.length) * 100}%` }} /></div>
      <div className="rq-dots">{RULES_QUIZ.map((x, j) => <button key={x.id} className={`rq-dot ${prog[x.id]?.right ? "ok" : prog[x.id] ? "miss" : ""} ${j === i ? "cur" : ""}`} aria-label={`Question ${j + 1}: ${x.topic}`} onClick={() => { setI(j); setPick(null); }}>{j + 1}</button>)}</div>
      <p className="rq-topic">{q.topic}</p>
      <p className="rq-q">{q.q}</p>
      <div className="rq-opts">{q.options.map((o, k) => <button key={k} className={`rq-opt ${pick !== null && k === q.answer ? "right" : ""} ${pick === k && k !== q.answer ? "wrong" : ""}`} disabled={pick !== null} onClick={() => choose(k)}>{o}</button>)}</div>
      {pick !== null && <div className={`rq-why ${pick === q.answer ? "ok" : "warn"}`}><b>{pick === q.answer ? "Correct." : "Not quite."}</b> {q.why}</div>}
      <div className="controls">{pick !== null && <button className="pill sm" onClick={next}>{right === RULES_QUIZ.length ? "Review another" : "Next question"}</button>}
        <button className="pill ghost sm" onClick={() => { setProg({}); saveRules({}); setI(0); setPick(null); }}>Reset progress</button></div>
    </div>
  );
}

