import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CountUp, useAnim } from "./motion";
import type { Answer, Prompt } from "./types";
import { fmtM, metres, rarerPicks, tier, TIER_LABEL } from "./data";

export const MAX_DEPTH = 7000;

export function RarityBar({ p, label = true }: { p: number; label?: boolean }) {
  return (
    <span className={`dd-rbar t-${tier(p)}`} role="img" aria-label={`Rarity ${p} of 100 points (${TIER_LABEL[tier(p)]})`} title={TIER_LABEL[tier(p)]}>
      <span className="trk"><i style={{ "--f": p / 100 } as CSSProperties} /></span>{label && <b>{p}</b>}
    </span>
  );
}

/** Countdown from `start` (epoch ms) over `totalMs`. Animations on: an SVG ring driven by ONE linear CSS animation over
 *  the whole duration (negative delay resumes mid-way). Off: a plain number + bar that steps once per second.
 *  Either way the seconds text is written straight to the DOM — the parent never re-renders while the clock runs. */
export function Countdown({ start, totalMs }: { start: number; totalMs: number }) {
  const anim = useAnim();
  const root = useRef<HTMLDivElement>(null), num = useRef<HTMLSpanElement>(null), bar = useRef<HTMLElement>(null);
  useEffect(() => {
    let t = 0;
    const tick = () => {
      const left = Math.max(0, totalMs - (Date.now() - start)), s = Math.ceil(left / 1000);
      if (num.current) num.current.textContent = String(s);
      root.current?.classList.toggle("low", s <= 5);
      root.current?.setAttribute("aria-label", `${s} seconds left`);
      if (bar.current) bar.current.style.transform = `scaleX(${s / (totalMs / 1000)})`;
      if (left > 0) t = window.setTimeout(tick, (left % 1000) || 1000); // wake exactly at each second boundary
    };
    tick();
    return () => clearTimeout(t);
  }, [start, totalMs, anim]);
  const r = 26, c = 2 * Math.PI * r;
  if (!anim) return (
    <div ref={root} className="dd-clock" role="timer">
      <span ref={num} className="dd-clock-n" /><span className="dd-clock-u">s</span>
      <span className="dd-clock-bar"><i ref={bar} /></span>
    </div>
  );
  return (
    <div ref={root} className="dd-ring" role="timer">
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
        <circle cx="32" cy="32" r={r} className="track" />
        <circle cx="32" cy="32" r={r} className="arc" strokeDasharray={c} transform="rotate(-90 32 32)"
          style={{ "--c": `${c}px`, animationDuration: `${totalMs}ms`, animationDelay: `${-(Date.now() - start)}ms` } as CSSProperties} />
      </svg>
      <span ref={num} />
    </div>
  );
}

/** Seconds-left text only (preview "Get ready… 3"). */
export function SecondsLeft({ start, totalMs }: { start: number; totalMs: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let t = 0;
    const tick = () => { const left = Math.max(0, totalMs - (Date.now() - start)); if (ref.current) ref.current.textContent = String(Math.max(1, Math.ceil(left / 1000))); if (left > 0) t = window.setTimeout(tick, (left % 1000) || 1000); };
    tick(); return () => clearTimeout(t);
  }, [start, totalMs]);
  return <span ref={ref} />;
}

/** Vertical depth gauge with a diver that sinks as points add up (1 point = 10 m). */
export function DepthMeter({ depth, compact }: { depth: number; compact?: boolean }) {
  const anim = useAnim();
  const f = anim ? Math.min(1, depth / MAX_DEPTH) : 0; // animations off: the diver stays put, only the number changes
  return (
    <div className={`dd-meter ${compact ? "compact" : ""}`} aria-label={`Depth ${fmtM(depth)} of ${fmtM(MAX_DEPTH)}`} role="img">
      <div className="dd-water" />
      {[0, 1000, 2000, 3000, 4000, 5000, 6000, 7000].map((m) => (
        <span key={m} className="dd-tick" style={{ top: `${(m / MAX_DEPTH) * 100}%` }}>{compact ? "" : m === 0 ? "0" : `${m / 1000}k`}</span>
      ))}
      {/* The rail spans the travel range; moving it by translate3d(0, f*100%) puts the diver at depth f. Compositor-only. */}
      <span className="dd-rail" style={{ transform: `translate3d(0, ${f * 100}%, 0)` }} aria-hidden>
        <span className="dd-diver"><span className="dd-bob"><span className="dd-bubbles"><i /><i /><i /></span><span className="dd-mask">🤿</span></span></span>
      </span>
      <b className="dd-depth-num"><CountUp value={depth} format={fmtM} /></b>
    </div>
  );
}

