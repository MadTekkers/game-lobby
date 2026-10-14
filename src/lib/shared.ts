import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { getPlayer } from "./player";

export type Base = { startedAt?: number; finishedAt?: number; won?: boolean };
type Status = "solo" | "connecting" | "live" | "offline";

async function ensureRoom(room: string, game: string, puzzleId: number, state: unknown = {}) {
  if (!supabase) return;
  await supabase.from("rooms").upsert({ id: room, game, puzzle_id: puzzleId, state }, { onConflict: "id", ignoreDuplicates: true });
}

/** Wordle / Strands: each player plays independently; own progress is stored per player and others' progress is streamed live. */
export function usePlayerState<S extends Base>(game: string, puzzleId: number, initial: S, room: string | null) {
  const me = getPlayer() || "Anonymous";
  const lsKey = `gm_${game}_${room ?? "solo"}_${puzzleId}`;
  const [state, setLocal] = useState<S>(() => { try { const v = localStorage.getItem(lsKey); return v ? JSON.parse(v) : initial; } catch { return initial; } });
  const [others, setOthers] = useState<Record<string, S>>({});
  const [status, setStatus] = useState<Status>(room ? "connecting" : "solo");
  const ref = useRef(state); ref.current = state;
  useEffect(() => { localStorage.setItem(lsKey, JSON.stringify(state)); }, [lsKey, state]);

  useEffect(() => {
    if (!room) return;
    if (!supabase) { setStatus("offline"); return; }
    const sb = supabase; let cancelled = false;
    (async () => {
      await ensureRoom(room, game, puzzleId);
      await sb.from("room_players").upsert({ room_id: room, player: me, state: ref.current });
      const { data } = await sb.from("room_players").select("player,state").eq("room_id", room);
      if (cancelled || !data) return;
      const o: Record<string, S> = {};
      for (const r of data) if (r.player !== me) o[r.player] = r.state as S;
      setOthers(o);
    })();
    const ch = sb.channel(`players-${room}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${room}` }, (p: any) => {
        const r = p.new; if (!r || r.player === me) return;
        setOthers((o) => ({ ...o, [r.player]: r.state as S }));
      })
      .subscribe((s) => setStatus(s === "SUBSCRIBED" ? "live" : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "offline" : "connecting"));
    return () => { cancelled = true; sb.removeChannel(ch); };
  }, [room, game, puzzleId, me]);

  const update = useCallback((fn: (s: S) => S) => {
    const next = fn(ref.current); ref.current = next; setLocal(next);
    if (room && supabase) supabase.from("room_players").upsert({ room_id: room, player: me, state: next, updated_at: new Date().toISOString() }).then();
  }, [room, me]);
  return { state, update, others, status, me };
}

/** Connections: one shared authoritative board in rooms.state, guarded by optimistic version locking (one guess evaluated at a time),
 *  plus a broadcast/presence channel for ephemeral per-tile selection locks. */
