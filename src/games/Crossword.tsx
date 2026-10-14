import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CROSSWORDS, type CW } from "./puzzleData";
import { usePlayerState, useSharedBoard, recordResult } from "../lib/shared";
import { GameHeader, Timer, Toast, useToast, usePuzzleIndex } from "./common";
import { fmtTime } from "../lib/daily";
import { beep, confetti, bumpStreak, playerColor, CAPS } from "../lib/fx";

type Entry = CW["across"][number];
type S = { fills: string[]; startedAt?: number; finishedAt?: number; won?: boolean; pct?: number };
const LEN_SIZE: Record<string, string> = { "5": "5", "10": "10", "30": "30" };

export default function CrosswordPage({ params, mini }: { params: URLSearchParams; mini?: boolean }) {
  const d = ["easy", "medium", "hard"].includes(params.get("d") || "") ? params.get("d")! : mini ? "easy" : "medium";
  const len = mini ? "mini" : LEN_SIZE[params.get("len") || "10"] || "10";
  const listKey = `${len}-${d}`; const list = CROSSWORDS[listKey] || [];
  const idx = usePuzzleIndex(Math.max(list.length, 1), params);
  if (!list.length) return <p className="center muted">No puzzles for this setting yet.</p>;
  if (idx === null) return <p className="center muted">Loading puzzle…</p>;
  const room = params.get("room"); const mode = room ? params.get("mode") || "coop" : "solo";
  return <Crossword key={listKey + idx} cw={list[idx]} idx={idx} listKey={listKey} room={room} mode={mode} title={mini ? "The Mini" : `Crossword · ${list[idx].size}×${list[idx].size}`} game={mini ? "mini" : "crossword"} />;
}