export function FlipCard({ a, rank, shown, onFlip, missed, mine }: { a: Answer; rank: number; shown: boolean; onFlip?: () => void; missed?: boolean; mine?: boolean }) {
  return (
    <button type="button" className={`dd-flip ${shown ? "on" : ""} ${missed ? "missed" : ""} ${mine ? "mine" : ""}`} onClick={onFlip} aria-pressed={shown}
      aria-label={shown ? `${a.t}, ${a.p} points` : `Hidden answer ${rank}, ${a.p} points. Tap to reveal`}>
      <span className="dd-flip-in">
        <span className="dd-face front"><span className="dd-rank">#{rank}</span><span className="dd-q">?</span><RarityBar p={a.p} /></span>
        <span className="dd-face back"><span className="dd-rank">#{rank}</span><span className="dd-ans">{a.t}</span><RarityBar p={a.p} />{a.tip && <span className="dd-tip">{a.tip}</span>}</span>
      </span>
    </button>
  );
}

/** Feedback after each answer, in the coach-card style: you vs up to three rarer answers. */
export function FeedbackCard({ prompt, mine, typed, ms, onNext, nextLabel = "Next prompt ›", extra }: {
  prompt: Prompt; mine: Answer | null; typed?: string; ms?: number; onNext?: () => void; nextLabel?: string; extra?: ReactNode;
}) {
  const picks = rarerPicks(prompt, mine);
  const rows = [...(mine ? [{ a: mine, me: true }] : []), ...picks.map((a) => ({ a, me: false }))].sort((x, y) => y.a.p - x.a.p);
  const max = prompt.answers.length ? Math.max(...prompt.answers.map((a) => a.p)) : 100;
  return (
    <div className="coach dd-feedback pop-in" role="region" aria-label="Answer feedback">
      <div className="coach-h"><b>🎓 {mine ? <>+<CountUp value={mine.p} from={0} /> pts · <CountUp value={metres(mine.p)} format={fmtM} from={0} /> deeper</> : "No answer in time"}</b>{ms != null && <span className="muted tiny">{(ms / 1000).toFixed(1)} s</span>}</div>
      <p className={`coach-gap ${mine && mine.p >= 70 ? "ok" : "warn"}`}>
        {mine ? (mine.p >= 85 ? `Superb — “${mine.t}” is one of the rarest answers.` : picks.length ? `“${mine.t}” works. Rarer answers that would have scored more:` : `“${mine.t}” is the rarest answer on the list!`)
          : `Nothing accepted${typed ? ` (last try: “${typed}”)` : ""}. Answers worth remembering:`}
      </p>
      {rows.map(({ a, me }) => (
        <div key={a.t} className={`coach-row ${me ? "mine" : ""}`}>
          <div className="coach-top">
            <span className="coach-name">{!me && a.p === max && <span className="star" title="Rarest answer">★</span>}{a.t}{me && <em> you</em>}</span>
            <span className="coach-ev">{a.p} pts</span>
            <span className="coach-bar"><i className={a.p >= 70 ? "good" : a.p >= 40 ? "mid" : "bad"} style={{ "--f": a.p / 100 } as CSSProperties} /></span>
            {a.tip && <span className="coach-why">💡 {a.tip}</span>}
          </div>
        </div>
      ))}
      <p className="muted tiny">{prompt.answers.length} accepted answers · rarity from Wikipedia popularity (10 = most common, 100 = rarest)</p>
      {extra}
      {onNext && <button className="pill dd-next" onClick={onNext} autoFocus>{nextLabel}</button>}
    </div>
  );
}

