import { useEffect, useRef, useState } from "react";
import data from "../data/connections.json";
import { useSharedBoard, recordResult } from "../lib/shared";
import { PuzzleBar, GameHeader, Timer, Toast, useToast, usePuzzle } from "./common";
import { ensurePlayer } from "../lib/player";
import { fmtTime } from "../lib/daily";
import { confetti, beep, playerColor } from "../lib/fx";
import { FitText } from "../lib/FitText";
import { supabase } from "../lib/supabase";

type Group = { level: number; category: string; words: string[] };
type Puzzle = { id?: number; gen?: number; groups: Group[] };
// @ts-ignore - plain JS generator shared with scripts/
import { makePuzzle } from "../../scripts/connectionsGen.mjs";
import { dayIndex } from "../lib/daily";
// Curated list, extended deterministically so a fresh puzzle set appears every week even without a redeploy.
const base = data as Puzzle[];
const PUZZLES: Puzzle[] = [...base];
for (let id = base.length + 1; PUZZLES.length < dayIndex() + 14; id++) PUZZLES.push(makePuzzle(id) as Puzzle);
import medium from "../data/connections-medium.json";
import hard from "../data/connections-hard.json";
const LISTS: Record<string, Puzzle[]> = { easy: PUZZLES, medium: medium as Puzzle[], hard: hard as Puzzle[] };
type S = { sel?: { w: string; p: string }[]; solved: number[]; mistakes: number; guesses: string[]; startedAt?: number; finishedAt?: number; won?: boolean; last?: { by: string; ok: boolean; oneAway?: boolean; at: number } };
const MAX_MISTAKES = 4;
const COLORS = ["#f9df6d", "#a0c35a", "#b0c4ef", "#ba81c5"]; // NYT yellow, green, blue, purple

export default function ConnectionsPage({ params }: { params: URLSearchParams }) {
  const d = LISTS[params.get("d") || "easy"] ? params.get("d") || "easy" : "easy";
  const { idx, item } = usePuzzle<Puzzle>(LISTS[d], params, 0);
  if (idx === null || !item) return <p className="center muted">Loading puzzle…</p>;
  return <Connections key={d + idx} idx={idx} d={d} puzzle={item} room={params.get("room")} />;
}

