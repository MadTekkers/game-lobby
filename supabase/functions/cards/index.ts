// "cards" edge function: the authoritative dealer for the card games.
// - Shuffles/deals with crypto RNG, validates every move with the same pure-TS engine the client uses, runs bots, applies timeouts.
// - Full state (shoe order, hidden cards, seat-token hashes) lives in card_secrets (RLS, no policies -> service role only).
// - Only publicView(state) is written to card_games (realtime, anon-readable).
// - A seat is claimed with a random per-seat secret token kept in the browser; only its SHA-256 is stored.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cryptoRng, IllegalMove } from "./lib/core.ts";
import * as BJ from "./lib/blackjack/engine.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
async function sha(t: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("cards:" + t)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const cleanName = (n: unknown) => String(n ?? "").trim().slice(0, 40) || "Guest";
const ctx = () => ({ rng: cryptoRng(), now: Date.now() });
const LEVELS = ["easy", "medium", "hard"];

type State = BJ.BJState;
async function load(id: string) {
  const { data, error } = await db.from("card_secrets").select("state, version").eq("id", id).maybeSingle();
  if (error) throw error; return data as { state: State; version: number } | null;
}
async function bank(name: string) { const { data, error } = await db.rpc("bank_get", { p_player: name }); if (error) throw error; return Number(data); }
async function adjust(name: string, delta: number) { const { data, error } = await db.rpc("bank_adjust", { p_player: name, p_delta: delta }); if (error) throw new IllegalMove("Not enough chips in your bankroll"); return Number(data); }

/** Push the engine's chip ledger into bankrolls (debits can fail -> compensate and reject). */
async function settleLedger(s: State) {
  const done: BJ.Ledger[] = []; const latest = new Map<number, number>();
  try {
    for (const l of s.ledger) { latest.set(l.seat, await adjust(l.name, l.delta)); done.push(l); }
  } catch (e) { for (const l of done.reverse()) await adjust(l.name, -l.delta).catch(() => {}); throw e; }
  for (const [seat, chips] of latest) if (s.seats[seat]?.kind === "human") s.seats[seat].stack = chips;
  return done;
}
async function undoLedger(done: BJ.Ledger[]) { for (const l of [...done].reverse()) await adjust(l.name, -l.delta).catch(() => {}); }

async function recordResults(id: string, before: State, after: State) {
  if (after.round === before.round || !after.results.length) return;
  const rows = after.results.filter((r) => r.kind === "human").map((r) => ({
    room_id: id, player: r.name, game: after.game, puzzle_id: after.round - 1, won: r.net > 0, mistakes: 0,
    hints: before.seats[r.seat]?.hints ?? 0, seconds: Math.max(0, Math.round((Date.now() - (after.startedAt || Date.now())) / 1000)),
    detail: { net: r.net, bet: r.bet, hands: r.hands.map((h) => ({ cards: h.cards, result: h.result, net: h.net })), dealer: after.dealer },
  }));
  if (rows.length) await db.from("results").insert(rows);
  for (const r of rows) await db.rpc("bank_hand", { p_player: r.player });
  for (const r of after.results) if (after.seats[r.seat]) after.seats[r.seat].hints = 0;
  after.startedAt = Date.now();
}

/** Load -> mutate -> CAS save, retrying on concurrent writes. */
async function mutate(id: string, fn: (s: State) => Promise<State> | State) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await load(id); if (!row) throw new IllegalMove("Table not found");
    const before = row.state; before.ledger = [];
    const after = await fn(before);
    if (after === before) return { state: before, version: row.version };
    const done = await settleLedger(after); after.ledger = [];
    await recordResults(id, before, after);
    const { data, error } = await db.from("card_secrets").update({ state: after, version: row.version + 1, updated_at: new Date().toISOString() }).eq("id", id).eq("version", row.version).select("id");
    if (error) { await undoLedger(done); throw error; }
    if (!data?.length) { await undoLedger(done); continue; } // lost the race; retry on fresh state
    await db.from("card_games").update({ public: BJ.publicView(after), version: row.version + 1, updated_at: new Date().toISOString() }).eq("id", id);
    return { state: after, version: row.version + 1 };
  }
  throw new Error("Table busy, try again");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    const id = String(b.id || "").slice(0, 40); if (!/^[a-z0-9]{4,40}$/i.test(id)) throw new IllegalMove("Bad table id");
    const token = String(b.token || ""); const th = token.length >= 16 ? await sha(token) : "";
    const mySeat = (s: State) => (th ? BJ.findSeat(s, th) : -1);
    const pendingSeat = (s: State) => (th ? s.seats.findIndex((x) => x.pending?.tokenHash === th) : -1);
    const reply = (r: { state: State; version: number }) => json({ version: r.version, seat: mySeat(r.state), pending: pendingSeat(r.state), public: BJ.publicView(r.state) });

    switch (b.action) {
      case "create": case "join": {
        if (!th) throw new IllegalMove("Missing seat token");
        const name = cleanName(b.name);
        let row = await load(id);
        if (!row) {
          if ((b.game ?? "blackjack") !== "blackjack") throw new IllegalMove("Unknown game");
          const level = LEVELS.includes(b.bot) ? b.bot : "medium";
          const s = BJ.newTable({ seats: Math.max(2, Math.min(4, Number(b.seats) || 3)), botLevel: level, now: Date.now(), rng: cryptoRng(), timeoutMs: 30000 });
          const { error } = await db.from("card_games").insert({ id, game: "blackjack", public: BJ.publicView(s), version: 0 });
          if (error && !String(error.message).includes("duplicate")) throw error;
          if (!error) await db.from("card_secrets").insert({ id, state: s, version: 0 });
          row = await load(id);
        }
        const stack = await bank(name);
        const r = await mutate(id, (s) => {
          const mine = BJ.findSeat(s, th);
          if (mine >= 0) { s.seats[mine].name = name; s.seats[mine].stack = stack; return s; }
          if (s.seats.some((x) => x.pending?.tokenHash === th)) return s;
          // take a bot seat: prefer one not in the current hand
          const bots = s.seats.map((x, i) => ({ x, i })).filter(({ x }) => x.kind === "bot" && !x.pending);
          const pick = bots.find(({ x }) => !x.inRound) ?? bots[0];
          if (!pick) return s; // full: watch as a spectator
          return BJ.seatHuman(s, pick.i, { name, tokenHash: th, stack }, ctx());
        });
        return reply(r);
      }
      case "view": { const row = await load(id); if (!row) throw new IllegalMove("Table not found"); return reply(row); }
      case "act": {
        const r = await mutate(id, (s) => { const i = mySeat(s); if (i < 0) throw new IllegalMove("You're not seated"); return BJ.apply(s, i, b.move, ctx()); });
        return reply(r);
      }
      case "hint": {
        const r = await mutate(id, (s) => { const i = mySeat(s); if (i < 0) return s; s.seats[i].hints = (s.seats[i].hints ?? 0) + 1; return s; });
        return reply(r);
      }
      case "tick": { const r = await mutate(id, (s) => BJ.timeout(s, ctx())); return reply(r); }
      case "leave": {
        const r = await mutate(id, (s) => {
          const p = pendingSeat(s); if (p >= 0) { s.seats[p].pending = null; return s; }
          const i = mySeat(s); return i < 0 ? s : BJ.leaveSeat(s, i, ctx());
        });
        return reply(r);
      }
      default: throw new IllegalMove("Unknown action");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, e instanceof IllegalMove ? 400 : 500);
  }
});
