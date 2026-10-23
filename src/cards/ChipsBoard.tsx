import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { getPlayer } from "../lib/player";

type B = { player: string; chips: number; peak: number; hands: number; rebuys: number };
/** Play-money leaderboard for the card games (bankrolls are written only by the server). */
export function ChipsBoard() {
  const [rows, setRows] = useState<B[] | null>(null);
  useEffect(() => { supabase?.from("bankrolls").select("player,chips,peak,hands,rebuys").gt("hands", 0).order("chips", { ascending: false }).limit(15).then(({ data }) => setRows((data as B[]) || [])); }, []);
  if (!rows?.length) return null;
  const me = getPlayer();
  return (<>
    <h2 className="section">🪙 Card table chips — leaderboard</h2>
    <table className="tbl"><thead><tr><th>#</th><th>Player</th><th>Chips</th><th>Peak</th><th>Hands</th><th>Top-ups</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.player} style={r.player === me ? { fontWeight: 700 } : undefined}><td>{i + 1}</td><td>{r.player}</td><td>{r.chips.toLocaleString()}</td><td className="muted">{r.peak.toLocaleString()}</td><td className="muted">{r.hands}</td><td className="muted">{r.rebuys}</td></tr>)}</tbody></table>
  </>);
}