function Crossword({ cw, idx, listKey, room, mode, title, game }: { cw: CW; idx: number; listKey: string; room: string | null; mode: string; title: string; game: string }) {
  const n = cw.size; const coop = mode === "coop";
  const empty: S = { fills: Array(n * n).fill("") };
  const pid = idx;
  const solo = usePlayerState<S>(`${game}-${listKey}`, pid, empty, coop ? null : room);
  const shared = useSharedBoard<S>(`${game}-${listKey}-coop`, pid, empty, coop ? room : null, (ev) => {
    if (ev.t === "cell") shared.setLocalState((s) => { const f = [...(s.fills || empty.fills)]; f[ev.i] = ev.ch; return { ...s, fills: f, startedAt: s.startedAt ?? Date.now() }; });
  });
  const state: S = coop ? { ...shared.state, fills: shared.state.fills || empty.fills } : solo.state;
  const others = coop ? {} : solo.others;
  const [cur, setCur] = useState(() => cw.grid.join("").indexOf(cw.grid.join("").replace(/#/g, "")[0]));
  const [dir, setDir] = useState<"across" | "down">("across");
  const [checked, setChecked] = useState(false);
  const [closed, setClosed] = useState(false);
  const [toast, showToast] = useToast();
  const saveTimer = useRef<number | null>(null);
  const done = !!state.finishedAt;
  const sol = cw.grid.join("");

  const nums = useMemo(() => { const m: Record<number, number> = {}; [...cw.across, ...cw.down].forEach((e) => (m[e.row * n + e.col] = e.n)); return m; }, [cw]);
  const entryAt = useCallback((i: number, d: "across" | "down") => {
    const r = Math.floor(i / n), c = i % n;
    return (d === "across" ? cw.across : cw.down).find((e) => d === "across" ? e.row === r && c >= e.col && c < e.col + e.answer.length : e.col === c && r >= e.row && r < e.row + e.answer.length);
  }, [cw]);
  const cellsOf = (e: Entry, d: "across" | "down") => Array.from({ length: e.answer.length }, (_, k) => d === "across" ? e.row * n + e.col + k : (e.row + k) * n + e.col);
  const active = entryAt(cur, dir) || entryAt(cur, dir === "across" ? "down" : "across");
  const activeDir = entryAt(cur, dir) ? dir : dir === "across" ? "down" : "across";
  const activeCells = new Set(active ? cellsOf(active, activeDir) : []);

  useEffect(() => { if (coop) shared.broadcastSelection([String(cur), activeDir]); }, [cur, activeDir]);

  function setCell(i: number, ch: string) {
    const fills = [...state.fills]; fills[i] = ch;
    const correct = fills.every((f, k) => sol[k] === "#" || f === sol[k]);
    const pct = Math.round((fills.filter((f, k) => sol[k] !== "#" && f === sol[k]).length / sol.replace(/#/g, "").length) * 100);
    const now = Date.now();
    const next: S = { ...state, fills, pct, startedAt: state.startedAt ?? now, finishedAt: correct ? now : undefined, won: correct || undefined };
    if (coop) {
      shared.send({ t: "cell", i, ch }); shared.setLocalState(() => next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (correct) shared.save(next); else saveTimer.current = window.setTimeout(() => shared.save(next), 800);
    } else solo.update(() => next);
    if (correct) { confetti(); bumpStreak(game); }
    else if (fills.every((f, k) => sol[k] === "#" || f)) showToast("Not quite — keep trying");
  }
  const move = (delta: number, d = activeDir) => {
    let i = cur; const step = d === "across" ? 1 : n;
    for (let k = 0; k < n * n; k++) { i += delta * step; if (i < 0 || i >= n * n) return; if (d === "across" && Math.floor(i / n) !== Math.floor(cur / n)) return; if (sol[i] !== "#") { setCur(i); return; } }
  };
  const press = (k: string) => {
    if (done) return;
    if (k === "back") { if (state.fills[cur]) setCell(cur, ""); else { move(-1); } return; }
    if (/^[a-z]$/.test(k)) { beep("tap"); setCell(cur, k.toUpperCase()); move(1); }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key;
      if (k === "ArrowRight") { setDir("across"); move(1, "across"); } else if (k === "ArrowLeft") { setDir("across"); move(-1, "across"); }
      else if (k === "ArrowDown") { setDir("down"); move(1, "down"); } else if (k === "ArrowUp") { setDir("down"); move(-1, "down"); }
      else if (k === "Backspace") press("back"); else if (k === " ") { e.preventDefault(); setDir((d) => (d === "across" ? "down" : "across")); }
      else if (k.length === 1) press(k.toLowerCase()); else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  });
  useEffect(() => {
    if (state.finishedAt && state.startedAt) recordResult({ room, game, puzzleId: idx, won: true, mistakes: 0, hints: checked ? 1 : 0, seconds: Math.round((state.finishedAt - state.startedAt) / 1000) });
  }, [state.finishedAt]);

  const cursors = coop ? Object.entries(shared.locks).map(([pl, v]) => ({ pl, i: Number(v[0]) })) : [];
  const clueList = (d: "across" | "down") => (d === "across" ? cw.across : cw.down).map((e) => {
    const on = active === e && activeDir === d;
    const solved = cellsOf(e, d).every((i) => state.fills[i] === sol[i]);
    return <li key={d + e.n} className={`${on ? "on" : ""} ${solved ? "solved" : ""}`} onClick={() => { setDir(d); setCur(e.row * n + e.col); }}><b>{e.n}</b> {e.clue}</li>;
  });

  return (
    <div className={`game crossword ${n >= 11 ? "wide" : ""}`}>
      <GameHeader title={title + (room ? (coop ? " · Co-op" : " · Versus") : "")} game={game} room={room} status={coop ? shared.status : solo.status} peers={coop ? shared.peers : Object.keys(others)} cap={coop ? CAPS.shared : CAPS.versus} />
      <div className="strands-status"><span className="muted">{cw.difficulty}</span><Timer startedAt={state.startedAt} finishedAt={state.finishedAt} /></div>
      <div className="cw-layout">
        <div>
          <div className="cw-clue-bar">{active ? <><b>{active.n}{activeDir === "across" ? "A" : "D"}</b> {active.clue}</> : "\u00a0"}</div>
          <div className="cw-grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
            {sol.split("").map((ch, i) => {
              if (ch === "#") return <div key={i} className="cw-cell block" />;
              const f = state.fills[i]; const wrong = checked && f && f !== ch;
              const peer = cursors.find((c) => c.i === i);
              return (
                <div key={i} className={`cw-cell ${i === cur ? "cur" : activeCells.has(i) ? "hl" : ""} ${wrong ? "wrong" : ""} ${done ? "done" : ""}`}
                  style={peer ? { boxShadow: `inset 0 0 0 3px ${playerColor(peer.pl)}` } : undefined}
                  onClick={() => { if (i === cur) setDir((d) => (d === "across" ? "down" : "across")); setCur(i); }}>
                  {nums[i] && <span className="num">{nums[i]}</span>}<span className="ch">{f}</span>
                  {peer && <span className="peer-tag" style={{ background: playerColor(peer.pl) }}>{peer.pl.slice(0, 1)}</span>}
                </div>
              );
            })}
          </div>
          <div className="controls"><button className="pill ghost" onClick={() => { setChecked(true); setTimeout(() => setChecked(false), 3000); }}>Check</button></div>
        </div>
        <div className="cw-clues"><div><h3>Across</h3><ol>{clueList("across")}</ol></div><div><h3>Down</h3><ol>{clueList("down")}</ol></div></div>
      </div>
      <div className="keyboard cw-kb">
        {["qwertyuiop", "asdfghjkl", "zxcvbnm-"].map((row) => (
          <div className="k-row" key={row}>{row.split("").map((k) => k === "-" ? <button key={k} className="key wide" onClick={() => press("back")}>⌫</button> : <button key={k} className="key" onClick={() => press(k)}>{k}</button>)}</div>
        ))}
      </div>
      {Object.keys(others).length > 0 && (
        <div className="leaderboard"><h3>Live standings</h3>
          {[["You", state] as [string, S], ...Object.entries(others)].sort((a, b) => (b[1].pct || 0) - (a[1].pct || 0)).map(([name, o], i) => (
            <div className="lb-row" key={name}><span className="lb-rank">{i + 1}</span><span className="avatar sm" style={{ background: playerColor(name) }}>{name[0].toUpperCase()}</span><span className="lb-name">{name}</span>
              <span className="lb-bar"><i style={{ width: `${o.pct || 0}%`, background: playerColor(name) }} /></span><span className="muted small">{o.pct || 0}%{o.finishedAt && o.startedAt ? ` · ${fmtTime(Math.round((o.finishedAt - o.startedAt) / 1000))}` : ""}</span></div>))}
        </div>)}
      {done && !closed && (
        <div className="modal-bg"><div className="modal"><button className="x" onClick={() => setClosed(true)}>×</button>
          <h2>Solved!</h2><p>{state.startedAt && state.finishedAt ? `Finished in ${fmtTime(Math.round((state.finishedAt - state.startedAt) / 1000))}` : ""}</p>
          <button className="pill" onClick={() => (location.hash = "/")}>Back to lobby</button></div></div>)}
      <Toast msg={toast} />
    </div>
  );
}
