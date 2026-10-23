// Client side of the card tables: all moves go to the "cards" edge function; the redacted public state streams in over realtime.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cards`;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Per-browser secret that proves seat ownership. Only its SHA-256 is stored server-side; it never leaves this browser except to the function. */
export function seatToken(): string {
  let t = localStorage.getItem("cards_token");
  if (!t) { const b = new Uint8Array(24); crypto.getRandomValues(b); t = [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); localStorage.setItem("cards_token", t); }
  return t;
}
export type Reply<P> = { version: number; seat: number; pending: number; public: P; error?: string };
export async function cardsCall<P>(body: Record<string, unknown>, keepalive = false): Promise<Reply<P>> {
  const r = await fetch(FN, { method: "POST", keepalive, headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ ...body, token: seatToken() }) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export function useCardTable<P extends { deadline: number | null }>(id: string | null, join: { game: string; seats: number; bot: string; name: string }) {
  const [pub, setPub] = useState<P | null>(null);
  const [seat, setSeat] = useState(-1);
  const [pending, setPending] = useState(-1);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ver = useRef(-1);
  const take = useCallback((r: Reply<P>) => {
    if (r.version >= ver.current) { ver.current = r.version; setPub(r.public); }
    setSeat(r.seat); setPending(r.pending);
  }, []);
  const call = useCallback(async (body: Record<string, unknown>) => {
    if (!id) return; try { take(await cardsCall<P>({ id, ...body })); setErr(""); } catch (e) { setErr((e as Error).message); }
  }, [id, take]);

  useEffect(() => {
    if (!id || !supabase) return; const sb = supabase;
    call({ action: "join", game: join.game, seats: join.seats, bot: join.bot, name: join.name });
    const ch = sb.channel(`cards-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "card_games", filter: `id=eq.${id}` }, (p: any) => {
        const row = p.new as { version: number; public: P };
        if (row?.public && row.version > ver.current) { ver.current = row.version; setPub(row.public); }
        setSeat((s) => { if (s < 0) call({ action: "view" }); return s; });
      }).subscribe();
    const poll = setInterval(() => call({ action: "view" }), 20000);
    return () => { sb.removeChannel(ch); clearInterval(poll); };
  }, [id]);

  // Anyone at the table may nudge the dealer once a turn clock runs out; the server checks the deadline.
  useEffect(() => {
    if (!pub?.deadline) return;
    const ms = pub.deadline - Date.now() + 400 + Math.random() * 600;
    const t = setTimeout(() => call({ action: "tick" }), Math.max(200, ms));
    return () => clearTimeout(t);
  }, [pub?.deadline]);

  const act = useCallback(async (move: Record<string, unknown>) => { setBusy(true); await call({ action: "act", move }); setBusy(false); }, [call]);
  const leave = useCallback(() => { if (id) cardsCall({ id, action: "leave" }, true).catch(() => {}); }, [id]);
  const hint = useCallback(() => call({ action: "hint" }), [call]);
  return { pub, seat, pending, err, busy, act, leave, hint, setErr };
}