export function useSharedBoard<S extends Base>(game: string, puzzleId: number, initial: S, room: string | null, onEvent?: (payload: any) => void) {
  const evRef = useRef(onEvent); evRef.current = onEvent;
  const me = getPlayer() || "Anonymous";
  const lsKey = `gm_${game}_${room ?? "solo"}_${puzzleId}`;
  const [state, setLocal] = useState<S>(() => { try { const v = localStorage.getItem(lsKey); return v && !room ? JSON.parse(v) : initial; } catch { return initial; } });
  const [status, setStatus] = useState<Status>(room ? "connecting" : "solo");
  const [locks, setLocks] = useState<Record<string, string[]>>({}); // player -> selected words
  const [peers, setPeers] = useState<string[]>([]);
  const ref = useRef(state); ref.current = state;
  const version = useRef(0);
  const chRef = useRef<any>(null);
  useEffect(() => { if (!room) localStorage.setItem(lsKey, JSON.stringify(state)); }, [lsKey, state, room]);

  useEffect(() => {
    if (!room) return;
    if (!supabase) { setStatus("offline"); return; }
    const sb = supabase; let cancelled = false;
    (async () => {
      await ensureRoom(room, game, puzzleId, initial);
      const { data } = await sb.from("rooms").select("state,version").eq("id", room).maybeSingle();
      if (cancelled || !data) return;
      version.current = data.version; if (data.state && Object.keys(data.state).length) setLocal(data.state as S);
    })();
    const ch = sb.channel(`board-${room}`, { config: { presence: { key: me } } })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room}` }, (p: any) => {
        version.current = p.new.version; setLocal(p.new.state as S);
      })
      .on("broadcast", { event: "select" }, ({ payload }: any) => {
        if (payload.player !== me) setLocks((l) => ({ ...l, [payload.player]: payload.words }));
      })
      .on("broadcast", { event: "ev" }, ({ payload }: any) => { if (payload.player !== me) evRef.current?.(payload); })
      .on("presence", { event: "sync" }, () => {
        const ps = Object.keys(ch.presenceState()); setPeers(ps.filter((p) => p !== me));
        setLocks((l) => Object.fromEntries(Object.entries(l).filter(([k]) => ps.includes(k))));
      })
      .subscribe(async (s) => {
        setStatus(s === "SUBSCRIBED" ? "live" : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "offline" : "connecting");
        if (s === "SUBSCRIBED") await ch.track({ at: Date.now() });
      });
    chRef.current = ch;
    return () => { cancelled = true; sb.removeChannel(ch); chRef.current = null; };
  }, [room, game, puzzleId, me]);

  const broadcastSelection = useCallback((words: string[]) => {
    chRef.current?.send({ type: "broadcast", event: "select", payload: { player: me, words } });
  }, [me]);

  /** Applies fn to the latest authoritative state with compare-and-swap. Returns false if another player's guess won the race. */
  const commit = useCallback(async (fn: (s: S) => S): Promise<boolean> => {
    if (!room || !supabase) { const n = fn(ref.current); ref.current = n; setLocal(n); return true; }
    const { data } = await supabase.from("rooms").select("state,version").eq("id", room).single();
    if (!data) return false;
    if (data.version !== version.current) { version.current = data.version; setLocal(data.state as S); return false; }
    const next = fn(data.state as S);
    const { data: upd } = await supabase.from("rooms").update({ state: next, version: data.version + 1, updated_at: new Date().toISOString() })
      .eq("id", room).eq("version", data.version).select("version");
    if (!upd || upd.length === 0) return false;
    version.current = data.version + 1; ref.current = next; setLocal(next); return true;
  }, [room]);

  const send = useCallback((payload: any) => { chRef.current?.send({ type: "broadcast", event: "ev", payload: { ...payload, player: me } }); }, [me]);
  /** Last-write-wins save without the version check (for high-frequency co-op edits that are also broadcast). */
  const save = useCallback((next: S) => {
    ref.current = next; setLocal(next);
    if (room && supabase) supabase.from("rooms").update({ state: next, version: version.current + 1, updated_at: new Date().toISOString() }).eq("id", room).then(() => { version.current += 1; });
  }, [room]);
  const setLocalState = useCallback((fn: (s: S) => S) => { const n = fn(ref.current); ref.current = n; setLocal(n); }, []);
  return { state, commit, status, locks, peers, broadcastSelection, me, send, save, setLocalState };
}

export async function recordResult(r: { room: string | null; game: string; puzzleId: number; won: boolean; mistakes: number; hints: number; seconds: number }) {
  const player = getPlayer() || "Anonymous";
  const key = `gm_rec_${r.game}_${r.room ?? "solo"}_${r.puzzleId}_${player}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  const local = JSON.parse(localStorage.getItem("gm_history") || "[]");
  local.unshift({ ...r, player, at: Date.now() }); localStorage.setItem("gm_history", JSON.stringify(local.slice(0, 200)));
  if (supabase) await supabase.from("results").insert({ room_id: r.room, player, game: r.game, puzzle_id: r.puzzleId, won: r.won, mistakes: r.mistakes, hints: r.hints, seconds: r.seconds });
}

/** Looks up which puzzle a room is playing (so joiners get the same puzzle). */
export async function roomPuzzle(room: string): Promise<number | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("rooms").select("puzzle_id").eq("id", room).maybeSingle();
  return data ? data.puzzle_id : null;
}
