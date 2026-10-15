import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { getPlayer } from "./player";
import { go, parseHash } from "./router";
import { listCrosswords } from "./crosswordRepo";
import { choose } from "./choose";
import { WEEKLY_BASE, getWeekly, weekPoolIds } from "./weekly";

/** A puzzle pool: `key` identifies the pool (e.g. "connections-hard"), ids are indexes (or repository ids for crosswords). */
export type Pool = { key: string; size?: number; current: number; done: boolean; crossword?: { size: number; difficulty: string }; weekly?: boolean };

type Played = Record<string, number>; // id -> last played timestamp
const lsKey = (pool: string) => `gm_played_${pool}`;
export const getPlayed = (pool: string): Played => JSON.parse(localStorage.getItem(lsKey(pool)) || "{}");
export function markPlayed(pool: string, id: number) { const p = getPlayed(pool); p[id] = Date.now(); localStorage.setItem(lsKey(pool), JSON.stringify(p)); }

async function poolIds(pool: Pool): Promise<number[]> {
  if (pool.weekly || pool.current >= WEEKLY_BASE) { const r = await getWeekly(pool.current - WEEKLY_BASE); if (r) return weekPoolIds(r.week_start, r.game, r.difficulty); }
  if (pool.crossword) return (await listCrosswords({ size: pool.crossword.size, difficulty: pool.crossword.difficulty })).map((r) => r.id);
  return Array.from({ length: pool.size || 1 }, (_, i) => i);
}
function navigateTo(id: number, crossword: boolean) {
  const { path, params } = parseHash();
  params.set(crossword ? "cw" : "p", String(id));
  go(`${path}?${params}`);
}

export function usePuzzleRefresh(room: string | null, pool: Pool, notify: (m: string) => void) {
  const me = getPlayer() || "Anonymous";
  const [flags, setFlags] = useState<string[]>([]);
  const [roomPlayed, setRoomPlayed] = useState<Record<string, Played>>({});
  const cur = useRef(pool.current); cur.current = pool.current;
  const isCw = !!pool.crossword;

  useEffect(() => { if (pool.done) markPlayed(pool.key, pool.current); }, [pool.done, pool.key, pool.current]);

  // Share my played list with the room and follow puzzle switches.
  useEffect(() => {
    if (!room || !supabase) return; const sb = supabase;
    (async () => {
      const { data } = await sb.from("rooms").select("params").eq("id", room).maybeSingle();
      const params = data?.params || {};
      const playedBy = { ...(params.playedBy || {}) };
      const mine = getPlayed(pool.key); const ids = Object.keys(mine).sort((a, b) => mine[b] - mine[a]).slice(0, 200);
      playedBy[me] = Object.fromEntries(ids.map((k) => [k, mine[+k]]));
      setRoomPlayed(playedBy); setFlags(params.flags || []);
      await sb.from("rooms").update({ params: { ...params, playedBy } }).eq("id", room);
    })();
    const ch = sb.channel(`refresh-${room}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room}` }, (p: any) => {
      const params = p.new.params || {};
      setFlags(params.flags || []); setRoomPlayed(params.playedBy || {});
      const next = isCw ? params.cw : params.p;
      if (next !== undefined && next !== null && Number(next) !== cur.current && params.swapAt && Date.now() - params.swapAt < 60000) {
        notify(params.swapBy && params.swapBy !== me ? `${params.swapBy} loaded a new puzzle` : "New puzzle!");
        setTimeout(() => navigateTo(Number(next), isCw), 700);
      }
    }).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [room, pool.key]);

  const newPuzzle = useCallback(async () => {
    const ids = await poolIds(pool);
    const next = choose(ids, pool.current, [getPlayed(pool.key), ...Object.values(roomPlayed)]);
    if (!room || !supabase) return navigateTo(next, isCw);
    const { data } = await supabase.from("rooms").select("params,version").eq("id", room).maybeSingle();
    const params = { ...(data?.params || {}), [isCw ? "cw" : "p"]: next, flags: [], swapBy: me, swapAt: Date.now() };
    await supabase.from("rooms").update({ params, puzzle_id: next, state: {}, version: (data?.version || 0) + 1 }).eq("id", room);
  }, [pool, roomPlayed, room]);

  const flagPlayed = useCallback(async () => {
    markPlayed(pool.key, pool.current);
    if (!room || !supabase) return;
    const { data } = await supabase.from("rooms").select("params").eq("id", room).maybeSingle();
    const params = data?.params || {}; const f = new Set<string>(params.flags || []); f.add(me);
    await supabase.from("rooms").update({ params: { ...params, flags: [...f] } }).eq("id", room);
  }, [room, pool.key, pool.current]);

  return { flags, newPuzzle, flagPlayed, me };
}
