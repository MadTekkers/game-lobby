import { useEffect, useState } from "react";
import { go } from "./lib/router";
import { GAME_META, type GameId } from "./lib/lobby";
import { DAYS, WEEKLY_BASE, thisWeek, todayDay, useWeeks, weekLabel, weekRows } from "./lib/weekly";
import { getPlayed } from "./lib/refresh";

const COLS: { game: GameId; d: string; label: string }[] = [
  { game: "wordle", d: "", label: "Wordle" },
  { game: "connections", d: "easy", label: "Connections · easy" },
  { game: "connections", d: "medium", label: "Connections · medium" },
  { game: "connections", d: "hard", label: "Connections · hard" },
  { game: "strands", d: "", label: "Mini Strands" },
  { game: "mini", d: "", label: "The Mini" },
  { game: "bee", d: "", label: "Spelling Bee" },
];
type Meta = Awaited<ReturnType<typeof weekRows>>[number];
const poolKeys = (g: string, d: string) => (g === "connections" ? [`connections-${d}`] : g === "mini" ? ["mini-easy", "mini-medium", "mini-hard"] : [g]);

function Week({ wk }: { wk: string }) {
  const [rows, setRows] = useState<Meta[] | null>(null);
  useEffect(() => { setRows(null); weekRows(wk).then(setRows); }, [wk]);
  if (!rows) return <p className="muted">Loading…</p>;
  const isCur = wk === thisWeek();
  return (
    <div className="archive-wrap"><table className="archive">
      <thead><tr><th />{DAYS.map((d, i) => <th key={d} className={isCur && i === todayDay() ? "today" : ""}>{d}</th>)}</tr></thead>
      <tbody>{COLS.map((c) => (
        <tr key={c.label}><th>{c.label}</th>{DAYS.map((_, i) => {
          const r = rows.find((x) => x.game === c.game && x.difficulty === (c.game === "connections" ? c.d : "") && x.day === i);
          if (!r) return <td key={i} className="muted">—</td>;
          const p = WEEKLY_BASE + r.id; const future = isCur && i > todayDay();
          const played = poolKeys(c.game, c.d).some((k) => !!getPlayed(k)[p]);
          const q = `p=${p}&wk=${wk}&day=${i}${c.d ? `&d=${c.d}` : ""}`;
          return <td key={i}>{future ? <span className="muted small">🔒</span> : <span className="arch-cell">
            <button className={`pill sm ${played ? "ghost" : ""}`} title={`${GAME_META[c.game].name} · ${DAYS[i]}`} onClick={() => go(`/${c.game}?mode=solo&${q}`)}>{played ? "✓" : "Play"}</button>
            <button className="pill ghost sm" title="Play with friends" onClick={() => go(`/play/${c.game}?${q}`)}>👥</button></span>}</td>;
        })}</tr>))}</tbody>
    </table></div>
  );
}

export default function Archive() {
  const weeks = useWeeks();
  const [wk, setWk] = useState<string | null>(null);
  const sel = wk || weeks?.[0] || null;
  return (
    <div className="page archive-page">
      <header className="game-header"><button className="back" onClick={() => go("/")}>‹ Lobby</button><h1>Puzzle archive</h1><div className="room-bar" /></header>
      <p className="muted">Fresh puzzles every week (Monday–Sunday). Pick any week and day — ▶ Play solo or 👥 set up a game with friends.</p>
      {!weeks ? <p className="muted">Loading weeks…</p> : !weeks.length ? <p className="muted">No weekly puzzles yet.</p> : (<>
        <div className="seg weeks">{weeks.map((w, i) => <button key={w} className={sel === w ? "on" : ""} onClick={() => setWk(w)}>{i === 0 ? "This week" : weekLabel(w).replace("Week of ", "")}</button>)}</div>
        <h2 className="section">{sel && weekLabel(sel)}</h2>
        {sel && <Week wk={sel} />}
      </>)}
    </div>
  );
}
