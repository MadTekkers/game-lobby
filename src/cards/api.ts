// Client side of the card tables: all moves go to the "cards" edge function; the redacted public state streams in over realtime.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { dealSpeed, dealBusyFor } from "./ui/fly";

/** One replay step at 1x deal speed. */
const FRAME_MS = 720;

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cards`;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Per-browser secret that proves seat ownership. Only its SHA-256 is stored server-side; it never leaves this browser except to the function. */
export function seatToken(): string {
  let t = localStorage.getItem("cards_token");
  if (!t) { const b = new Uint8Array(24); crypto.getRandomValues(b); t = [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); localStorage.setItem("cards_token", t); }
  return t;
}
export type Reply<P, V = unknown> = { version: number; seat: number; pending: number; public: P; private?: V | null; error?: string };
export async function cardsCall<P>(body: Record<string, unknown>, keepalive = false): Promise<Reply<P>> {
  const r = await fetch(FN, { method: "POST", keepalive, headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ ...body, token: seatToken() }) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** Joins/creates a table and keeps its public state live. `priv` is this seat's private view (own cards) — it only ever arrives in replies
 *  to this browser's own calls; when the public state suggests it changed (new hand/phase, by default), we re-fetch it with "view". */
export function useCardTable<P extends { deadline: number | null }, V = unknown>(id: string | null, join: { game: string; seats: number; bot: string; name: string; live?: boolean; tutorial?: boolean },
  privKey: (p: P) => string = (p: any) => `${p.phase}|${p.round}|${p.handNo ?? ""}`) {
  const [pub, setPub] = useState<P | null>(null);
  const [priv, setPriv] = useState<V | null>(null);
  const privAt = useRef("");
  const [seat, setSeat] = useState(-1);
  const [pending, setPending] = useState(-1);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ver = useRef(-1);
  // Replay: a move's reply carries `frames` (public snapshots of each bot action / dealer draw / street / trick card).
  // They play one at a time before the final state; later states queue behind them so live tables never desync.
  // Private cards update with the final state, so your next hand never shows up under the last trick.
  const [replaying, setReplaying] = useState(false);
  const q = useRef<{ pub: P; priv?: V | null }[]>([]); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef<P | null>(null);
  const show = useCallback((x: { pub: P; priv?: V | null }) => {
    shown.current = x.pub; setPub(x.pub); if (x.priv !== undefined) { setPriv(x.priv); privAt.current = privKey(x.pub); }
  }, []);
  const pump = useCallback(() => {
    timer.current = null; const x = q.current.shift();
    if (!x) { setReplaying(false); return; }
    show(x);
    if (!q.current.length) { setReplaying(false); return; }
    const s = dealSpeed(); timer.current = setTimeout(pump, Math.max(FRAME_MS / (s || 1), dealBusyFor() + 120));
  }, [show]);
  const skip = useCallback(() => {
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    const items = q.current; q.current = [];
    const last = items[items.length - 1]; if (!last) { setReplaying(false); return; }
    const p = [...items].reverse().find((x) => x.priv !== undefined);
    show({ pub: last.pub, priv: p ? p.priv : undefined }); setReplaying(false);
  }, [show]);
  const enqueue = useCallback((full: P & { frames?: unknown[] }, priv?: V | null) => {
    const { frames, ...rest } = full as P & { frames?: P[] }; const fin = rest as unknown as P;
    const prev = shown.current; const busyNow = q.current.length > 0 || timer.current !== null;
    if (!busyNow && (!prev || !frames?.length || dealSpeed() === 0)) { show({ pub: fin, priv }); return; }
    const log = (prev as { log?: unknown } | null)?.log;
    for (const f of frames ?? []) q.current.push({ pub: { ...(f as object), log, deadline: null } as unknown as P });
    q.current.push({ pub: fin, priv });
    if (dealSpeed() === 0) return skip();
    if (!timer.current) { setReplaying(true); pump(); }
  }, [show, pump, skip]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const take = useCallback((r: Reply<P>) => {
    if (r.version >= ver.current) { ver.current = r.version; enqueue(r.public as P & { frames?: unknown[] }, (r.private ?? null) as V | null); }
    setSeat(r.seat); setPending(r.pending);
  }, [enqueue]);
  const call = useCallback(async (body: Record<string, unknown>) => {
    if (!id) return; try { take(await cardsCall<P>({ id, ...body })); setErr(""); } catch (e) { setErr((e as Error).message); }
  }, [id, take]);

  useEffect(() => {
    if (!id || !supabase) return; const sb = supabase;
    call({ action: "join", ...join });
    const ch = sb.channel(`cards-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "card_games", filter: `id=eq.${id}` }, (p: any) => {
        const row = p.new as { version: number; public: P };
        if (row?.public && row.version > ver.current) { ver.current = row.version; enqueue(row.public as P & { frames?: unknown[] }); }
        // spectators re-check whether they got a seat; seated players refresh their own cards when the hand/phase moved on
        setSeat((s) => { if (s < 0 || (row?.public && privKey(row.public) !== privAt.current)) call({ action: "view" }); return s; });
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
  return { pub, priv, seat, pending, err, busy: busy || replaying, replaying, skip, act, leave, hint, setErr, refresh: () => call({ action: "view" }) };
}

/** Lobby "Create lobby → start": once `expect` humans are seated, the lowest seated human deals. Re-polls and retries every 3 s
 *  while the table is still waiting, so a missed realtime frame or a lost write race can't leave the table stuck. */
export function useAutoStart(T: { seat: number; act: (m: Record<string, unknown>) => Promise<void>; refresh: () => unknown }, expect: number, pub: { phase: string; seats: { kind: string }[] } | null) {
  const humans = pub ? pub.seats.filter((s) => s.kind === "human").length : 0;
  const waiting = pub?.phase === "waiting";
  const first = pub ? pub.seats.findIndex((s) => s.kind === "human") : -1;
  useEffect(() => {
    if (!expect || !waiting || T.seat < 0) return;
    const go = () => { if (humans >= expect && T.seat === first) T.act({ t: "start" }); else T.refresh(); };
    if (humans >= expect && T.seat === first) go();
    const iv = setInterval(go, 3000); return () => clearInterval(iv);
  }, [expect, waiting, T.seat, humans, first]);
}
