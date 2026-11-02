// Deep Dive: a solo self-test trainer for rare-answer trivia games.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { go } from "../../lib/router";
import { ensurePlayer } from "../../lib/player";
import { bumpStreak, confetti, soundOn, setSound } from "../../lib/fx";
import { beep, warmAudio } from "./sfx";
import "../../cards/cards.css";
import "../../cards/table.css";
import "./deepdive.css";
import type { Answer, Bank, CatId, Prompt } from "./types";
import { matchAnswer } from "./match";
import { CAT_COLOR, CAT_ICON, chicagoDate, dailySet, fmtM, loadBank, metres, pickSet, rarerPicks } from "./data";
import { dailyDone, dueItems, load, logAttempt, logDive, queuedItems, srsMiss, srsPass, streaks, type Attempt } from "./store";
import { Countdown, DepthMeter, FeedbackCard, FlipCard, LearnCards, MAX_DEPTH, Panel, RarityBar, SecondsLeft, Walkthrough } from "./ui";
import { animOn, CountUp, setAnim, useAnim } from "./motion";

const PREVIEW_MS = 3000, ANSWER_MS = 25000, SLOW_MS = 15000;
type View = "home" | "study" | "drill" | "dive" | "progress";
const INTRO_KEY = "dd_intro_v1";

