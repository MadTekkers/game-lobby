// Spy Words client: public game state comes from spy_games (realtime); all moves are RPCs authenticated by a per-seat token.
// The key is never in spy_games during play; spymasters (classic) / agents (duet) fetch only what they may see via spy_key.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getPlayer } from "../../lib/player";
export { ERRORS, errText, clueProblem } from "./rules";

export type Team = "red" | "blue";
export type Side = "A" | "B";
export type Color = "red" | "blue" | "neutral" | "assassin" | "green";
export type Seat = { name: string; team: Team | Side | null; spy: boolean };
export type DuetCell = { g?: boolean; nA?: boolean; nB?: boolean; x?: boolean };
export type LogEntry = { team: Team | Side | "sudden"; by: string; word: string | null; n: number; guesses: { idx: number; word: string; color: Color; by: string }[] };
export type SpyGame = {
  room_id: string; mode: "classic" | "duet"; host: string; phase: "setup" | "clue" | "guess" | "sudden" | "over";
  seats: Seat[]; words: string[] | null; revealed: (Color | null)[] | DuetCell[]; turn: string | null; start_team: string | null;
  clue: { word: string; n: number; by: string; team: string } | null; guesses_left: number; guesses_made: number; log: LogEntry[];
  turns: number; turns_left: number | null; winner: string | null; reason: string | null;
  key_reveal: Color[] | { A: Color[]; B: Color[] } | null; game_no: number; started_at: string | null; finished_at: string | null; version: number;
};


const tokKey = (room: string, me: string) => `sw_tok_${room}_${me}`;

export function useSpyWords(room: string) {
  const me = getPlayer() || "Anonymous";
  const [g, setG] = useState<SpyGame | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [joinErr, setJoinErr] = useState("");
  const [key, setKey] = useState<Color[] | null>(null);
  const [pointers, setPointers] = useState<Record<string, number | null>>({});
  const [peers, setPeers] = useState<string[]>([]);
  const [status, setStatus] = useState("connecting");
  const ver = useRef(-1); const chRef = useRef<any>(null);
  const apply = useCallback((row: SpyGame | null) => { if (row && row.version >= ver.current) { ver.current = row.version; setG(row); } }, []);
  const refresh = useCallback(async () => { if (!supabase) return; const { data } = await supabase.from("spy_games").select("*").eq("room_id", room).maybeSingle(); apply(data as SpyGame); }, [room, apply]);

  const join = useCallback(async () => {
    if (!supabase) { setJoinErr("Multiplayer is offline."); return; }
    const { data, error } = await supabase.rpc("spy_join", { p_room: room, p_player: me, p_token: localStorage.getItem(tokKey(room, me)) });
    if (error) { setJoinErr(error.message); return; }
    localStorage.setItem(tokKey(room, me), data as string); setToken(data as string); setJoinErr(""); refresh();
  }, [room, me, refresh]);

  useEffect(() => {
    if (!supabase) { setStatus("offline"); return; }
    const sb = supabase;
    const ch = sb.channel(`spy-${room}`, { config: { presence: { key: me } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "spy_games", filter: `room_id=eq.${room}` }, (p: any) => apply(p.new as SpyGame))
      .on("broadcast", { event: "point" }, ({ payload }: any) => setPointers((x) => ({ ...x, [payload.player]: payload.idx })))
      .on("presence", { event: "sync" }, () => { const ps = Object.keys(ch.presenceState()); setPeers(ps.filter((p) => p !== me)); setPointers((x) => Object.fromEntries(Object.entries(x).filter(([k]) => ps.includes(k)))); })
      .subscribe(async (s) => {
        setStatus(s === "SUBSCRIBED" ? "live" : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "offline" : "connecting");
        if (s === "SUBSCRIBED") { await ch.track({ at: Date.now() }); refresh(); }
      });
    chRef.current = ch; join();
    const poll = setInterval(refresh, 15000); // safety net if a realtime event is missed (phones sleeping)
    const vis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { sb.removeChannel(ch); chRef.current = null; clearInterval(poll); document.removeEventListener("visibilitychange", vis); };
  }, [room, me]);

  const mySeat = g?.seats.find((s) => s.name === me) || null;
  const canSeeKey = !!g && g.phase !== "setup" && !!mySeat && (g.mode === "classic" ? mySeat.spy : mySeat.team === "A" || mySeat.team === "B");
  // fetch my key (only if this seat may see it); refetch per game
  useEffect(() => {
    setKey(null);
    if (!supabase || !token || !canSeeKey) return;
    supabase.rpc("spy_key", { p_room: room, p_token: token }).then(({ data, error }) => { if (!error) setKey(data as Color[]); });
  }, [room, token, canSeeKey, g?.game_no]);
  // clear pointers whenever the turn changes
  useEffect(() => { setPointers({}); }, [g?.turns, g?.phase === "sudden", g?.game_no]);

  const call = useCallback(async (fn: string, args: Record<string, unknown> = {}): Promise<{ data?: any; error?: string }> => {
    if (!supabase || !token) return { error: "Not connected" };
    const { data, error } = await supabase.rpc(fn, { p_room: room, p_token: token, ...args });
    if (error?.message === "not_seated") { localStorage.removeItem(tokKey(room, me)); join(); }
    refresh();
    return error ? { error: error.message } : { data };
  }, [room, token, me, join, refresh]);

  const point = useCallback((idx: number | null) => {
    setPointers((x) => ({ ...x, [me]: idx }));
    chRef.current?.send({ type: "broadcast", event: "point", payload: { player: me, idx } });
  }, [me]);

  return { g, me, mySeat, key, token, joinErr, join, call, point, pointers, peers, status };
}

