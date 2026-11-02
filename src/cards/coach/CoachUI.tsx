// Coach UI shared by the four card games: level picker, Guided hint, "catch mistakes" prompt, after-move note,
// hand review sheet, and the mistake-drills link. Only the local player's own decisions are ever recorded or shown.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RANK_LABEL, SUIT_SYMBOL, isRed, type Card } from "../core.ts";
import { LEVELS, coachGate, getCoachLevel, levelLabel, onCoachLevel, setCoachLevel, type CoachGame, type CoachLevel, type TableMode } from "./level.ts";
import { dueCount, gradeHand, handDecisions, onCoachStore, recentHands, recordDecision, type Decision, type Spot } from "./record.ts";
import { createPortal } from "react-dom";
import "./coach.css";
/** Floating layers go to <body> so a transformed (animated) ancestor can't trap position: fixed. */
const toBody = (n: ReactNode) => (typeof document === "undefined" ? n : createPortal(n, document.body));

export const GAME_NAME: Record<CoachGame, string> = { blackjack: "Blackjack", spades: "Spades", hearts: "Hearts", holdem: "Texas Hold'em" };
export const tableMode = (o: { tutorial: boolean; live: boolean; train: boolean }): TableMode => (o.tutorial ? "tutorial" : o.live ? "live" : o.train ? "train" : "solo");

// ---------- hooks ----------
export function useCoachLevel(g: CoachGame): [CoachLevel, (l: CoachLevel) => void] {
  const [l, setL] = useState(() => getCoachLevel(g));
  useEffect(() => onCoachLevel(() => setL(getCoachLevel(g))), [g]);
  return [l, (x) => setCoachLevel(g, x)];
}
/** Re-renders when decisions or drills change. */
export function useCoachStore() { const [n, setN] = useState(0); useEffect(() => onCoachStore(() => setN((x) => x + 1)), []); return n; }
export function useDueCount(g: CoachGame) { useCoachStore(); const [, tick] = useState(0); useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60_000); return () => clearInterval(t); }, []); return dueCount(g); }
/** A stable id for "hand N at this table". A rematch restarts hand numbers, so count rematches per table on this device. */
export function useHandId(room: string, handNo: number | undefined) {
  const k = `coach_epoch_${room}`;
  const read = () => { try { return JSON.parse(localStorage.getItem(k) || "null") as { e: number; last: number } | null; } catch { return null; } };
  const st = read() ?? { e: 0, last: 0 };
  if (handNo != null && handNo > 0 && handNo !== st.last) {
    if (handNo < st.last) st.e++;
    st.last = handNo; try { localStorage.setItem(k, JSON.stringify(st)); } catch { /* ignore */ }
  }
  return (n: number) => `${room}:${st.e}:${n}`;
}

export type Hint = { key: string; label: string; why: string };
type FlowOpts<E, M> = {
  game: CoachGame; mode: TableMode; level: CoachLevel;
  /** identifies the local player's current decision; null when it isn't their turn */ dkey: string | null;
  /** the coach's simulation for this decision (heavy; runs off the click path) */ analyze: (m?: M) => E | null;
  /** does this analysis already include move m? (e.g. an unusual bet size or pass) */ covers?: (e: E, m: M) => boolean;
  decide: (e: E, m: M, caught?: M) => Decision;
  hint: (e: E) => Hint;
  send: (m: M) => void;
};
/** One decision flow for every game:
 *  Guided → hint before the move.  Catch (solo/train/tutorial) → check the move first; on a mistake offer "try again".
 *  Catch (live) → send at once, speak up afterwards.  Every level records the decision for the hand review and drills. */
