import { useCallback, useEffect, useRef, useState } from "react";
import { ANSWERS, score, type Mark } from "./wordleLogic";
import { usePlayerState, recordResult } from "../lib/shared";
import { PuzzleBar, GameHeader, Timer, Toast, useToast, usePuzzle } from "./common";
import { ensurePlayer } from "../lib/player";
import { fmtTime } from "../lib/daily";
import { beep, confetti, bumpStreak, CAPS, playerColor } from "../lib/fx";
import { useSharedBoard } from "../lib/shared";

type S = { guesses: string[]; startedAt?: number; finishedAt?: number; won?: boolean };
const MAX = 6;
let guessSet: Set<string> | null = null;
const loadGuesses = () => fetch("/wordle-guesses.json").then((r) => r.json()).then((a: string[]) => { guessSet = new Set(a); });

export default function WordlePage({ params }: { params: URLSearchParams }) {
  const { idx, item } = usePuzzle<string>(ANSWERS, params, 3, (d) => d.answer);
  if (idx === null || !item) return <p className="center muted">Loading puzzle…</p>;
  const room = params.get("room");
  return <Wordle key={idx} idx={idx} answer={item} room={room} coop={!!room && params.get("mode") === "coop"} />;
}

function Wordle({ idx, answer: rawAnswer, room, coop }: { idx: number; answer: string; room: string | null; coop: boolean }) {
  useEffect(() => { if (room) ensurePlayer(); if (!guessSet) loadGuesses(); }, [room]);
  const answer = ANSWERS[0] === ANSWERS[0].toUpperCase() ? rawAnswer.toUpperCase() : rawAnswer.toLowerCase();
  const solo = usePlayerState<S>("wordle", idx, { guesses: [] }, coop ? null : room);
  const shared = useSharedBoard<S>("wordle-coop", idx, { guesses: [] }, coop ? room : null);
  const state: S = coop ? { ...shared.state, guesses: shared.state.guesses || [] } : solo.state;
  const others = coop ? {} : solo.others;
  const status = coop ? shared.status : solo.status;
  const [cur, setCur] = useState("");
  useEffect(() => { if (coop) shared.broadcastSelection([cur]); }, [cur, coop]);
  /** Co-op: compare-and-swap so only one row is submitted at a time; a stale submit is rejected. */
  const update = (fn: (s: S) => S, rowAt: number) => {
    if (!coop) return solo.update(fn);
    shared.commit((s) => { const c = { ...s, guesses: s.guesses || [] }; return c.guesses.length !== rowAt || c.finishedAt ? c : fn(c); })
      .then((ok) => { if (!ok) showToast("A teammate submitted first — try again"); });
  };
  const [shake, setShake] = useState(false);
  const [revealRow, setRevealRow] = useState(-1);
  const [closed, setClosed] = useState(false);
  const [toast, showToast] = useToast();
  const done = !!state.finishedAt;
  const prevLen = useRef(state.guesses.length);
  useEffect(() => { if (state.guesses.length > prevLen.current) setRevealRow(state.guesses.length - 1); prevLen.current = state.guesses.length; }, [state.guesses.length]);

  const submit = useCallback(() => {
    if (done) return;
    if (cur.length < 5) { setShake(true); setTimeout(() => setShake(false), 500); showToast("Not enough letters"); return; }
    if (guessSet && !guessSet.has(cur)) { setShake(true); setTimeout(() => setShake(false), 500); showToast("Not in word list"); return; }
    const g = cur; setCur(""); setRevealRow(state.guesses.length);
    update((s) => {
      const guesses = [...s.guesses, g]; const now = Date.now(); const won = g === answer;
      const fin = won || guesses.length >= MAX;
      return { ...s, guesses, startedAt: s.startedAt ?? now, finishedAt: fin ? now : undefined, won: fin ? won : undefined };
    }, state.guesses.length);
    if (g === answer) setTimeout(() => showToast(["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"][state.guesses.length]), 1700);
    else if (state.guesses.length + 1 >= MAX) setTimeout(() => showToast(answer.toUpperCase()), 1700);
  }, [cur, done, state.guesses.length, answer, coop, shared.commit, solo.update]);

  const press = useCallback((k: string) => {
    if (done) return;
    if (k === "enter") return submit();
    if (k === "back") return setCur((c) => c.slice(0, -1));
    if (/^[a-z]$/.test(k)) { beep("tap"); setCur((c) => (c.length < 5 ? c + k : c)); }
  }, [done, submit]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key.toLowerCase(); press(k === "backspace" ? "back" : k); };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, [press]);
  useEffect(() => {
    if (state.finishedAt && Date.now() - state.finishedAt < 15000) { if (state.won) { setTimeout(confetti, 1800); bumpStreak("wordle"); } }
    if (state.finishedAt && state.startedAt) recordResult({ room, game: "wordle", puzzleId: idx, won: !!state.won, mistakes: state.guesses.length, hints: 0, seconds: Math.round((state.finishedAt - state.startedAt) / 1000) });
  }, [state.finishedAt]);

  const keyMarks: Record<string, Mark> = {};
  const rank = { absent: 0, present: 1, correct: 2 };
  for (const g of state.guesses) score(g, answer).forEach((m, i) => { const l = g[i]; if (!keyMarks[l] || rank[m] > rank[keyMarks[l]]) keyMarks[l] = m; });

  return (
    <div className="game wordle">
      <GameHeader title={`Wordle${room ? (coop ? " · Co-op" : " · Versus") : ""}`} game="wordle" room={room} status={status} peers={coop ? shared.peers : Object.keys(others)} cap={coop ? CAPS.shared : CAPS.versus} />
      <PuzzleBar room={room} pool={{ key: "wordle", size: ANSWERS.length, current: idx, done }} />
      <div className="strands-status"><span className="muted">{MAX - state.guesses.length} guesses left</span><Timer startedAt={state.startedAt} finishedAt={state.finishedAt} /></div>
      <div className="w-grid">
        {Array.from({ length: MAX }).map((_, r) => {
          const g = state.guesses[r]; const marks = g ? score(g, answer) : null; const isCur = r === state.guesses.length && !done;
          const letters = g ?? (isCur ? cur : "");
          return (
            <div key={r} className={`w-row ${isCur && shake ? "shake" : ""} ${g && state.won && g === answer && r === revealRow ? "bounce" : ""}`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={`w-tile ${marks ? "revealed " + marks[i] : letters[i] ? "filled" : ""} ${marks && r === revealRow ? "flip" : ""}`} style={{ animationDelay: marks && r === revealRow ? `${i * 300}ms` : undefined, transitionDelay: marks && r === revealRow ? `${i * 300 + 250}ms` : undefined }}>
                  {letters[i] || ""}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {coop && !done && Object.entries(shared.locks).filter(([, v]) => v[0]).length > 0 && (
        <div className="ghosts">{Object.entries(shared.locks).filter(([, v]) => v[0]).map(([pl, v]) => (
          <div key={pl} className="ghost-row" style={{ color: playerColor(pl) }}><span className="ghost-name">{pl}</span>
            {Array.from({ length: 5 }).map((_, i) => <span key={i} className="ghost-tile" style={{ borderColor: playerColor(pl) }}>{v[0][i] || ""}</span>)}</div>))}
        </div>)}
      <div className="keyboard">
        {["qwertyuiop", "asdfghjkl", "+zxcvbnm-"].map((row) => (
          <div className="k-row" key={row}>
            {row.split("").map((k) => k === "+" ? <button key={k} className="key wide" onClick={() => press("enter")}>ENTER</button>
              : k === "-" ? <button key={k} className="key wide" onClick={() => press("back")} aria-label="Backspace">⌫</button>
              : <button key={k} className={`key ${keyMarks[k] || ""}`} onClick={() => press(k)}>{k}</button>)}
          </div>
        ))}
      </div>
      {Object.entries(others).length > 0 && (
        <div className="opponents">
          {Object.entries(others).map(([name, o]) => (
            <div className="opp" key={name}>
              <div className="opp-name">{name}</div>
              <div className="opp-mini wordle-mini">
                {Array.from({ length: MAX }).map((_, r) => <div key={r}>{Array.from({ length: 5 }).map((_, i) => { const g = (o.guesses || [])[r]; return <i key={i} className={g ? score(g, answer)[i] : ""} />; })}</div>)}
              </div>
              <div className="muted small">{o.finishedAt ? (o.won ? `Solved in ${o.guesses.length}` : "Out of guesses") + (o.startedAt ? ` · ${fmtTime(Math.round((o.finishedAt - o.startedAt) / 1000))}` : "") : `${(o.guesses || []).length}/6 guesses`}</div>
            </div>
          ))}
        </div>
      )}
      {done && !closed && (
        <div className="modal-bg" style={{ animationDelay: "1.8s" }}><div className="modal">
          <button className="x" onClick={() => setClosed(true)}>×</button>
          <h2>{state.won ? "Congratulations!" : "Next time!"}</h2>
          <p>{state.won ? `Solved in ${state.guesses.length}/6` : `The word was ${answer.toUpperCase()}`}{state.startedAt && state.finishedAt ? ` · ${fmtTime(Math.round((state.finishedAt - state.startedAt) / 1000))}` : ""}</p>
          <pre className="share">{`Game Lobby Wordle #${idx + 1} ${state.won ? state.guesses.length : "X"}/6\n`}{state.guesses.map((g) => score(g, answer).map((m) => (m === "correct" ? "🟩" : m === "present" ? "🟨" : "⬜")).join("")).join("\n")}</pre>
          <button className="pill" onClick={() => (location.hash = "/")}>Back to games</button>
        </div></div>
      )}
      <Toast msg={toast} />
    </div>
  );
}
