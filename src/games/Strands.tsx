import { useEffect, useRef, useState } from "react";
import { puzzles, matchWord, adjacent, key, ROWS, COLS, type Cell, type StrandsPuzzle } from "./strandsLogic";
import { usePlayerState, recordResult } from "../lib/shared";
import { GameHeader, Timer, Toast, useToast, usePuzzleIndex } from "./common";
import { ensurePlayer } from "../lib/player";
import { fmtTime } from "../lib/daily";

type S = { found: string[]; hints: string[]; startedAt?: number; finishedAt?: number; won?: boolean };
const MAX_HINTS = 3;

export default function StrandsPage({ params }: { params: URLSearchParams }) {
  const idx = usePuzzleIndex(puzzles.length, params);
  if (idx === null) return <p className="center muted">Loading puzzle…</p>;
  return <Strands key={idx} idx={idx} p={puzzles[idx]} room={params.get("room")} />;
}

function Strands({ idx, p, room }: { idx: number; p: StrandsPuzzle; room: string | null }) {
  useEffect(() => { if (room) ensurePlayer(); }, [room]);
  const { state, update, others, status } = usePlayerState<S>("strands", idx, { found: [], hints: [] }, room);
  const [path, setPath] = useState<Cell[]>([]);
  const [shake, setShake] = useState(false);
  const [pop, setPop] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const [closed, setClosed] = useState(false);
  const dragging = useRef(false); const moved = useRef(false);
  const total = p.words.length + 1;

  const owner = new Map<string, string>();
  for (const w of state.found) for (const c of p.paths[w]) owner.set(key(c), w);
  const hinted = new Set<string>();
  for (const w of state.hints) if (!state.found.includes(w)) p.paths[w].forEach((c) => hinted.add(key(c)));
  const done = !!state.finishedAt;

  function submit(cur: Cell[]) {
    setPath([]);
    if (cur.length < 3) { if (cur.length > 1) showToast("Too short"); return; }
    const w = matchWord(p, cur);
    if (!w) { setShake(true); setTimeout(() => setShake(false), 450); showToast("Not in word list"); return; }
    if (state.found.includes(w)) { showToast("Already found"); return; }
    setPop(w); setTimeout(() => setPop(null), 700);
    showToast(w === p.spangram ? "SPANGRAM!" : "Nice!");
    update((s) => {
      const found = [...s.found, w]; const now = Date.now();
      const fin = found.length === total;
      return { ...s, found, startedAt: s.startedAt ?? now, finishedAt: fin ? now : undefined, won: fin || undefined };
    });
  }
  useEffect(() => {
    if (state.finishedAt && state.startedAt) recordResult({ room, game: "strands", puzzleId: idx, won: true, mistakes: 0, hints: state.hints.length, seconds: Math.round((state.finishedAt - state.startedAt) / 1000) });
  }, [state.finishedAt]);

  function cellFromPoint(x: number, y: number): Cell | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const d = el?.closest("[data-cell]") as HTMLElement | null;
    if (!d) return null; const [r, c] = d.dataset.cell!.split(",").map(Number); return [r, c];
  }
  function extend(c: Cell, cur: Cell[]): Cell[] {
    if (owner.has(key(c))) return cur;
    const i = cur.findIndex((x) => key(x) === key(c));
    if (i >= 0) return cur.slice(0, i + 1); // backtrack
    if (cur.length === 0 || adjacent(cur[cur.length - 1], c)) return [...cur, c];
    return [c];
  }
  const onDown = (e: React.PointerEvent) => {
    if (done) return; const c = cellFromPoint(e.clientX, e.clientY); if (!c || owner.has(key(c))) return;
    e.preventDefault(); dragging.current = true; moved.current = false;
    if (path.length && key(path[path.length - 1]) === key(c)) { dragging.current = false; submit(path); return; } // tap last letter again = submit
    setPath((cur) => extend(c, cur));
    if (!state.startedAt) update((s) => ({ ...s, startedAt: s.startedAt ?? Date.now() }));
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return; const c = cellFromPoint(e.clientX, e.clientY); if (!c) return;
    setPath((cur) => { const n = extend(c, cur); if (n.length !== cur.length) moved.current = true; return n; });
  };
  const onUp = () => { if (dragging.current && moved.current) submit(path); dragging.current = false; };

  const useHint = () => {
    if (state.hints.length >= MAX_HINTS) return;
    const next = [...p.words, p.spangram].find((w) => !state.found.includes(w) && !state.hints.includes(w));
    if (next) update((s) => ({ ...s, hints: [...s.hints, next], startedAt: s.startedAt ?? Date.now() }));
  };

  const cellPx = 100 / COLS, rowPx = 100 / ROWS;
  const center = (c: Cell) => [c[1] * cellPx + cellPx / 2, c[0] * rowPx + rowPx / 2];
  const lines = (cells: Cell[], cls: string, k: string) => cells.slice(1).map((c, i) => { const [x1, y1] = center(cells[i]); const [x2, y2] = center(c); return <line key={k + i} x1={x1} y1={y1} x2={x2} y2={y2} className={cls} />; });
  const word = path.map(([r, c]) => p.grid[r][c]).join("");

  return (
    <div className="game strands">
      <GameHeader title="Mini Strands" game="strands" puzzleId={idx} room={room} status={status} peers={Object.keys(others)} />
      <div className="theme-card"><div className="label">TODAY'S THEME</div><div className="theme">{p.clue}</div></div>
      <div className="strands-status">
        <span><b>{state.found.length}</b> of <b>{total}</b> theme words found</span>
        <Timer startedAt={state.startedAt} finishedAt={state.finishedAt} />
      </div>
      <div className={`current-word ${shake ? "shake" : ""}`}>{word || "\u00a0"}</div>
      <div className="strands-board" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} style={{ touchAction: "none" }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="strands-lines">
          {state.found.map((w) => lines(p.paths[w], w === p.spangram ? "ln span" : "ln found", w))}
          {lines(path, "ln sel", "sel")}
        </svg>
        {Array.from({ length: ROWS }).map((_, r) => Array.from({ length: COLS }).map((_, c) => {
          const k = `${r},${c}`; const w = owner.get(k); const sel = path.some((x) => key(x) === k);
          const cls = ["s-cell", w ? (w === p.spangram ? "span" : "found") : "", sel ? "sel" : "", hinted.has(k) ? "hint" : "", w && pop === w ? "pop" : ""].join(" ");
          return <div key={k} data-cell={k} className={cls} style={{ gridRow: r + 1, gridColumn: c + 1 }}>{p.grid[r][c]}</div>;
        }))}
      </div>
      <div className="controls">
        <button className="pill ghost" onClick={useHint} disabled={done || state.hints.length >= MAX_HINTS}>Hint ({MAX_HINTS - state.hints.length} left)</button>
        <button className="pill ghost" onClick={() => setPath([])} disabled={!path.length}>Clear</button>
        <button className="pill" onClick={() => submit(path)} disabled={path.length < 3}>Submit</button>
      </div>
      <p className="muted small center">Drag across letters, or tap letters and tap the last one again to submit. Diagonals count. The <span className="span-txt">spangram</span> touches two opposite sides.</p>
      {Object.entries(others).length > 0 && (
        <div className="opponents">
          {Object.entries(others).map(([name, o]) => (
            <div className="opp" key={name}>
              <div className="opp-name">{name}</div>
              <div className="opp-mini strands-mini">
                {Array.from({ length: ROWS * COLS }).map((_, i) => {
                  const r = Math.floor(i / COLS), c = i % COLS; const w = (o.found || []).find((fw) => p.paths[fw]?.some((x) => x[0] === r && x[1] === c));
                  return <i key={i} className={w ? (w === p.spangram ? "span" : "found") : ""} />;
                })}
              </div>
              <div className="muted small">{(o.found || []).length}/{total} found{o.finishedAt && o.startedAt ? ` · done in ${fmtTime(Math.round((o.finishedAt - o.startedAt) / 1000))}` : ""}</div>
            </div>
          ))}
        </div>
      )}
      {done && !closed && (
        <div className="modal-bg"><div className="modal">
          <button className="x" onClick={() => setClosed(true)}>×</button>
          <h2>Perfect!</h2>
          <p>You found all {total} theme words{state.startedAt && state.finishedAt ? ` in ${fmtTime(Math.round((state.finishedAt - state.startedAt) / 1000))}` : ""} using {state.hints.length} hint{state.hints.length === 1 ? "" : "s"}.</p>
          <p className="muted">Theme: {p.theme} · Spangram: <span className="span-txt">{p.spangram}</span></p>
          <div className="found-list">{state.found.map((w) => <span key={w} className={w === p.spangram ? "chip span" : "chip"}>{w}</span>)}</div>
          <button className="pill" onClick={() => (location.hash = "/")}>Back to games</button>
        </div></div>
      )}
      <Toast msg={toast} />
    </div>
  );
}
