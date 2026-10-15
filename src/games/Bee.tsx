import { useEffect, useState } from "react";
import { Avatar } from "../Lobby";
import { BEES, wordScore, type Bee } from "./puzzleData";
import { usePlayerState, useSharedBoard, recordResult } from "../lib/shared";
import { PuzzleBar, GameHeader, Timer, Toast, useToast, usePuzzleIndex } from "./common";
import { beep, confetti, bumpStreak, playerColor, CAPS } from "../lib/fx";

type S = { found: string[]; startedAt?: number; finishedAt?: number; won?: boolean; score?: number };
export const RANKS: [string, number][] = [["Beginner", 0], ["Good Start", 0.02], ["Moving Up", 0.05], ["Good", 0.08], ["Solid", 0.15], ["Nice", 0.25], ["Great", 0.4], ["Amazing", 0.5], ["Genius", 0.7], ["Queen Bee", 1]];
const rankOf = (score: number, max: number) => RANKS.filter(([, f]) => score >= Math.ceil(f * max)).pop()![0];

export default function BeePage({ params }: { params: URLSearchParams }) {
  const idx = usePuzzleIndex(BEES.length, params);
  if (idx === null) return <p className="center muted">Loading puzzle…</p>;
  const room = params.get("room");
  return <BeeGame key={idx} idx={idx} b={BEES[idx]} room={room} mode={room ? params.get("mode") || "versus" : "solo"} />;
}

function BeeGame({ idx, b, room, mode }: { idx: number; b: Bee; room: string | null; mode: string }) {
  const coop = mode === "coop";
  const solo = usePlayerState<S>("bee", idx, { found: [] }, coop ? null : room);
  const shared = useSharedBoard<S>("bee-coop", idx, { found: [] }, coop ? room : null);
  const state: S = coop ? { ...shared.state, found: shared.state.found || [] } : solo.state;
  const others = coop ? {} : solo.others;
  const [word, setWord] = useState("");
  const [outer, setOuter] = useState(b.outer.split(""));
  const [shake, setShake] = useState(false);
  const [toast, showToast] = useToast();
  const score = state.found.reduce((a, w) => a + wordScore(w), 0);
  const rank = rankOf(score, b.max);
  const letters = new Set([b.center, ...b.outer]);

  const apply = (fn: (s: S) => S) => coop ? (async () => { for (let i = 0; i < 4; i++) if (await shared.commit((s) => fn({ ...s, found: s.found || [] }))) return; })() : solo.update(fn);
  function submit() {
    const w = word.toLowerCase(); setWord("");
    const err = w.length < 4 ? "Too short" : !w.includes(b.center) ? "Missing center letter" : [...w].some((c) => !letters.has(c)) ? "Bad letters" : state.found.includes(w) ? "Already found" : !b.answers.includes(w) ? "Not in word list" : null;
    if (err) { beep("bad"); setShake(true); setTimeout(() => setShake(false), 450); showToast(err); return; }
    const pts = wordScore(w); beep("good");
    showToast(b.pangrams.includes(w) ? `Pangram! +${pts}` : w.length >= 7 ? `Awesome! +${pts}` : w.length >= 5 ? `Nice! +${pts}` : `Good! +${pts}`);
    apply((s) => {
      if (s.found.includes(w)) return s;
      const found = [...s.found, w]; const sc = found.reduce((a, x) => a + wordScore(x), 0); const now = Date.now();
      const genius = sc >= Math.ceil(0.7 * b.max);
      return { ...s, found, score: sc, startedAt: s.startedAt ?? now, finishedAt: s.finishedAt ?? (genius ? now : undefined), won: genius || s.won };
    });
  }
  useEffect(() => {
    if (!state.finishedAt || !state.startedAt) return;
    if (Date.now() - state.finishedAt < 15000) { confetti(); bumpStreak("bee"); showToast("Genius!"); }
    recordResult({ room, game: "bee", puzzleId: idx, won: true, mistakes: 0, hints: 0, seconds: Math.round((state.finishedAt - state.startedAt) / 1000) });
  }, [state.finishedAt]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.metaKey || e.ctrlKey) return; const k = e.key.toLowerCase();
      if (k === "enter") submit(); else if (k === "backspace") setWord((x) => x.slice(0, -1)); else if (/^[a-z]$/.test(k)) setWord((x) => x + k); };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  });

  const hex = [b.center, ...outer];
  const pos = [[0, 0], [0, -1], [0.866, -0.5], [0.866, 0.5], [0, 1], [-0.866, 0.5], [-0.866, -0.5]];
  return (
    <div className="game bee">
      <GameHeader title={`Spelling Bee${room ? (coop ? " · Co-op" : " · Versus") : ""}`} game="bee" room={room} status={coop ? shared.status : solo.status} peers={coop ? shared.peers : Object.keys(others)} cap={coop ? CAPS.shared : CAPS.versus} />
      <PuzzleBar room={room} pool={{ key: "bee", size: BEES.length, current: idx, done: !!state.finishedAt }} />
      <div className="bee-rank">
        <b>{rank}</b>
        <div className="rank-track">{RANKS.map(([r, f]) => <i key={r} className={score >= Math.ceil(f * b.max) ? "on" : ""} title={`${r}: ${Math.ceil(f * b.max)}`} />)}</div>
        <span className="bee-score">{score}</span>
        <Timer startedAt={state.startedAt} finishedAt={state.finishedAt} />
      </div>
      <div className="found-box"><span className="muted small">You have found {state.found.length} word{state.found.length === 1 ? "" : "s"}</span>
        <div className="found-words">{[...state.found].sort().map((w) => <span key={w} className={b.pangrams.includes(w) ? "pg" : ""}>{w}</span>)}</div></div>
      <div className={`bee-input ${shake ? "shake" : ""}`}>{word.split("").map((c, i) => <span key={i} className={c === b.center ? "c" : letters.has(c) ? "" : "bad"}>{c}</span>)}<span className="caret" /></div>
      <div className="hive">
        {hex.map((c, i) => <button key={c + i} className={`cell-hex ${i === 0 ? "center" : ""}`} style={{ left: `${50 + pos[i][0] * 33}%`, top: `${50 + pos[i][1] * 33}%` }} onClick={() => { beep("tap"); setWord((x) => x + c); }}>{c}</button>)}
      </div>
      <div className="controls">
        <button className="pill ghost" onClick={() => setWord((x) => x.slice(0, -1))}>Delete</button>
        <button className="pill ghost round" onClick={() => setOuter((o) => [...o].sort(() => Math.random() - 0.5))} aria-label="Shuffle">⟳</button>
        <button className="pill" onClick={submit}>Enter</button>
      </div>
      {Object.keys(others).length > 0 && (
        <div className="leaderboard"><h3>Score race</h3>
          {[["You", state] as [string, S], ...Object.entries(others)].map(([n, o]) => [n, o, (o.found || []).reduce((a: number, w: string) => a + wordScore(w), 0)] as const).sort((a, b2) => b2[2] - a[2]).map(([name, o, sc], i) => (
            <div className="lb-row" key={name}><span className="lb-rank">{i + 1}</span><Avatar name={name} size={24} /><span className="lb-name">{name}</span>
              <span className="lb-bar"><i style={{ width: `${Math.min(100, (sc / b.max) * 100)}%`, background: playerColor(name) }} /></span><span className="muted small">{sc} pts · {rankOf(sc, b.max)} · {(o.found || []).length} words</span></div>))}
          <p className="muted small">Opponents' words are hidden; only scores are shown.</p>
        </div>)}
      <Toast msg={toast} />
    </div>
  );
}