function seededShuffle<T>(a: T[], seed: number) { const r = [...a]; let s = seed; for (let i = r.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; }

function Connections({ idx, d, puzzle, room }: { idx: number; d: string; puzzle: Puzzle; room: string | null }) {
  useEffect(() => { if (room) ensurePlayer(); }, [room]);
  const init: S = { solved: [], mistakes: 0, guesses: [] };
  const { state, commit, status, peers, me, setLocalState, applyServer } = useSharedBoard<S>("connections-" + d + (puzzle.gen === 2 ? "-v2" : ""), idx, init, room); // v2 content gets fresh saved state
  const solved = state.solved || [];
  const [order, setOrder] = useState(() => seededShuffle(puzzle.groups.flatMap((g) => g.words), idx + 1));
  const [localSel, setLocalSel] = useState<string[]>([]);
  // Co-op: ONE shared selection (max 4) stored in rooms.state.sel, toggled atomically server-side.
  const shared = !!room && !!supabase;
  const sel = shared ? (state.sel || []).map((x) => x.w) : localSel;
  const selBy = new Map((state.sel || []).map((x) => [x.w, x.p] as [string, string]));
  const setSel = (fn: (s: string[]) => string[]) => {
    if (!shared) return setLocalSel(fn);
    const next = fn(sel); if (next.length === 0 && sel.length) { supabase!.rpc("clear_selection", { p_room: room }).then(({ data }) => applyServer(data)); }
  };
  const [shake, setShake] = useState(false);
  const [jump, setJump] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const [toast, showToast] = useToast();
  const lastSeen = useRef(0);
  const done = !!state.finishedAt;

  const solvedWords = new Set(solved.flatMap((g) => puzzle.groups[g].words));
  const remaining = order.filter((w) => !solvedWords.has(w));

  useEffect(() => { if (!shared) setLocalSel((s) => s.filter((w) => !solvedWords.has(w))); }, [solved.length]);
  useEffect(() => { // feedback for a teammate's guess
    const l = state.last; if (!l || l.at <= lastSeen.current) return; lastSeen.current = l.at;
    if (l.by !== me) showToast(l.ok ? `${l.by} found a group!` : l.oneAway ? `${l.by}: one away…` : `${l.by} made a mistake`);
  }, [state.last?.at]);
  useEffect(() => {
    if (state.finishedAt && Date.now() - state.finishedAt < 15000) { if (state.won) confetti(); else beep("bad"); }
    if (state.finishedAt && state.startedAt) recordResult({ room, game: "connections", puzzleId: idx, won: !!state.won, mistakes: state.mistakes, hints: 0, seconds: Math.round((state.finishedAt - state.startedAt) / 1000) });
  }, [state.finishedAt]);

  const toggle = (w: string) => {
    if (done || busy) return;
    beep("tap");
    if (!shared) return setLocalSel((s) => (s.includes(w) ? s.filter((x) => x !== w) : s.length < 4 ? [...s, w] : s));
    // optimistic local toggle, then the authoritative result from the server (row-locked toggle)
    setLocalState((s) => { const cur = s.sel || []; const has = cur.some((x) => x.w === w);
      return { ...s, sel: has ? cur.filter((x) => x.w !== w) : cur.length < 4 ? [...cur, { w, p: me }] : cur }; });
    supabase!.rpc("toggle_selection", { p_room: room, p_word: w, p_player: me }).then(({ data }) => applyServer(data));
  };

  async function submit() {
    if (sel.length !== 4 || busy) return;
    const k = [...sel].sort().join("|");
    if ((state.guesses || []).includes(k)) { showToast("Already guessed!"); return; }
    const gi = puzzle.groups.findIndex((g) => sel.every((w) => g.words.includes(w)));
    setBusy(true);
    setJump(true); await new Promise((r) => setTimeout(r, 650)); setJump(false);
    let used = sel;
    const ok = await commit((s) => {
      const cur = { ...init, ...s }; const now = Date.now();
      if (shared) { const ss = (cur.sel || []).map((x) => x.w); if (ss.length !== 4 || ss.slice().sort().join("|") !== k) return cur; used = ss; cur.sel = []; }
      if (cur.finishedAt || sel.some((w) => cur.solved.some((g) => puzzle.groups[g].words.includes(w)))) return cur;
      const guesses = [...cur.guesses, k];
      if (gi >= 0) {
        const solvedN = [...cur.solved, gi]; const fin = solvedN.length === 4;
        return { ...cur, solved: solvedN, guesses, startedAt: cur.startedAt ?? now, finishedAt: fin ? now : undefined, won: fin || undefined, last: { by: me, ok: true, at: now } };
      }
      const oneAway = puzzle.groups.some((g) => sel.filter((w) => g.words.includes(w)).length === 3);
      const mistakes = cur.mistakes + 1; const lost = mistakes >= MAX_MISTAKES;
      return { ...cur, mistakes, guesses, startedAt: cur.startedAt ?? now, finishedAt: lost ? now : undefined, won: lost ? false : undefined,
        solved: lost ? [...cur.solved, ...[0, 1, 2, 3].filter((x) => !cur.solved.includes(x))] : cur.solved, last: { by: me, ok: false, oneAway, at: now } };
    });
    setBusy(false);
    if (!ok) { showToast("Someone else just guessed — try again"); return; }
    void used;
    if (gi >= 0) { if (!shared) setLocalSel([]); beep("good"); }
    else { if (shared) supabase!.rpc("clear_selection", { p_room: room }).then(({ data }) => applyServer(data)); beep("bad"); setShake(true); setTimeout(() => setShake(false), 500); showToast(puzzle.groups.some((g) => sel.filter((w) => g.words.includes(w)).length === 3) ? "One away..." : "Not quite"); }
  }

  return (
    <div className="game connections">
      <GameHeader title={`Connections · ${d}`} game="connections" puzzleId={idx} room={room} status={status} peers={peers} />
      <PuzzleBar room={room} pool={{ key: `connections-${d}${puzzle.gen === 2 && idx < 100000 ? "-v2" : ""}`, size: LISTS[d].length, current: idx, done }} />
      <div className="strands-status"><span className="muted">Create four groups of four!</span><Timer startedAt={state.startedAt} finishedAt={state.finishedAt} /></div>
      <div className="c-board">
        {solved.map((g) => { const G = puzzle.groups[g]; return (
          <div key={g} className="c-bar" style={{ background: COLORS[G.level] }}><b><FitText text={G.category.toUpperCase()} max={16} min={10} /></b><span><FitText text={G.words.join(", ")} max={14} min={9} /></span></div>); })}
        <div className="c-grid">
          {remaining.map((w) => {
            const s = sel.includes(w); const by = shared ? selBy.get(w) : undefined;
            return <button key={w} style={s && jump ? { animationDelay: `${sel.indexOf(w) * 90}ms` } : undefined} className={`c-tile ${s ? "sel" : ""} ${s && shake ? "shake" : ""} ${s && jump ? "jump" : ""}`}
              onClick={() => toggle(w)} title={by ? `Selected by ${by}` : undefined}><FitText text={w} max={15} min={10} />{by && <i className="sel-dot" style={{ background: playerColor(by) }} />}</button>;
          })}
        </div>
      </div>
      <div className="mistakes">Mistakes remaining: {Array.from({ length: MAX_MISTAKES }).map((_, i) => <span key={i} className={`m-dot ${i < MAX_MISTAKES - (state.mistakes || 0) ? "" : "used"}`} />)}</div>
      <div className="controls">
        <button className="pill ghost" disabled={done} onClick={() => setOrder((o) => seededShuffle(o, Date.now() & 0xffff))}>Shuffle</button>
        <button className="pill ghost" disabled={!sel.length || done} onClick={() => setSel(() => [])}>Deselect all</button>
        <button className="pill" disabled={sel.length !== 4 || busy || done} onClick={submit}>Submit</button>
      </div>
      {room && <p className="muted small center">Shared board: everyone edits one selection (the dot shows who picked each tile); anyone can submit once 4 are chosen; one guess is evaluated at a time and mistakes are shared.</p>}
      {done && !closed && (
        <div className="modal-bg" style={{ animationDelay: "1s" }}><div className="modal">
          <button className="x" onClick={() => setClosed(true)}>×</button>
          <h2>{state.won ? "Perfect!" : "Next time!"}</h2>
          <p>{state.won ? `Solved with ${state.mistakes} mistake${state.mistakes === 1 ? "" : "s"}` : "Out of mistakes"}{state.startedAt && state.finishedAt ? ` · ${fmtTime(Math.round((state.finishedAt - state.startedAt) / 1000))}` : ""}</p>
          <pre className="share">{`Game Lobby Connections #${idx + 1}\n`}{(state.guesses || []).map((g) => g.split("|").map((w) => ["🟨", "🟩", "🟦", "🟪"][puzzle.groups.find((G) => G.words.includes(w))!.level]).join("")).join("\n")}</pre>
          <button className="pill" onClick={() => (location.hash = "/")}>Back to games</button>
        </div></div>
      )}
      <Toast msg={toast} />
    </div>
  );
}
