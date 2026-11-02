// Mistake drills: one-decision quizzes built from spots you got wrong, with simple spaced repetition.
import { useMemo, useState } from "react";
import { go } from "../../lib/router";
import { seededRng } from "../core.ts";
import { activeDrills, answerDrill, dueDrills, loadDrills, requeue, saveDrills, sessionQueue, classify, RETIRE_AFTER, type Drill, type Spot } from "./record.ts";
import type { CoachGame } from "./level.ts";
import { GAME_NAME, OptLabel, SpotCards, useCoachStore, CoachLevelPicker } from "./CoachUI.tsx";
import { bjVariant, bjRows, BJ_LABEL } from "../blackjack/review.ts";
import type { Action } from "../blackjack/strategy.ts";
import type { Card } from "../core.ts";
import "../cards.css";

const GAMES: CoachGame[] = ["blackjack", "spades", "hearts", "holdem"];
const isGame = (g: string | null): g is CoachGame => !!g && (GAMES as string[]).includes(g);
const ICON: Record<CoachGame, string> = { blackjack: "🂡", spades: "♠️", hearts: "♥️", holdem: "🃏" };
const HOW: Record<CoachGame, string> = {
  blackjack: "a hit, stand, double, split or insurance call",
  spades: "a bid or a card",
  hearts: "a pass or a card",
  holdem: "a fold, call, check or bet",
};

/** Blackjack spots can come back as a close cousin (same total, different cards); the answer is re-checked with the simulator. */
function variantOf(d: Drill): Spot {
  if (d.game !== "blackjack" || Math.random() < 0.5) return d.spot;
  const v = bjVariant(d.spot, seededRng((Date.now() ^ 0x9e3779b9) >>> 0));
  if (v === d.spot) return v;
  try {
    const st = v.state as { cards: Card[]; up: Card; legal: Action[] };
    const rows = bjRows({ cards: st.cards, dealerUp: st.up, seen: [...st.cards, st.up], legal: st.legal }, 6000);
    const c = classify(rows.map((r) => ({ key: r.action, label: BJ_LABEL[r.action], ev: r.ev, se: r.se })), rows[0].action, 0.02);
    return c.best.key === d.spot.best ? { ...v, ok: c.ok.includes(d.spot.best) ? c.ok : [d.spot.best] } : d.spot;
  } catch { return d.spot; }
}