export type Tab = { id: string; label: string; body: ReactNode; badge?: number | null };
const wideQ = "(min-width: 960px)";
export function useWide() {
  const [w, setW] = useState(() => typeof matchMedia === "function" && matchMedia(wideQ).matches);
  useEffect(() => { const m = matchMedia(wideQ); const f = () => setW(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return w;
}
/** Side panel on desktop, collapsible bottom sheet on phones (same look as the card trainers). */
export function Panel({ tabs, active, onTab, attention }: { tabs: Tab[]; active: string; onTab: (id: string) => void; attention?: string | number | null }) {
  const wide = useWide();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (attention != null && attention !== "") setOpen(true); }, [attention]);
  useEffect(() => { if (wide) return; document.body.style.paddingBottom = open ? "46vh" : "72px"; return () => { document.body.style.paddingBottom = ""; }; }, [wide, open]);
  const cur = tabs.find((t) => t.id === active) ?? tabs[0];
  const expanded = wide || open;
  return (
    <aside className={`side-panel dd-panel ${wide ? "wide" : "sheet"} ${expanded ? "open" : "closed"}`} aria-label="Learn and feedback panel">
      <div className="sp-head">
        {!wide && <button className="sp-grab" aria-expanded={open} aria-label={open ? "Collapse panel" : "Expand panel"} onClick={() => setOpen(!open)}><i /></button>}
        <div className="sp-tabs" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={t.id === cur.id} className={`sp-tab ${t.id === cur.id ? "on" : ""}`} onClick={() => { onTab(t.id); if (!wide) setOpen(true); }}>
            {t.label}{t.badge ? <span className="sp-badge">{t.badge}</span> : null}</button>)}
        </div>
        {!wide && <button className="sp-toggle" onClick={() => setOpen(!open)} aria-label={open ? "Collapse panel" : "Expand panel"}>{open ? "▾" : "▴"}</button>}
      </div>
      {expanded && <div className="sp-body" role="tabpanel">{cur.body}</div>}
    </aside>
  );
}

const LEARN: { t: string; b: string }[] = [
  { t: "How a round works", b: "A prompt (a category like “A country in Africa”) shows for 3 seconds, then you get 25 seconds to type one answer. If it isn't recognised, keep trying while the clock runs." },
  { t: "Points & depth", b: "Every accepted answer scores 10–100: the rarer it is, the more it's worth. Seven prompts make a dive, so 700 is perfect. Each point takes you 10 m deeper — 7,000 m max." },
  { t: "Go one layer deeper", b: "Your first thought is everyone's first thought. Skip it and the next one; the third answer that comes to mind usually scores twice as much." },
  { t: "Safe vs. greedy", b: "A common answer is still 10+ points. If the clock is under 8 seconds, bank something rather than score zero." },
  { t: "Typos and short forms", b: "Case, accents, punctuation and a leading “The” are ignored, small typos are forgiven, and common short forms (USA, Man Utd, LBJ) work. If a short form fits two answers you'll be asked to be more specific." },
  { t: "Where rarity comes from", b: "Each answer's Wikipedia article popularity: the less-visited the page, the fewer people think of it, the more points. Hand-ordered lists (like reindeer) use editor judgment." },
  { t: "Review queue", b: "Prompts you miss or answer slowly come back after 1, then 3, then 7 days. Clear them from “Review due” on the Deep Dive home." },
];
export function LearnCards() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="lc-grid dd-lc">
      {LEARN.map((c, i) => (
        <button key={c.t} type="button" className={`lc ${open === i ? "open" : ""}`} onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
          <span className="lc-t">{c.t}</span>{open === i && <span className="lc-b">{c.b}</span>}
        </button>
      ))}
    </div>
  );
}

const STEPS: { icon: string; t: string; b: string }[] = [
  { icon: "🤿", t: "Welcome to Deep Dive", b: "A solo trainer for rare-answer trivia games. The goal isn't any right answer — it's the right answer almost nobody else gives." },
  { icon: "⏱️", t: "3 seconds to read, 25 to answer", b: "Each prompt previews for 3 s, then the ring counts down 25 s. Type one answer and press Enter. Not recognised? Try again while time remains." },
  { icon: "💎", t: "Rarer = deeper", b: "Accepted answers score 10–100 points by rarity. Seven prompts per dive, max 700 points. 1 point = 10 m, so a perfect dive reaches 7,000 m." },
  { icon: "📚", t: "Study, drill, dive", b: "Study the full lists (common → rare), drill a single list, then take the Daily Dive or go Endless. Misses come back in your Review queue after 1, 3 and 7 days." },
];
export function Walkthrough({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="dd-modal" role="dialog" aria-modal="true" aria-label="How Deep Dive works">
      <div className="dd-modal-card pop-in" key={i}>
        <div className="dd-step-icon" aria-hidden>{s.icon}</div>
        <h2>{s.t}</h2>
        <p>{s.b}</p>
        <div className="dd-dots" aria-hidden>{STEPS.map((_, j) => <i key={j} className={j === i ? "on" : ""} />)}</div>
        <div className="dd-row">
          <button className="pill ghost" onClick={onClose}>Skip</button>
          {i < STEPS.length - 1 ? <button className="pill" onClick={() => setI(i + 1)} autoFocus>Next ›</button> : <button className="pill" onClick={onClose} autoFocus>Start diving</button>}
        </div>
        <p className="muted tiny">Step {i + 1} of {STEPS.length}</p>
      </div>
    </div>
  );
}
