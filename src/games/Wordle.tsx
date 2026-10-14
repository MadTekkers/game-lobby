import { useCallback, useEffect, useState } from "react";
import { ANSWERS, score, type Mark } from "./wordleLogic";
import { usePlayerState, recordResult } from "../lib/shared";
import { GameHeader, Timer, Toast, useToast, usePuzzleIndex } from "./common";
import { ensurePlayer } from "../lib/player";
import { fmtTime } from "../lib/daily";
import { beep, confetti, bumpStreak, CAPS } from "../lib/fx";

type S = { guesses: string[]; startedAt?: number; finishedAt?: number; won?: boolean };
const MAX = 6;
let guessSet: Set<string> | null = null;
const loadGuesses = () => fetch("/wordle-guesses.json").then((r) => r.json()).then((a: string[]) => { guessSet = new Set(a); });

export default function WordlePage({ params }: { params: URLSearchParams }) {
  const idx = usePuzzleIndex(ANSWERS.length, params, 3);
  if (idx === null) return <p className="center muted">Loading puzzle…</p>;
  return <Wordle key={idx} idx={idx} room={params.get("room")} />;
}

function Wordle({ idx, room }: { idx: number; room: string | null }) {
  useEffect(() => { if (room) ensurePlayer(); if (!guessSet) loadGuesses(); }, [room]);
  const answer = ANSWERS[idx];
  const { state, update, others, status } = usePlayerState<S>("wordle", idx, { guesses: [] }, room);
  const [cur, setCur] = useState("");
  const [shake, setShake] = useState(false);
  const [revealRow, setRevealRow] = useState(-1);
  const [closed, setClosed] = useState(false);
  const [toast, showToast] = useToast();
  const done = !!state.finishedAt;

  const submit = useCallback(() => {
    if (done) return;
    if (cur.length < 5) { setShake(true); setTimeout(() => setShake(false), 500); showToast("Not enough letters"); return; }
    if (guessSet && !guessSet.has(cur)) { setShake(true); setTimeout(() => setShake(false), 500); showToast("Not in word list"); return; }
    const g = cur; setCur(""); setRevealRow(state.guesses.length);
    update((s) => {
      const guesses = [...s.guesses, g]; const now = Date.now(); const won = g === answer;
      const fin = won || guesses.length >= MAX;
      return { ...s, guesses, startedAt: s.startedAt ?? now, finishedAt: fin ? now : undefined, won: fin ? won : undefined };
    });
    if (g === answer) setTimeout(() => showToast(["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"][state.guesses.length]), 1700);
    else if (state.guesses.length + 1 >= MAX) setTimeout(() => showToast(answer.toUpperCase()), 1700);
  }, [cur, done, state.guesses.length, answer, update]);

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
      <GameHeader title="Wordle" game="wordle" room={room} status={status} peers={Object.keys(others)} cap={CAPS.versus} />
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
