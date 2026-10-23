import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getPlayer, newRoomId } from "./player";

export type Mode = "solo" | "versus" | "coop" | "live";
export type GameId = "strands" | "wordle" | "connections" | "crossword" | "mini" | "bee" | "spywords" | "blackjack" | "spades" | "hearts";
export type Opts = { game: GameId; mode: Mode; d?: string; len?: string; p?: number; cw?: number; wk?: string; day?: number; seats?: number; bot?: string; train?: number; tut?: number };
export type GameStatus = "active" | "archived";
/** status "archived" hides a game from the lobby, pickers, archive and history (code/routes/data kept). Restore = set back to "active". */
export const GAME_META: Record<GameId, { name: string; status: GameStatus; modes: Mode[]; difficulty?: boolean; length?: boolean; cards?: boolean }> = {
  wordle: { name: "Wordle", status: "active", modes: ["solo", "versus", "coop"] },
  connections: { name: "Connections", status: "active", modes: ["solo", "coop"], difficulty: true },
  strands: { name: "Mini Strands", status: "active", modes: ["solo", "versus", "coop"] },
  crossword: { name: "Crossword", status: "archived", modes: ["solo", "versus", "coop"], difficulty: true, length: true },
  mini: { name: "The Mini", status: "active", modes: ["solo", "versus", "coop"], difficulty: true },
  bee: { name: "Spelling Bee", status: "archived", modes: ["solo", "versus", "coop"] },
  spywords: { name: "Spy Words", status: "active", modes: ["versus", "coop"] },
  blackjack: { name: "Blackjack", status: "active", modes: ["solo", "live"], cards: true },
  spades: { name: "Spades", status: "active", modes: ["solo", "live"], cards: true },
  hearts: { name: "Hearts", status: "active", modes: ["solo", "live"], cards: true },
};
export const isActive = (g: string) => (GAME_META as Record<string, { status: GameStatus }>)[g]?.status === "active";
export const MODE_LABEL: Record<Mode, string> = { solo: "Solo", versus: "Competitive", coop: "Co-op", live: "Live table" };

export function gameUrl(o: Opts & { room?: string | null }) {
  const q = new URLSearchParams();
  if (o.room) q.set("room", o.room);
  q.set("mode", o.mode); if (o.d) q.set("d", o.d); if (o.len) q.set("len", o.len); if (o.p !== undefined) q.set("p", String(o.p)); if (o.cw) q.set("cw", String(o.cw)); if (o.wk) q.set("wk", o.wk); if (o.day !== undefined) q.set("day", String(o.day)); if (o.seats) q.set("seats", String(o.seats)); if (o.bot) q.set("bot", o.bot); if (o.train) q.set("train", "1"); if (o.tut) q.set("tut", "1");
  return `/${o.game}?${q}`;
}
const WDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** "Competitive · hard · Week of Oct 12 · Tue" */
export function optsLabel(o: Opts) {
  if (o.game === "spywords") return o.mode === "coop" ? "Duo co-op" : "Classic · Red vs Blue";
  const wk = o.wk ? ` · 📅 Week of ${new Date(o.wk + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}${o.day !== undefined ? " · " + WDAYS[o.day] : ""}` : "";
  const cards = o.seats ? ` · ${o.seats} seats · ${o.bot || "medium"} bots${o.train ? " · train" : ""}${o.tut ? " · tutorial" : ""}` : "";
  return `${MODE_LABEL[o.mode]}${cards}${o.d ? ` · ${o.d}` : ""}${o.len ? ` · ${o.len} min` : ""}${wk}`;
}
export const randomCode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");

/** Creates a room row. status "lobby" rooms show up in the Open lobbies list (unless private). */
export async function createRoom(o: Opts, extra: { name?: string; status: "lobby" | "playing"; private?: boolean }) {
  const id = newRoomId(); const code = extra.private ? randomCode() : null;
  if (supabase) {
    const { error } = await supabase.from("rooms").insert({ id, game: o.game, puzzle_id: o.p ?? 0, state: {}, name: extra.name || null, host: getPlayer(), status: extra.status, private: !!extra.private, code, params: o });
    if (error && code) return createRoom(o, extra); // code collision: retry
  }
  return { id, code };
}
export async function findByCode(code: string) {
  if (!supabase) return null;
  const { data } = await supabase.from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle();
  return data;
}

export type RoomRow = { id: string; game: GameId; name: string | null; host: string | null; status: string; private: boolean; code: string | null; params: Opts; created_at: string };
export function useOpenLobbies() {
  const [rows, setRows] = useState<RoomRow[]>([]);
  useEffect(() => {
    if (!supabase) return; const sb = supabase;
    const load = () => sb.from("rooms").select("id,game,name,host,status,private,code,params,created_at").eq("status", "lobby").eq("private", false)
      .gte("created_at", new Date(Date.now() - 3 * 3600e3).toISOString()).order("created_at", { ascending: false }).limit(30).then(({ data }) => setRows((data as RoomRow[]) || []));
    load();
    const ch = sb.channel("lobbies").on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, load).subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);
  return rows;
}

/** Site-wide presence: who is online and where. */
export function useSitePresence(where: string) {
  const [online, setOnline] = useState<{ name: string; where: string }[]>([]);
  useEffect(() => {
    if (!supabase) return; const sb = supabase; const me = getPlayer() || "Guest" + Math.floor(Math.random() * 999);
    const ch = sb.channel("site", { config: { presence: { key: me } } });
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState() as Record<string, { where: string }[]>;
      setOnline(Object.entries(st).filter(([k]) => k !== me).map(([k, v]) => ({ name: k, where: v[0]?.where || "" })));
    }).subscribe((s) => { if (s === "SUBSCRIBED") ch.track({ where }); });
    return () => { sb.removeChannel(ch); };
  }, [where]);
  return online;
}

/** Lobby room presence (who's waiting) + start signal. */
export function useLobby(room: string) {
  const [row, setRow] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<string[]>([]);
  useEffect(() => {
    if (!supabase) return; const sb = supabase; const me = getPlayer();
    sb.from("rooms").select("*").eq("id", room).maybeSingle().then(({ data }) => setRow(data as RoomRow));
    const ch = sb.channel(`lobby-${room}`, { config: { presence: { key: me } } })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room}` }, (p: any) => setRow(p.new))
      .on("presence", { event: "sync" }, () => setPlayers(Object.keys(ch.presenceState())))
      .subscribe((s) => { if (s === "SUBSCRIBED") ch.track({ at: Date.now() }); });
    return () => { sb.removeChannel(ch); };
  }, [room]);
  const start = async () => { if (supabase) await supabase.from("rooms").update({ status: "playing" }).eq("id", room); };
  return { row, players, start };
}