export default function DrillsPage({ params }: { params: URLSearchParams }) {
  const g0 = params.get("game");
  const [game, setGame] = useState<CoachGame>(isGame(g0) ? g0 : "blackjack");
  useCoachStore();
  const all = loadDrills(game); const now = Date.now();
  const due = dueDrills(all, now).length, active = activeDrills(all).length, retired = all.filter((x) => x.retired).length;
  const [queue, setQueue] = useState<string[] | null>(null);
  const [done, setDone] = useState({ right: 0, wrong: 0, retiredNow: 0 });
  const [pick, setPick] = useState<string | null>(null);
  const cur = queue?.length ? all.find((x) => x.id === queue[0]) ?? null : null;
  const spot = useMemo(() => (cur ? variantOf(cur) : null), [cur?.id, queue?.length, done.right + done.wrong]);
  const start = (anyway = false) => { setQueue(sessionQueue(loadDrills(game), Date.now(), 10, anyway)); setDone({ right: 0, wrong: 0, retiredNow: 0 }); setPick(null); };
  const answer = (k: string) => {
    if (!cur || !spot || pick) return; setPick(k);
    const ok = spot.ok.includes(k); const upd = answerDrill(cur, ok, Date.now());
    saveDrills(game, loadDrills(game).map((x) => (x.id === cur.id ? upd : x)));
    setDone((d) => ({ right: d.right + (ok ? 1 : 0), wrong: d.wrong + (ok ? 0 : 1), retiredNow: d.retiredNow + (upd.retired ? 1 : 0) }));
  };
  const next = () => { if (!queue || !cur || !spot) return; const ok = pick != null && spot.ok.includes(pick); setQueue(ok ? queue.slice(1) : requeue(queue, cur.id)); setPick(null); };
  const switchGame = (g: CoachGame) => { setGame(g); setQueue(null); setPick(null); history.replaceState(null, "", `#/drills?game=${g}`); };
  const total = done.right + done.wrong;
  return (
    <div className="page drills">
      <header className="game-header"><button className="back" onClick={() => go(`/play/${game}`)}>‹ {GAME_NAME[game]}</button><h1>Mistake drills</h1><div className="room-bar" /></header>
      <div className="dr-games" role="tablist">{GAMES.map((g) => { const n = dueDrills(loadDrills(g), now).length; return <button key={g} role="tab" aria-selected={g === game} className={g === game ? "on" : ""} onClick={() => switchGame(g)}>{ICON[g]} {GAME_NAME[g]}{n ? <span className="cr-badge">{n}</span> : null}</button>; })}</div>
      {!queue && (all.length === 0 ? (
        <div className="dr-empty">
          <p><b>No {GAME_NAME[game]} spots yet.</b></p>
          <p className="small">This is where the coach saves the decisions you got wrong, so you can practise them until they stick:</p>
          <ol className="small">
            <li>Play {GAME_NAME[game]} (solo, Train, or with friends). Every time you make {HOW[game]}, the coach quietly checks it.</li>
            <li>If the coach would have done something different, that spot is saved here.</li>
            <li>Come back and answer it again. Get it right {RETIRE_AFTER} times in a row and it's retired; miss it and it comes back sooner.</li>
          </ol>
          <button className="pill" onClick={() => go(`/play/${game}`)}>Play {GAME_NAME[game]}</button>
        </div>) : (
        <div className="dr-card">
          <p><b>{due ? `${due} spot${due > 1 ? "s" : ""} ready to practise` : "All caught up!"}</b></p>
          <p className="small muted">{active} spot{active === 1 ? "" : "s"} in rotation · {retired} retired. Each one is a {GAME_NAME[game]} decision where you and the coach disagreed. Right {RETIRE_AFTER}× in a row retires it; a miss brings it back sooner.</p>
          <div className="cr-btns">
            {due > 0 && <button className="pill" onClick={() => start(false)}>Start drills ({Math.min(10, due)})</button>}
            {!due && active > 0 && <button className="pill" onClick={() => start(true)}>Practise anyway ({Math.min(10, active)})</button>}
            {!due && !active && <button className="pill" onClick={() => go(`/play/${game}`)}>Play {GAME_NAME[game]}</button>}
          </div>
        </div>))}
      {queue && !cur && (
        <div className="dr-card pop-in">
          <p><b>Session done — {done.right} of {total} right.</b></p>
          {done.retiredNow > 0 && <p className="small">🎉 {done.retiredNow} spot{done.retiredNow > 1 ? "s" : ""} retired — you've got {done.retiredNow > 1 ? "them" : "it"} down.</p>}
          <p className="small muted">Spots you got right come back in a few hours to make sure they stuck.</p>
          <div className="cr-btns"><button className="pill" onClick={() => setQueue(null)}>Back to drills</button><button className="pill ghost" onClick={() => go(`/play/${game}`)}>Play {GAME_NAME[game]}</button></div>
        </div>)}
      {queue && cur && spot && (
        <div className="dr-card pop-in" key={`${cur.id}-${total}`}>
          <div className="dr-progress" aria-hidden><i style={{ transform: `scaleX(${Math.min(1, total / Math.max(1, total + queue.length))})` }} /></div>
          <p className="tiny muted">{cur.lapses ? `Missed ${cur.lapses + 1}× so far` : "From one of your hands"} · {cur.streak}/{RETIRE_AFTER} in a row</p>
          <p><b>{spot.prompt}</b></p>
          <SpotCards spot={spot} />
          {spot.facts.map((f) => <p key={f} className="small muted">{f}</p>)}
          <div className="dr-opts">{spot.options.map((o) => {
            const cls = pick ? (spot.ok.includes(o.key) ? "right" : o.key === pick ? "wrong" : "") : "";
            return <button key={o.key} className={`dr-opt ${cls}`} disabled={!!pick} onClick={() => answer(o.key)}><OptLabel k={o.key} label={o.label} /></button>;
          })}</div>
          {pick && (
            <div className={`dr-res ${spot.ok.includes(pick) ? "right" : "wrong"} pop-in`}>
              <p><b>{spot.ok.includes(pick) ? (pick === spot.best ? "✓ Right!" : "✓ Good — that's as good as the coach's pick.") : "✗ Not quite."}</b> {!spot.ok.includes(pick) || pick !== spot.best ? <>Coach's pick: <b><OptLabel k={spot.best} label={spot.options.find((o) => o.key === spot.best)?.label ?? spot.best} /></b>.</> : null}</p>
              <p className="small">{spot.why}</p>
              {!spot.ok.includes(pick) && <p className="tiny muted">This one will come back again shortly.</p>}
              <div className="cr-btns"><button className="pill" onClick={next}>{queue.length > 1 || !spot.ok.includes(pick) ? "Next" : "Finish"}</button></div>
            </div>)}
        </div>)}
      <h2 className="section">Coach level for {GAME_NAME[game]}</h2>
      <CoachLevelPicker game={game} inline />
    </div>);
}