export default function DeepDivePage({ params }: { params: URLSearchParams }) {
  const [bank, setBank] = useState<Bank | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [intro, setIntro] = useState(() => localStorage.getItem(INTRO_KEY) !== "1");
  const [snd, setSnd] = useState(soundOn());
  const anim = useAnim();
  useEffect(() => { ensurePlayer(); loadBank().then(setBank, (e) => setErr(String(e))); }, []);
  const closeIntro = useCallback(() => { localStorage.setItem(INTRO_KEY, "1"); setIntro(false); }, []);
  const view = (params.get("v") || "home") as View;
  return (
    <div className={`dd dd-v-${view} ${anim ? "dd-anim" : "dd-still"}`} onPointerDownCapture={warmAudio} onKeyDownCapture={warmAudio}>
      <header className="game-header dd-header">
        <button className="back" onClick={() => go(view === "home" ? "/" : "/deepdive")} aria-label={view === "home" ? "Back to lobby" : "Back to Deep Dive home"}>‹ {view === "home" ? "Lobby" : "Deep Dive"}</button>
        <h1>🤿 Deep Dive</h1>
        <button className="icon-btn" title="Sound" aria-label={snd ? "Mute sound" : "Unmute sound"} onClick={() => { setSound(!snd); setSnd(!snd); }}>{snd ? "🔊" : "🔇"}</button>
        <button className="pill ghost sm dd-anim-btn" aria-pressed={anim} onClick={() => setAnim(!anim)} title="Turn animations on or off"
          aria-label={`Animations ${anim ? "on" : "off"}`}><span aria-hidden>{anim ? "✨" : "⏸"}</span> <span className="long">Animations </span>{anim ? "On" : "Off"}</button>
        <button className="pill ghost sm dd-hiw" onClick={() => setIntro(true)} aria-label="How it works"><span className="long">How it works</span><span className="short" aria-hidden>?</span></button>
      </header>
      {err && <p className="dd-err">Couldn't load the question bank. Check your connection and reload.</p>}
      {!bank && !err && <p className="muted dd-loading">Loading the question bank…</p>}
      {bank && view === "home" && <Home bank={bank} />}
      {bank && view === "study" && <Study bank={bank} params={params} />}
      {bank && view === "drill" && <Drills bank={bank} params={params} />}
      {bank && view === "dive" && <Dive key={params.toString()} bank={bank} kind={(params.get("k") as DiveKind) || "daily"} />}
      {bank && view === "progress" && <Progress bank={bank} />}
      {intro && <Walkthrough onClose={closeIntro} />}
    </div>
  );
}

/* ---------------- home ---------------- */
function Home({ bank }: { bank: Bank }) {
  const due = dueItems().length;
  const done = dailyDone(chicagoDate());
  const s = load(); const st = streaks(s);
  const best = s.dives.reduce((m, d) => Math.max(m, d.depth), 0);
  return (
    <div className="dd-home">
      <section className="dd-hero">
        <div className="dd-hero-txt">
          <h2>Name the answer nobody else thinks of.</h2>
          <p>Practice for rare-answer trivia games: seven prompts, 25 seconds each, and the rarer your answer, the deeper you dive.</p>
          <p className="dd-stats-line"><span>🔥 {st.current}-day streak</span><span>🏆 Best {fmtM(best)}</span><span>📚 {bank.prompts.length} lists</span></p>
        </div>
        <DepthMeter depth={done?.depth ?? best} compact />
      </section>
      {due > 0 && <button className="dd-review-due pop-in" onClick={() => go("/deepdive?v=dive&k=review")}><b>🔁 Review due</b><span>{due} prompt{due > 1 ? "s" : ""} to revisit today</span><span className="go">Start ›</span></button>}
      <div className="dd-grid">
        <button className="dd-tile daily" onClick={() => go("/deepdive?v=dive&k=daily")}>
          <span className="ic">🌊</span><b>Daily Dive</b><span>{done ? `Done today: ${fmtM(done.depth)} · play again` : "Today's 7 prompts — same for everyone"}</span></button>
        <button className="dd-tile" onClick={() => go("/deepdive?v=dive&k=endless")}><span className="ic">♾️</span><b>Endless</b><span>Random prompts until you miss 3</span></button>
        <button className="dd-tile" onClick={() => go("/deepdive?v=study")}><span className="ic">📖</span><b>Study</b><span>Every list, common → rare, with tips</span></button>
        <button className="dd-tile" onClick={() => go("/deepdive?v=drill")}><span className="ic">🎯</span><b>Drills</b><span>Name them all · hunt a rare one</span></button>
        <button className="dd-tile" onClick={() => go("/deepdive?v=progress")}><span className="ic">📈</span><b>Progress</b><span>Strong & weak categories, depth trend</span></button>
        <button className="dd-tile" onClick={() => go("/deepdive?v=dive&k=review")} disabled={queuedItems().length === 0}><span className="ic">🔁</span><b>Review queue</b><span>{queuedItems().length ? `${queuedItems().length} queued · ${due} due` : "Misses land here (1 · 3 · 7 days)"}</span></button>
      </div>
      <div className="dd-cats">{bank.categories.map((c) => <span key={c.id} className="dd-chip" style={{ borderColor: CAT_COLOR[c.id] }}>{CAT_ICON[c.id]} {c.name} · {bank.prompts.filter((p) => p.cat === c.id).length}</span>)}</div>
    </div>
  );
}

/* ---------------- study ---------------- */
function Study({ bank, params }: { bank: Bank; params: URLSearchParams }) {
  const [cat, setCat] = useState<CatId | "all">((params.get("c") as CatId) || "all");
  const pid = params.get("p");
  const prompt = pid ? bank.prompts.find((p) => p.id === pid) : null;
  if (prompt) return <StudyList prompt={prompt} bank={bank} />;
  const list = bank.prompts.filter((p) => cat === "all" || p.cat === cat);
  return (
    <div className="dd-page">
      <h2 className="dd-h2">📖 Study the lists</h2>
      <CatChips bank={bank} cat={cat} setCat={setCat} />
      <div className="dd-plist">
        {list.map((p) => (
          <button key={p.id} className="dd-pcard" style={{ borderLeftColor: CAT_COLOR[p.cat] }} onClick={() => go(`/deepdive?v=study&p=${p.id}`)}>
            <span className="ic" aria-hidden>{CAT_ICON[p.cat]}</span><b>{p.q}</b><span className="muted small">{p.answers.length} answers</span>
          </button>
        ))}
      </div>
    </div>
  );
}
function CatChips({ bank, cat, setCat }: { bank: Bank; cat: CatId | "all"; setCat: (c: CatId | "all") => void }) {
  return (
    <div className="dd-chips" role="tablist">
      <button role="tab" aria-selected={cat === "all"} className={`sp-tab ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>All</button>
      {bank.categories.map((c) => <button key={c.id} role="tab" aria-selected={cat === c.id} className={`sp-tab ${cat === c.id ? "on" : ""}`} onClick={() => setCat(c.id)}>{CAT_ICON[c.id]} {c.name}</button>)}
    </div>
  );
}
function StudyList({ prompt, bank }: { prompt: Prompt; bank: Bank }) {
  const [quiz, setQuiz] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [guess, setGuess] = useState("");
  const [msg, setMsg] = useState("");
  const answers = prompt.answers; // already common → rare
  const reveal = (t: string) => setShown((s) => new Set(s).add(t));
  const check = () => {
    const r = matchAnswer(prompt, guess);
    if (r.kind === "hit") { reveal(r.answer.t); setMsg(`✓ ${r.answer.t} · ${r.answer.p} pts`); beep("good"); setGuess(""); }
    else if (r.kind === "ambiguous") setMsg(`Be more specific: ${r.options.map((o) => o.t).join(" or ")}`);
    else { setMsg("Not on the list"); beep("bad"); }
  };
  const idx = bank.prompts.indexOf(prompt);
  const nav = (d: number) => go(`/deepdive?v=study&p=${bank.prompts[(idx + d + bank.prompts.length) % bank.prompts.length].id}`);
  return (
    <div className="dd-page">
      <div className="dd-row wrap"><button className="pill ghost sm" onClick={() => go(`/deepdive?v=study&c=${prompt.cat}`)}>‹ All lists</button><span className="dd-chip" style={{ borderColor: CAT_COLOR[prompt.cat] }}>{CAT_ICON[prompt.cat]} {bank.categories.find((c) => c.id === prompt.cat)?.name}</span></div>
      <h2 className="dd-h2">{prompt.q}</h2>
      {prompt.note && <p className="muted small">{prompt.note}</p>}
      <div className="dd-row wrap dd-study-ctl">
        <div className="dd-seg" role="group" aria-label="Study mode">
          <button className={!quiz ? "on" : ""} aria-pressed={!quiz} onClick={() => { setQuiz(false); setShown(new Set()); }}>Browse</button>
          <button className={quiz ? "on" : ""} aria-pressed={quiz} onClick={() => { setQuiz(true); setShown(new Set()); setMsg(""); }}>Self-quiz (hide)</button>
        </div>
        <span className="muted small">{answers.length} answers · common → rare{quiz ? ` · ${shown.size} revealed` : ""}</span>
      </div>
      {quiz && (
        <form className="dd-row dd-quizbar" onSubmit={(e) => { e.preventDefault(); check(); }}>
          <input value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="Type an answer to flip its card" aria-label="Self-quiz answer" autoComplete="off" />
          <button className="pill">Check</button>
          <button type="button" className="pill ghost" onClick={() => setShown(new Set(answers.map((a) => a.t)))}>Reveal all</button>
          {msg && <span className="dd-msg" role="status">{msg}</span>}
        </form>
      )}
      {quiz ? (
        <div className="dd-cards">{answers.map((a, i) => <FlipCard key={a.t} a={a} rank={i + 1} shown={shown.has(a.t)} onFlip={() => setShown((s) => { const n = new Set(s); if (n.has(a.t)) n.delete(a.t); else n.add(a.t); return n; })} />)}</div>
      ) : (
        <ol className="dd-browse">
          {answers.map((a) => (
            <li key={a.t}><div className="dd-brow"><b>{a.t}</b><RarityBar p={a.p} /></div>
              {(a.a?.length || a.tip) && <div className="muted small">{a.tip && <span>💡 {a.tip}</span>}{a.a?.length ? <span className="dd-alias"> Also accepted: {a.a.slice(0, 4).join(", ")}</span> : null}</div>}</li>
          ))}
        </ol>
      )}
      <div className="dd-row"><button className="pill ghost sm" onClick={() => nav(-1)}>‹ Previous list</button><button className="pill ghost sm" onClick={() => go(`/deepdive?v=drill&p=${prompt.id}`)}>Drill this list 🎯</button><button className="pill ghost sm" onClick={() => nav(1)}>Next list ›</button></div>
    </div>
  );
}

/* ---------------- shared timer hook ---------------- */
/** Calls `fn` once when `ms` have passed since `start` (no per-tick re-renders; the clock UI updates itself). */
function useDeadline(active: boolean, start: number, ms: number, fn: () => void) {
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(fn, Math.max(0, ms - (Date.now() - start)));
    return () => clearTimeout(t);
  }, [active, start, ms, fn]);
}

/* ---------------- drills ---------------- */
type DrillType = "all" | "rare";
function Drills({ bank, params }: { bank: Bank; params: URLSearchParams }) {
  const [type, setType] = useState<DrillType>((params.get("t") as DrillType) || "all");
  const [cat, setCat] = useState<CatId | "all">("all");
  const [timer, setTimer] = useState<number>(0);
  const [minPts, setMinPts] = useState(60);
  const [pid, setPid] = useState<string | null>(params.get("p"));
  const [run, setRun] = useState(0);
  const prompt = pid ? bank.prompts.find((p) => p.id === pid) ?? null : null;
  const random = () => { const pool = bank.prompts.filter((p) => cat === "all" || p.cat === cat); setPid(pool[Math.floor(Math.random() * pool.length)].id); setRun((r) => r + 1); };
  if (prompt && run > 0) return type === "all"
    ? <NameAll key={run} prompt={prompt} seconds={timer} onExit={() => setRun(0)} onNext={random} />
    : <RareHunt key={run} prompt={prompt} seconds={timer ? 25 : 0} minPts={minPts} onExit={() => setRun(0)} onNext={random} />;
  return (
    <div className="dd-page">
      <h2 className="dd-h2">🎯 Drills</h2>
      <div className="dd-drill-types">
        <button className={`dd-tile ${type === "all" ? "on" : ""}`} aria-pressed={type === "all"} onClick={() => setType("all")}><span className="ic">🧺</span><b>Name them all</b><span>Type as many as you can; see what you missed.</span></button>
        <button className={`dd-tile ${type === "rare" ? "on" : ""}`} aria-pressed={type === "rare"} onClick={() => setType("rare")}><span className="ic">💎</span><b>Name a rare one</b><span>Only answers worth ≥ {minPts} pts count.</span></button>
      </div>
      <div className="dd-form">
        <label>Category <CatChips bank={bank} cat={cat} setCat={setCat} /></label>
        <label>Timer
          <span className="dd-seg">{(type === "all" ? [0, 60, 120] : [0, 25]).map((s) => <button key={s} className={timer === s ? "on" : ""} aria-pressed={timer === s} onClick={() => setTimer(s)}>{s ? `${s} s` : "Off"}</button>)}</span>
        </label>
        {type === "rare" && <label>Minimum points
          <span className="dd-seg">{[40, 60, 80].map((s) => <button key={s} className={minPts === s ? "on" : ""} aria-pressed={minPts === s} onClick={() => setMinPts(s)}>≥ {s}</button>)}</span>
        </label>}
        {prompt && <p className="small">Selected list: <b>{prompt.q}</b> <button className="pill sm" onClick={() => setRun(1)}>Start this list</button></p>}
        <button className="pill" onClick={random}>Start with a random list ›</button>
      </div>
    </div>
  );
}

function NameAll({ prompt, seconds, onExit, onNext }: { prompt: Prompt; seconds: number; onExit: () => void; onNext: () => void }) {
  const [found, setFound] = useState<string[]>([]);
  const [guess, setGuess] = useState("");
  const [msg, setMsg] = useState("");
  const [over, setOver] = useState(false);
  const [start] = useState(Date.now());
  const finish = useCallback(() => {
    setOver(true);
    const pct = found.length / prompt.answers.length;
    logAttempt({ at: Date.now(), pid: prompt.id, cat: prompt.cat, ok: pct >= 0.5, pts: Math.round(pct * 100), ms: Date.now() - start, src: "drill" });
    if (pct < 0.5) srsMiss(prompt.id, prompt.answers.filter((a) => !found.includes(a.t)).slice(-3).map((a) => a.t));
  }, [found, prompt, start]);
  useDeadline(seconds > 0 && !over, start, seconds * 1000, finish);
  const submit = () => {
    const r = matchAnswer(prompt, guess);
    if (r.kind === "hit") {
      if (found.includes(r.answer.t)) setMsg(`Already have ${r.answer.t}`);
      else { setFound([...found, r.answer.t]); setMsg(`✓ ${r.answer.t} +${r.answer.p}`); beep("good"); }
      setGuess("");
    } else if (r.kind === "ambiguous") setMsg(`Be more specific: ${r.options.map((o) => o.t).join(" or ")}`);
    else { setMsg("Not on the list — try again"); beep("bad"); }
  };
  const pts = prompt.answers.filter((a) => found.includes(a.t)).reduce((s, a) => s + a.p, 0);
  const total = prompt.answers.reduce((s, a) => s + a.p, 0);
  return (
    <div className="dd-page">
      <div className="dd-row wrap"><button className="pill ghost sm" onClick={onExit}>‹ Drills</button>{seconds > 0 && !over && <Countdown start={start} totalMs={seconds * 1000} />}<span className="dd-score">{found.length}/{prompt.answers.length} · {pts} pts</span></div>
      <h2 className="dd-h2">{prompt.q}</h2>
      {prompt.note && <p className="muted small">{prompt.note}</p>}
      {!over ? (
        <form className="dd-row dd-quizbar" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="Type an answer, press Enter" aria-label="Your answer" autoFocus autoComplete="off" />
          <button className="pill">Enter</button><button type="button" className="pill ghost" onClick={finish}>Finish</button>
          {msg && <span className="dd-msg" role="status">{msg}</span>}
        </form>
      ) : (
        <div className="coach pop-in dd-result">
          <div className="coach-h"><b>🧺 You named {found.length} of {prompt.answers.length} ({Math.round((found.length / prompt.answers.length) * 100)}%)</b></div>
          <p className="coach-gap ok">{pts} of {total} rarity points. Missed answers are marked in red below{found.length / prompt.answers.length < 0.5 ? " — this list is now in your review queue" : ""}.</p>
          <div className="dd-row"><button className="pill" onClick={onNext} autoFocus>Another list ›</button><button className="pill ghost" onClick={onExit}>Drill menu</button></div>
        </div>
      )}
      <div className="dd-cards">{prompt.answers.map((a, i) => <FlipCard key={a.t} a={a} rank={i + 1} shown={over || found.includes(a.t)} missed={over && !found.includes(a.t)} mine={found.includes(a.t)} />)}</div>
    </div>
  );
}

function RareHunt({ prompt, seconds, minPts, onExit, onNext }: { prompt: Prompt; seconds: number; minPts: number; onExit: () => void; onNext: () => void }) {
  const [guess, setGuess] = useState("");
  const [msg, setMsg] = useState("");
  const [tried, setTried] = useState<Answer[]>([]);
  const [win, setWin] = useState<Answer | null>(null);
  const [over, setOver] = useState(false);
  const [start] = useState(Date.now());
  const eligible = prompt.answers.filter((a) => a.p >= minPts).length;
  const end = useCallback((w: Answer | null) => {
    setWin(w); setOver(true);
    logAttempt({ at: Date.now(), pid: prompt.id, cat: prompt.cat, ok: !!w, pts: w?.p ?? 0, ms: Date.now() - start, src: "drill" });
    if (!w) srsMiss(prompt.id, rarerPicks(prompt, null).map((a) => a.t));
  }, [prompt, start]);
  const timeUp = useCallback(() => end(null), [end]);
  useDeadline(seconds > 0 && !over, start, seconds * 1000, timeUp);
  const submit = () => {
    const r = matchAnswer(prompt, guess);
    if (r.kind === "hit") {
      setGuess("");
      if (r.answer.p >= minPts) { beep("win"); end(r.answer); }
      else { setTried((t) => [...t, r.answer]); setMsg(`✓ ${r.answer.t} is right, but only ${r.answer.p} pts — go rarer (≥ ${minPts})`); beep("tap"); }
    } else if (r.kind === "ambiguous") setMsg(`Be more specific: ${r.options.map((o) => o.t).join(" or ")}`);
    else { setMsg("Not on the list — try again"); beep("bad"); }
  };
  return (
    <div className="dd-page">
      <div className="dd-row wrap"><button className="pill ghost sm" onClick={onExit}>‹ Drills</button>{seconds > 0 && !over && <Countdown start={start} totalMs={seconds * 1000} />}<span className="dd-score">Target ≥ {minPts} pts · {eligible} qualify</span></div>
      <h2 className="dd-h2">{prompt.q}</h2>
      {prompt.note && <p className="muted small">{prompt.note}</p>}
      {!over ? (
        <form className="dd-row dd-quizbar" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="A rare answer…" aria-label="Your answer" autoFocus autoComplete="off" />
          <button className="pill">Enter</button><button type="button" className="pill ghost" onClick={() => end(null)}>Give up</button>
          {msg && <span className="dd-msg" role="status">{msg}</span>}
        </form>
      ) : <FeedbackCard prompt={prompt} mine={win} onNext={onNext} nextLabel="Another list ›" extra={tried.length ? <p className="small">Too common this time: {tried.map((t) => `${t.t} (${t.p})`).join(", ")}</p> : null} />}
    </div>
  );
}

/* ---------------- dive (practice) ---------------- */
type DiveKind = "daily" | "endless" | "review";
type Result = { prompt: Prompt; answer: Answer | null; ms: number; last: string };
function Dive({ bank, kind }: { bank: Bank; kind: DiveKind }) {
  const [queue, setQueue] = useState<Prompt[] | null>(null);
  const [source, setSource] = useState("");
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"ready" | "preview" | "answer" | "feedback" | "done">("ready");
  const [t0, setT0] = useState(0);
  const [guess, setGuess] = useState("");
  const [msg, setMsg] = useState("");
  const [shake, setShake] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [tab, setTab] = useState("log");
  const lastTry = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const day = chicagoDate();
  useEffect(() => {
    if (kind === "daily") dailySet(bank).then((d) => { setQueue(d.prompts); setSource(d.source === "weekly" ? "Weekly set" : "Date-seeded set"); });
    else if (kind === "review") { const due = dueItems().map((x) => bank.prompts.find((p) => p.id === x.pid)).filter(Boolean) as Prompt[]; setQueue(due.slice(0, 7)); setSource(`${due.length} due`); }
    else setQueue(pickSet(bank, `endless:${Date.now()}`, 7));
  }, [bank, kind]);
  const anim = useAnim();
  const prompt = queue?.[i] ?? null;
  const misses = results.filter((r) => !r.answer).length;
  const depth = results.reduce((s, r) => s + metres(r.answer?.p ?? 0), 0);
  const total = kind === "endless" ? null : queue?.length ?? 0;
  const begin = () => { setPhase("preview"); setT0(Date.now()); setMsg(""); setGuess(""); lastTry.current = ""; };
  const toAnswer = useCallback(() => { setPhase("answer"); setT0(Date.now()); setTimeout(() => inputRef.current?.focus(), 30); }, []);
  useDeadline(phase === "preview", t0, PREVIEW_MS, toAnswer);
  const record = useCallback((answer: Answer | null, ms: number) => {
    if (!prompt) return;
    const r: Result = { prompt, answer, ms, last: lastTry.current };
    setResults((rs) => [...rs, r]); setPhase("feedback"); setTab("log");
    const src: Attempt["src"] = kind;
    logAttempt({ at: Date.now(), pid: prompt.id, cat: prompt.cat, ok: !!answer, pts: answer?.p ?? 0, ms, src });
    const slow = !answer || ms > SLOW_MS;
    if (kind === "review" && !slow) srsPass(prompt.id); else if (slow) srsMiss(prompt.id, rarerPicks(prompt, answer).map((a) => a.t));
    if (answer) beep(answer.p >= 70 ? "win" : "good"); else beep("bad");
  }, [prompt, kind]);
  const timeUp = useCallback(() => record(null, ANSWER_MS), [record]);
  useDeadline(phase === "answer", t0, ANSWER_MS, timeUp);
  const submit = () => {
    if (!prompt || phase !== "answer" || !guess.trim()) return;
    lastTry.current = guess.trim();
    const r = matchAnswer(prompt, guess);
    if (r.kind === "hit") record(r.answer, Date.now() - t0);
    else { setMsg(r.kind === "ambiguous" ? `Be more specific: ${r.options.slice(0, 3).map((o) => o.t).join(" or ")}` : `“${guess.trim()}” isn't recognised — try again`); setShake((s) => s + 1); setGuess(""); beep("tap"); }
  };
  const finish = (rs: Result[]) => {
    setPhase("done");
    const d = rs.reduce((s, r) => s + metres(r.answer?.p ?? 0), 0);
    logDive({ at: Date.now(), kind, day: kind === "daily" ? day : undefined, depth: d, n: rs.length, hits: rs.filter((r) => r.answer).length });
    bumpStreak("deepdive");
    if (d >= 3500 && animOn()) confetti();
  };
  const next = () => {
    if (!queue) return;
    if (kind === "endless") {
      if (misses >= 3) return finish(results);
      if (i + 1 >= queue.length) setQueue([...queue, ...pickSet(bank, `endless:${Date.now()}`, 7, new Set(queue.map((p) => p.id)))]);
      setI(i + 1); begin(); return;
    }
    if (i + 1 >= queue.length) return finish(results);
    setI(i + 1); begin();
  };
  useEffect(() => { // Enter / Space advances from feedback
    if (phase !== "feedback" && phase !== "ready") return;
    const k = (e: KeyboardEvent) => { if (e.key === "Enter" && (e.target as HTMLElement)?.tagName !== "BUTTON") { e.preventDefault(); if (phase === "ready") begin(); else next(); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  });
  const last = results[results.length - 1];
  const panelTabs = [
    { id: "log", label: "Dive log", badge: results.length || null, body: <DiveLog results={results} /> },
    { id: "learn", label: "Learn", body: <LearnCards /> },
  ];
  if (!queue) return <p className="muted dd-loading">Preparing your dive…</p>;
  if (kind === "review" && queue.length === 0) return (
    <div className="dd-page"><h2 className="dd-h2">🔁 Review</h2><p>Nothing is due right now. {queuedItems().length ? `${queuedItems().length} prompt(s) are scheduled for later.` : "Missed or slow answers will show up here."}</p><button className="pill" onClick={() => go("/deepdive")}>Back to Deep Dive</button></div>
  );
  const title = kind === "daily" ? "🌊 Daily Dive" : kind === "review" ? "🔁 Review dive" : "♾️ Endless";
  return (
    <div className="dd-play">
      <div className="dd-ocean" style={{ ["--deep" as string]: Math.min(1, depth / MAX_DEPTH) }}>
        <DepthMeter depth={depth} />
        <div className="dd-stage">
          <div className="dd-row dd-status">
            <b>{title}</b>
            <span className="dd-pill">{kind === "endless" ? `Prompt ${i + 1} · ${"❤️".repeat(Math.max(0, 3 - misses))}${"🖤".repeat(Math.min(3, misses))}` : `Prompt ${Math.min(i + 1, total || 1)} of ${total}`}</span>
            <CountUp className="dd-pill" value={depth} format={fmtM} />
            {source && <span className="dd-pill subtle">{source}</span>}
          </div>
          {phase === "ready" && (
            <div className="dd-card pop-in">
              <h2>{kind === "daily" ? "Today's dive: 7 prompts" : kind === "review" ? `${queue.length} prompt${queue.length > 1 ? "s" : ""} to review` : "Endless: keep going until you miss 3 prompts"}</h2>
              <p>Each prompt shows for 3 seconds, then you have 25 seconds to type one accepted answer. Rarer answers score more (10–100) and send you deeper.</p>
              <div className="dd-catrow">{queue.slice(0, 7).map((p, j) => <span key={j} className="dd-chip" style={{ borderColor: CAT_COLOR[p.cat] }}>{CAT_ICON[p.cat]}</span>)}</div>
              <button className="pill dd-go" onClick={begin} autoFocus>Start dive ›</button>
            </div>
          )}
          {prompt && phase === "preview" && (
            <div className="dd-card dd-preview pop-in" key={`pv${i}`}>
              <span className="dd-cat" style={{ background: CAT_COLOR[prompt.cat] }}>{CAT_ICON[prompt.cat]} {bank.categories.find((c) => c.id === prompt.cat)?.name}</span>
              <h2 className="dd-prompt">{prompt.q}</h2>
              {anim && <div className="dd-get-ready"><i style={{ animationDuration: `${PREVIEW_MS}ms` }} /></div>}
              <p className="muted small">Get ready… <SecondsLeft start={t0} totalMs={PREVIEW_MS} /></p>
            </div>
          )}
          {prompt && phase === "answer" && (
            <div className="dd-card dd-answer" key={`an${i}`}>
              <div className="dd-row dd-qrow">
                <div><span className="dd-cat" style={{ background: CAT_COLOR[prompt.cat] }}>{CAT_ICON[prompt.cat]} {bank.categories.find((c) => c.id === prompt.cat)?.name}</span>
                  <h2 className="dd-prompt">{prompt.q}</h2>{prompt.note && <p className="muted small">{prompt.note}</p>}</div>
                <Countdown start={t0} totalMs={ANSWER_MS} />
              </div>
              <form className={`dd-answer-form ${shake ? "shake" : ""}`} key={shake} onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <input ref={inputRef} value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="Type one answer…" aria-label="Your answer" autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus enterKeyHint="go" />
                <button className="pill">Dive</button>
              </form>
              <p className="dd-msg" role="status" aria-live="polite">{msg || "\u00a0"}</p>
            </div>
          )}
          {last && phase === "feedback" && (
            <div className="dd-card dd-fb">
              <h2 className="dd-prompt small">{last.prompt.q}</h2>
              <FeedbackCard prompt={last.prompt} mine={last.answer} ms={last.ms} typed={last.last} onNext={next}
                nextLabel={kind === "endless" ? (misses >= 3 ? "Surface — see results ›" : "Next prompt ›") : i + 1 >= (total ?? 0) ? "Finish dive ›" : "Next prompt ›"} />
              {kind === "endless" && misses < 3 && <button className="pill ghost sm" onClick={() => finish(results)}>Surface now</button>}
            </div>
          )}
          {phase === "done" && <DiveSummary results={results} kind={kind} depth={depth} />}
        </div>
      </div>
      <Panel tabs={panelTabs} active={tab} onTab={setTab} />
    </div>
  );
}
function DiveLog({ results }: { results: Result[] }) {
  if (!results.length) return <p className="muted small">Nothing yet — start the dive.</p>;
  return (
    <ol className="dd-log">
      {results.map((r, j) => <li key={j}><span className="ic">{CAT_ICON[r.prompt.cat]}</span><span className="grow"><b>{r.answer?.t ?? "—"}</b><span className="muted tiny"> {r.prompt.q}</span></span><span className={`dd-pts ${r.answer ? "" : "zero"}`}>{r.answer?.p ?? 0}</span></li>)}
    </ol>
  );
}
function DiveSummary({ results, kind, depth }: { results: Result[]; kind: DiveKind; depth: number }) {
  const hits = results.filter((r) => r.answer).length;
  const pts = depth / 10;
  const verdict = pts >= 450 ? "Abyssal — elite rarity instincts." : pts >= 300 ? "Deep water. You're skipping the obvious answers." : pts >= 150 ? "Twilight zone. Push one answer deeper next time." : "Shallow so far — Study and Drills will help.";
  return (
    <div className="dd-card dd-summary pop-in">
      <div className="dd-sum-depth"><span>🤿</span><b><CountUp value={depth} format={fmtM} from={0} ms={1400} /></b><span className="muted">{pts} pts · {hits}/{results.length} answered</span></div>
      <p><b>{verdict}</b></p>
      <DiveLog results={results} />
      <div className="dd-row wrap">
        {kind !== "daily" && <button className="pill" onClick={() => go(`/deepdive?v=dive&k=${kind}&r=${Date.now()}`)} autoFocus>Dive again</button>}
        {kind === "daily" && <button className="pill" onClick={() => go(`/deepdive?v=dive&k=endless`)} autoFocus>Try Endless ›</button>}
        <button className="pill ghost" onClick={() => go("/deepdive?v=progress")}>Progress</button>
        <button className="pill ghost" onClick={() => go("/deepdive")}>Home</button>
      </div>
    </div>
  );
}

/* ---------------- progress ---------------- */
function Progress({ bank }: { bank: Bank }) {
  const s = useMemo(() => load(), []);
  const st = streaks(s);
  const scored = s.attempts.filter((a) => a.src !== "drill");
  const overall = scored.length ? scored.reduce((x, a) => x + a.pts, 0) / scored.length : 0;
  const rows = bank.categories.map((c) => {
    const as = scored.filter((a) => a.cat === c.id);
    const acc = as.length ? as.filter((a) => a.ok).length / as.length : 0;
    const avg = as.length ? as.reduce((x, a) => x + a.pts, 0) / as.length : 0;
    const label = as.length < 3 ? "—" : acc >= 0.75 && avg >= overall ? "Strong" : acc < 0.5 || avg < overall * 0.75 ? "Weak" : "OK";
    return { c, n: as.length, acc, avg, label, drills: s.attempts.filter((a) => a.cat === c.id && a.src === "drill").length };
  });
  const dives = s.dives.filter((d) => d.kind !== "review").slice(-20);
  const avgDepth = dives.length ? dives.reduce((x, d) => x + d.depth, 0) / dives.length : 0;
  const q = queuedItems(); const due = dueItems().length;
  return (
    <div className="dd-page">
      <h2 className="dd-h2">📈 Progress</h2>
      <div className="dd-statgrid">
        <div><b>{s.dives.length}</b><span>dives</span></div>
        <div><b>{fmtM(Math.round(avgDepth))}</b><span>avg depth (last 20)</span></div>
        <div><b>{fmtM(s.dives.reduce((m, d) => Math.max(m, d.depth), 0))}</b><span>best dive</span></div>
        <div><b>🔥 {st.current}</b><span>day streak (best {st.best})</span></div>
      </div>
      <h3>Depth trend</h3>
      <TrendChart values={dives.map((d) => d.depth)} />
      <h3>By category</h3>
      <table className="dd-table">
        <thead><tr><th>Category</th><th>Accuracy</th><th>Avg pts</th><th>Answers</th><th></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.c.id}><td>{CAT_ICON[r.c.id]} {r.c.name}</td><td>{r.n ? `${Math.round(r.acc * 100)}%` : "—"}</td><td>{r.n ? Math.round(r.avg) : "—"}</td><td>{r.n}{r.drills ? <span className="muted tiny"> +{r.drills} drills</span> : null}</td>
            <td><span className={`dd-badge ${r.label.toLowerCase()}`}>{r.label}</span></td></tr>
        ))}</tbody>
      </table>
      <p className="muted small">Strong = 75%+ accepted and at least your overall average points; weak = under 50% accepted or under ¾ of your average. Needs 3+ answers. Drills are counted separately.</p>
      <h3>Review queue</h3>
      {q.length ? <ul className="dd-queue">{q.slice(0, 12).map((x) => { const p = bank.prompts.find((pp) => pp.id === x.pid); return p ? <li key={x.pid}><span>{CAT_ICON[p.cat]} {p.q}</span><span className="muted small">{x.due <= Date.now() ? "due now" : `in ${Math.ceil((x.due - Date.now()) / 86400000)} d`} · step {x.step + 1}/3</span></li> : null; })}</ul> : <p className="muted small">Empty. Missed or slow answers (over 15 s) are queued for 1, 3 and 7 days.</p>}
      {due > 0 && <button className="pill" onClick={() => go("/deepdive?v=dive&k=review")}>Review {due} due now ›</button>}
    </div>
  );
}
function TrendChart({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="muted small">Finish two dives to see your trend.</p>;
  const W = 600, H = 160, pad = 28, max = Math.max(MAX_DEPTH / 2, ...values);
  const x = (j: number) => pad + (j * (W - pad * 2)) / (values.length - 1);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const pts = values.map((v, j) => `${x(j)},${y(v)}`).join(" ");
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    <svg className="dd-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Depth of your last ${values.length} dives, average ${Math.round(avg)} metres`}>
      <defs><linearGradient id="ddg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2f62c0" stopOpacity=".35" /><stop offset="1" stopColor="#2f62c0" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad} x2={W - pad} y1={y(max * f)} y2={y(max * f)} className="grid" /><text x={2} y={y(max * f) + 4}>{Math.round((max * f) / 1000 * 10) / 10}k</text></g>)}
      <polygon points={`${x(0)},${y(0)} ${pts} ${x(values.length - 1)},${y(0)}`} fill="url(#ddg)" />
      <polyline points={pts} className="line" />
      <line x1={pad} x2={W - pad} y1={y(avg)} y2={y(avg)} className="avg" />
      {values.map((v, j) => <circle key={j} cx={x(j)} cy={y(v)} r="3.5" />)}
    </svg>
  );
}
