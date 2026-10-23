import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { go } from "./lib/router";
import { fmtTime } from "./lib/daily";
import { getPlayer } from "./lib/player";
import { isActive } from "./lib/lobby";
import { ChipsBoard } from "./cards/ChipsBoard";

type Row = { player: string; game: string; puzzle_id: number; won: boolean; mistakes: number; hints: number; seconds: number; created_at: string; room_id: string | null; detail?: any };
const NAMES: Record<string, string> = { strands: "Mini Strands", wordle: "Wordle", connections: "Connections", crossword: "Crossword", mini: "The Mini", bee: "Spelling Bee", spywords: "Spy Words", blackjack: "Blackjack", spades: "Spades" };
const CARD_GAMES = ["blackjack", "spades"];
const spyLabel = (r: Row) => { const d = r.detail || {}; const w = d.mode === "duet" ? (d.winner === "team" ? "Agents won" : "Agents lost") : `${d.winner === "red" ? "Red" : "Blue"} won`; return `${d.mode === "duet" ? "Duo" : "Classic"} · ${w} · ${d.turns ?? r.hints} turns${d.role ? ` · ${d.team ? d.team + " " : ""}${d.role}` : ""}`; };

export default function History({ params }: { params: URLSearchParams }) {
  const room = params.get("room");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mine, setMine] = useState(false);
  useEffect(() => {
    if (!supabase) { setRows((JSON.parse(localStorage.getItem("gm_history") || "[]") as any[]).map((r) => ({ player: r.player, game: r.game, puzzle_id: r.puzzleId, won: r.won, mistakes: r.mistakes, hints: r.hints, seconds: r.seconds, created_at: new Date(r.at).toISOString(), room_id: r.room }))); return; }
    let q = supabase.from("results").select("*").order("created_at", { ascending: false }).limit(200);
    if (room) q = q.eq("room_id", room); else if (mine) q = q.eq("player", getPlayer());
    q.then(({ data }) => setRows((data as Row[]) || []));
  }, [room, mine]);

  const games = ["strands", "wordle", "connections", "crossword", "mini", "bee"].filter(isActive);
  const board = (g: string) => (rows || []).filter((r) => r.game === g && r.won).sort((a, b) => a.seconds - b.seconds || a.mistakes - b.mistakes).slice(0, 10);
  const perPlayer = Object.values((rows || []).filter((r) => !CARD_GAMES.includes(r.game)).reduce((m: Record<string, { player: string; played: number; wins: number; total: number }>, r) => {
    const x = (m[r.player] ||= { player: r.player, played: 0, wins: 0, total: 0 }); x.played++; if (r.won) { x.wins++; x.total += r.seconds; } return m; }, {}));

  return (
    <div className="page">
      <header className="game-header"><button className="back" onClick={() => go("/")}>‹ Games</button><h1>{room ? "Session history" : "History & leaderboard"}</h1>
        <div className="room-bar">{room ? <span className="muted">Session {room}</span> : <label className="muted"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only me ({getPlayer() || "no name set"})</label>}</div></header>
      {!room && <ChipsBoard />}
      {!rows ? <p className="center muted">Loading…</p> : rows.length === 0 ? <p className="center muted">No games recorded yet.</p> : (<>
        <h2 className="section">Players</h2>
        <table className="tbl"><thead><tr><th>Player</th><th>Played</th><th>Wins</th><th>Avg win time</th></tr></thead>
          <tbody>{perPlayer.map((p) => <tr key={p.player}><td>{p.player}</td><td>{p.played}</td><td>{p.wins}</td><td>{p.wins ? fmtTime(Math.round(p.total / p.wins)) : "—"}</td></tr>)}</tbody></table>
        <div className="boards">{games.map((g) => (
          <div key={g}><h2 className="section">{NAMES[g]} — fastest</h2>
            <table className="tbl"><tbody>{board(g).map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.player}</td><td>#{r.puzzle_id + 1}</td><td>{fmtTime(r.seconds)}</td><td className="muted">{g === "wordle" ? `${r.mistakes}/6` : g === "connections" ? `${r.mistakes} mistakes` : `${r.hints} hints`}</td></tr>)}
              {board(g).length === 0 && <tr><td className="muted">No wins yet</td></tr>}</tbody></table></div>))}</div>
        <h2 className="section">All games</h2>
        <table className="tbl"><thead><tr><th>When</th><th>Player</th><th>Game</th><th>Result</th><th>Time</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td className="muted">{new Date(r.created_at).toLocaleString()}</td><td>{r.player}</td><td>{r.game === "spywords" ? <>{NAMES[r.game]} <span className="muted small">{spyLabel(r)}</span></> : CARD_GAMES.includes(r.game) ? <>{NAMES[r.game]} <span className="muted small">hand {r.puzzle_id}</span></> : <>{NAMES[r.game]} #{r.puzzle_id + 1}</>}</td><td>{CARD_GAMES.includes(r.game) && r.detail?.net !== undefined ? (r.detail.net > 0 ? `✅ +${r.detail.net}` : r.detail.net < 0 ? `❌ ${r.detail.net}` : "➖ push") : r.won ? "✅ Won" : "❌ Lost"}</td><td>{fmtTime(r.seconds)}</td></tr>)}</tbody></table>
      </>)}
    </div>
  );
}