export function useDecisionFlow<E, M>(o: FlowOpts<E, M>): Flow & { choose: (m: M) => void } {
  const gate = coachGate(o.level, o.mode);
  const ref = useRef(o); ref.current = o;
  const [pre, setPre] = useState<{ k: string; e: E | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const [prompt, setPrompt] = useState<{ d: Decision; m: M; k: string; caught?: M; reveal: boolean; send: (m: M) => void } | null>(null);
  const [note, setNote] = useState<Decision | null>(null);
  const caught = useRef<{ k: string; m: M } | null>(null);
  const wantPre = gate.hintBefore || gate.checkBeforeSend;
  useEffect(() => {
    setPrompt(null); setChecking(false);
    if (!o.dkey || !wantPre) return;
    const k = o.dkey; const an = ref.current.analyze;
    const t = setTimeout(() => { let e: E | null = null; try { e = an(); } catch (err) { console.warn(err); } setPre({ k, e }); }, 60);
    return () => clearTimeout(t);
  }, [o.dkey, wantPre]);
  useEffect(() => { if (o.dkey) setNote(null); }, [o.dkey]);
  const ready = pre && pre.k === o.dkey ? pre.e : null;
  const choose = (m: M) => {
    if (checking || prompt) return;
    const k = o.dkey ?? "", snap = ref.current, pe = pre && pre.k === k ? pre.e : null;
    const first = caught.current?.k === k ? caught.current.m : undefined;
    const build = (): Decision | null => { try { const e = pe && (!snap.covers || snap.covers(pe, m)) ? pe : snap.analyze(m); return e ? snap.decide(e, m, first) : null; } catch (err) { console.warn(err); return null; } };
    if (gate.checkBeforeSend) {
      setChecking(true);
      setTimeout(() => {
        const d = build(); setChecking(false);
        if (d && d.verdict === "mistake") { setPrompt({ d, m, k, caught: first, reveal: false, send: snap.send }); return; }
        snap.send(m); caught.current = null; if (d) recordDecision(d);
      }, pe ? 0 : 40);
      return;
    }
    snap.send(m); caught.current = null;
    setTimeout(() => { const d = build(); if (!d) return; recordDecision(d); if (gate.speakAfter && d.verdict === "mistake") setNote(d); }, 40);
  };
  const out: Flow & { choose: (m: M) => void } = {
    gate, checking, note, prompt: prompt ? { d: prompt.d, reveal: prompt.reveal } : null,
    hint: gate.hintBefore && ready ? (() => { try { return ref.current.hint(ready); } catch { return null; } })() : null,
    thinking: gate.hintBefore && !!o.dkey && !ready,
    choose,
    keep: () => { if (!prompt) return; prompt.send(prompt.m); recordDecision(prompt.d); caught.current = null; setPrompt(null); },
    retry: () => { if (!prompt) return; caught.current = { k: prompt.k, m: prompt.m }; setPrompt(null); },
    reveal: () => { if (prompt) setPrompt({ ...prompt, reveal: true }); },
    dismissNote: () => setNote(null),
  };
  return out;
}
export type Flow = {
  gate: ReturnType<typeof coachGate>; checking: boolean; note: Decision | null; prompt: { d: Decision; reveal: boolean } | null;
  hint: Hint | null; thinking: boolean; choose: (m: never) => void; keep: () => void; retry: () => void; reveal: () => void; dismissNote: () => void;
};

// ---------- small pieces ----------
const CARD_RE = /^[2-9TJQKA][SHDC]$/;
export function Mini({ c }: { c: Card }) { return <span className={`cr-mini ${isRed(c) ? "red" : ""}`}>{RANK_LABEL(c[0])}{SUIT_SYMBOL[c[1]]}</span>; }
/** Option label: card keys ("KH", "2C,5D,QS") render as small cards, anything else as text. */
export function OptLabel({ k, label }: { k: string; label: string }) {
  const parts = k.split(",");
  if (parts.every((x) => CARD_RE.test(x))) return <span className="cr-minis">{parts.map((c) => <Mini key={c} c={c} />)}</span>;
  return <>{label}</>;
}
export function SpotCards({ spot }: { spot: Spot }) {
  return <div className="cr-groups">{spot.groups.map((g) => <div key={g.label} className="cr-group"><span className="muted tiny">{g.label}</span><span className="cr-minis">{g.cards.map((c) => <Mini key={c} c={c} />)}</span></div>)}</div>;
}

export function CoachLevelPicker({ game, mode, inline }: { game: CoachGame; mode?: TableMode; inline?: boolean }) {
  const [level, set] = useCoachLevel(game); const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const f = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", f); return () => document.removeEventListener("pointerdown", f); }, [open]);
  const choices = (
    <div className="cr-levels" role="radiogroup" aria-label="Coach level">
      {LEVELS.map((l) => (
        <button key={l.id} role="radio" aria-checked={level === l.id} className={`cr-level ${level === l.id ? "on" : ""}`} onClick={() => { set(l.id); setOpen(false); }}>
          <b>{l.label}</b><small>{l.id === "catch" && mode === "live" ? "Quiet until you pick something the coach wouldn't — then it tells you why. (No take-backs at a table with other people.)" : l.blurb}</small>
        </button>))}
    </div>);
  if (inline) return choices;
  return (
    <div className="cr-picker" ref={box}>
      <button className="cr-pill" aria-expanded={open} onClick={() => setOpen(!open)}>🎓 Coach: <b>{levelLabel(level)}</b> <span aria-hidden>▾</span></button>
      {open && <div className="cr-pop pop-in"><p className="tiny muted">How much should the coach help? Saved on this device for {GAME_NAME[game]}.</p>{choices}</div>}
    </div>);
}

export function GuidedHint({ flow, what = "move" }: { flow: Flow; what?: string }) {
  if (!flow.gate.hintBefore) return null;
  if (flow.thinking) return <div className="cr-hint thinking" aria-live="polite">💡 Coach is thinking…</div>;
  if (!flow.hint) return null;
  return <div className="cr-hint pop-in" aria-live="polite"><span>💡 Coach suggests: <b><OptLabel k={flow.hint.key} label={flow.hint.label} /></b></span><span className="cr-why">{flow.hint.why}</span><span className="tiny muted">It's your {what} — you can pick anything.</span></div>;
}
export function Checking({ flow }: { flow: Flow }) { return flow.checking ? <div className="cr-hint thinking" aria-live="polite">🎓 Checking your move…</div> : null; }
export function CatchPrompt({ flow }: { flow: Flow }) {
  const p = flow.prompt; if (!p) return null;
  return toBody(
    <div className="cr-catch cr-float pop-in" role="dialog" aria-label="The coach caught a mistake">
      <p><b>Hold on — the coach would play this differently.</b></p>
      <p className="small">You picked <b><OptLabel k={p.d.chosen.key} label={p.d.chosen.label} /></b>. Want another go?</p>
      {p.reveal && <p className="small cr-why">Coach's pick: <b><OptLabel k={p.d.best.key} label={p.d.best.label} /></b>. {p.d.why}</p>}
      <div className="cr-btns">
        <button className="pill" onClick={flow.retry}>Try again</button>
        {!p.reveal && <button className="pill ghost" onClick={flow.reveal}>What would the coach do?</button>}
        <button className="pill ghost" onClick={flow.keep}>Keep my move</button>
      </div>
    </div>);
}
export function AfterNote({ flow }: { flow: Flow }) {
  const d = flow.note; if (!d) return null;
  return toBody(
    <div className="cr-note cr-float pop-in" role="status">
      <button className="cr-x" aria-label="Close" onClick={flow.dismissNote}>×</button>
      <p className="small"><b>Coach:</b> <OptLabel k={d.best.key} label={d.best.label} /> was the better move here. {d.why}</p>
      <p className="tiny muted">Saved to your mistake drills.</p>
    </div>);
}

// ---------- hand review ----------
const MARK: Record<Decision["verdict"], string> = { best: "✓", close: "≈", mistake: "✗" };
const VERB: Record<Decision["verdict"], string> = { best: "Matches the coach", close: "Close enough", mistake: "Mistake" };
export function HandReview({ game, hand, onClose, onHand }: { game: CoachGame; hand: string; onClose: () => void; onHand?: (h: string) => void }) {
  useCoachStore();
  const ds = handDecisions(game, hand); const g = gradeHand(ds);
  const firstMiss = Math.max(0, ds.findIndex((d) => d.verdict === "mistake"));
  const [i, setI] = useState(firstMiss);
  useEffect(() => setI(Math.max(0, handDecisions(game, hand).findIndex((d) => d.verdict === "mistake"))), [hand]);
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") setI((x) => Math.min(ds.length - 1, x + 1)); if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1)); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [ds.length]);
  const hands = recentHands(game); const hi = hands.findIndex((h) => h.hand === hand);
  const d = ds[Math.min(i, ds.length - 1)];
  const added = ds.filter((x) => x.verdict === "mistake" || x.caught).length;
  return toBody(
    <div className="cr-back" onClick={onClose}>
      <div className="cr-sheet pop-in" role="dialog" aria-label="Hand review" onClick={(e) => e.stopPropagation()}>
        <div className="cr-sheet-h">
          <div className={`cr-grade g${g.letter}`} aria-label={`Grade ${g.letter}`}>{g.letter}</div>
          <div className="cr-grow"><b>{ds[0]?.handLabel ?? "Hand review"}</b><div className="small">{g.headline}</div><div className="tiny muted">{g.detail}</div></div>
          <button className="cr-x" aria-label="Close review" onClick={onClose}>×</button>
        </div>
        {!ds.length ? <p className="small muted">No decisions were recorded for this hand.</p> : (<>
          <div className="cr-dots" role="tablist" aria-label="Decisions">{ds.map((x, k) => <button key={x.id} role="tab" aria-selected={k === i} className={`cr-dot ${x.verdict} ${k === i ? "on" : ""}`} onClick={() => setI(k)} title={x.step}>{MARK[x.verdict]}</button>)}</div>
          {d && (
            <div className={`cr-step ${d.verdict}`} key={d.id}>
              <div className="tiny muted">{d.step} · decision {i + 1} of {ds.length}</div>
              <p className="small">{d.situation}</p>
              <SpotCards spot={d.spot} />
              <div className="cr-vs">
                <div><span className="tiny muted">You</span><b><OptLabel k={d.chosen.key} label={d.chosen.label} /></b></div>
                <div><span className="tiny muted">Coach</span><b><OptLabel k={d.best.key} label={d.best.label} /></b></div>
                <div className={`cr-verdict ${d.verdict}`}>{MARK[d.verdict]} {VERB[d.verdict]}</div>
              </div>
              {d.caught && <p className="tiny">You first picked <OptLabel k={d.caught.key} label={d.caught.label} />; the coach caught it and you tried again.</p>}
              <p className="small cr-why">{d.why}</p>
              {d.cost && <p className="tiny muted">{d.cost}</p>}
            </div>)}
          <div className="cr-nav">
            <button className="pill ghost" disabled={i <= 0} onClick={() => setI(i - 1)}>‹ Prev</button>
            <span className="tiny muted">{i + 1} / {ds.length}</span>
            <button className="pill ghost" disabled={i >= ds.length - 1} onClick={() => setI(i + 1)}>Next ›</button>
          </div></>)}
        <div className="cr-foot">
          {onHand && hi >= 0 && <span className="cr-hands">
            <button className="linkish" disabled={hi >= hands.length - 1} onClick={() => onHand(hands[hi + 1].hand)}>‹ Earlier hand</button>
            <button className="linkish" disabled={hi <= 0} onClick={() => onHand(hands[hi - 1].hand)}>Later hand ›</button></span>}
          {added > 0 && <a className="linkish" href={`#/drills?game=${game}`}>🎯 {added} spot{added > 1 ? "s" : ""} saved to Mistake drills</a>}
        </div>
      </div>
    </div>);
}
/** "Review hand" button for the hand that just finished; hidden until a decision from that hand has been recorded. */
export function ReviewButton({ game, hand, children, onOpen }: { game: CoachGame; hand: string | null; children?: ReactNode; onOpen?: (open: boolean) => void }) {
  useCoachStore();
  const [open, setOpen] = useState<string | null>(null);
  const set = (h: string | null) => { setOpen(h); onOpen?.(!!h); };
  if (!hand) return null;
  const ds = handDecisions(game, hand); if (!ds.length && !open) return null;
  const g = gradeHand(ds);
  return (<>
    <button className={`cr-review pop-in g${g.letter}`} onClick={() => set(hand)}>🔍 {children ?? "Review hand"} <span className="cr-chip">{g.mistakes ? `${g.mistakes} to work on` : "✓ clean"}</span></button>
    {open && <HandReview game={game} hand={open} onClose={() => set(null)} onHand={set} />}
  </>);
}
export function DrillsLink({ game, small }: { game: CoachGame; small?: boolean }) {
  const n = useDueCount(game);
  return <a className={`cr-drills ${small ? "small" : ""}`} href={`#/drills?game=${game}`}>🎯 Mistake drills{n ? <span className="cr-badge" aria-label={`${n} due`}>{n}</span> : null}</a>;
}
/** Level picker + drills link, for the table footer. */
export function CoachBar({ game, mode }: { game: CoachGame; mode: TableMode }) {
  return <div className="cr-bar"><CoachLevelPicker game={game} mode={mode} /><DrillsLink game={game} small /></div>;
}
