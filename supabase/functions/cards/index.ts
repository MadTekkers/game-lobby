// "cards" edge function: the authoritative dealer for every card table (Blackjack, Spades, Hearts, Hold'em).
// - Shuffles/deals with crypto RNG, validates every move with the same pure-TS engine the client uses, runs all bots, applies timeouts.
// - Full state (deck/stock order, every hand, seat-token hashes) lives in card_secrets (RLS on, no policies -> service role only).
// - Only publicView(state) is written to card_games (realtime, anon-readable). A seat's own cards come back only in the reply to
//   that seat's token holder (privateView), never over realtime.
// - A seat is claimed with a random per-seat secret token kept in the browser; only its SHA-256 is stored.
// - Nightly "tune" action (shared secret, hash in app_secrets): reviews card_hands and A/B-tunes bot params (bot_params).
import { createClient } from "npm:@supabase/supabase-js@2";
import { cryptoRng, IllegalMove, frameRec } from "./lib/core.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import * as BJ from "./lib/blackjack/engine.ts";
import * as SP from "./lib/spades/engine.ts";
import { spadesTuner } from "./lib/spades/tune.ts";
import * as HT from "./lib/hearts/engine.ts";
import { heartsTuner } from "./lib/hearts/tune.ts";
import * as PK from "./lib/holdem/engine.ts";
import { holdemTuner } from "./lib/holdem/tune.ts";
import { tuneLevel, type GameTuner } from "./lib/tune.ts";
import type { Ctx, Ledger, ParamSet } from "./lib/seats.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
async function sha(t: string, salt = "cards:") { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + t)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const cleanName = (n: unknown) => String(n ?? "").trim().slice(0, 40) || "Guest";
const LEVELS = ["easy", "medium", "hard"] as const;

// deno-lint-ignore no-explicit-any
type State = any;
type Engine = {
  seats: { min: number; max: number }; generic: boolean;
  newTable(o: { seats: number; botLevel: (typeof LEVELS)[number]; now: number; rng: () => number; timeoutMs: number; tutorial: boolean; live: boolean }): State;
  publicView(s: State): unknown; privateView?(s: State, i: number): unknown;
  apply(s: State, i: number, m: unknown, c: Ctx): State; seatHuman(s: State, i: number, p: { name: string; tokenHash: string; stack: number }, c: Ctx): State;
  leaveSeat(s: State, i: number, c: Ctx): State; timeout(s: State, c: Ctx): State; findSeat(s: State, th: string): number;
};
const ENGINES: Record<string, Engine> = {
  blackjack: { ...(BJ as unknown as Engine), seats: { min: 2, max: 4 }, generic: false },
  spades: { ...(SP as unknown as Engine), seats: SP.SEATS, generic: true },
  hearts: { ...(HT as unknown as Engine), seats: HT.SEATS, generic: true },
  holdem: { ...(PK as unknown as Engine), seats: PK.SEATS, generic: true },
};
const TUNERS: GameTuner[] = [spadesTuner as unknown as GameTuner, heartsTuner as unknown as GameTuner, holdemTuner as unknown as GameTuner];

// Tuned bot params, cached per warm instance for a minute.
const paramCache = new Map<string, { at: number; p: ParamSet }>();
async function params(game: string): Promise<ParamSet> {
  const c = paramCache.get(game); if (c && Date.now() - c.at < 60000) return c.p;
  const { data } = await db.from("bot_params").select("level, params, candidate").eq("game", game);
  const p: ParamSet = {}; for (const r of data ?? []) p[r.level as keyof ParamSet] = { A: r.params ?? {}, B: r.candidate ?? null };
  paramCache.set(game, { at: Date.now(), p }); return p;
}

async function load(id: string) {
  const { data, error } = await db.from("card_secrets").select("state, version").eq("id", id).maybeSingle();
  if (error) throw error; return data as { state: State; version: number } | null;
}
async function bank(name: string) { const { data, error } = await db.rpc("bank_get", { p_player: name }); if (error) throw error; return Number(data); }
async function adjust(name: string, delta: number, clamp = false) {
  const { data, error } = await db.rpc(clamp ? "bank_adjust_clamp" : "bank_adjust", { p_player: name, p_delta: delta });
  if (error) throw clamp ? error : new IllegalMove("Not enough chips in your bankroll"); return Number(data);
}

/** Push the engine's chip ledger into bankrolls (strict debits can fail -> compensate and reject; game-end settlements clamp at 0). */
async function settleLedger(s: State) {
  const done: Ledger[] = []; const latest = new Map<number, number>();
  try { for (const l of s.ledger as Ledger[]) { latest.set(l.seat, await adjust(l.name, l.delta, !!l.clamp)); done.push(l); } }
  catch (e) { await undoLedger(done); throw e; }
  for (const [seat, chips] of latest) if (s.seats[seat]?.kind === "human") s.seats[seat].stack = chips;
  return done;
}
async function undoLedger(done: Ledger[]) { for (const l of [...done].reverse()) await adjust(l.name, -l.delta, true).catch(() => {}); }

async function recordResults(id: string, before: State, after: State, eng: Engine) {
  if (!eng.generic) {
    if (after.round === before.round || !after.results.length) return;
    const rows = after.tutorial ? [] : after.results.filter((r: State) => r.kind === "human").map((r: State) => ({
      room_id: id, player: r.name, game: after.game, puzzle_id: after.round - 1, won: r.net > 0, mistakes: 0,
      hints: before.seats[r.seat]?.hints ?? 0, seconds: Math.max(0, Math.round((Date.now() - (after.startedAt || Date.now())) / 1000)),
      detail: { net: r.net, bet: r.bet, hands: r.hands.map((h: State) => ({ cards: h.cards, result: h.result, net: h.net })), dealer: after.dealer },
    }));
    if (rows.length) await db.from("results").insert(rows);
    for (const r of rows) await db.rpc("bank_hand", { p_player: r.player });
    for (const r of after.results) if (after.seats[r.seat]) after.seats[r.seat].hints = 0;
    after.startedAt = Date.now(); return;
  }
  if (after.reviewSeq !== before.reviewSeq && after.reviews?.length) {
    await db.from("card_hands").insert(after.reviews.map((r: State) => ({ game: after.game, room_id: id, kind: r.kind, level: r.level, variant: r.variant, metrics: r.metrics })));
  }
  if (after.resultSeq !== before.resultSeq && after.results?.length) {
    const rows = after.tutorial ? [] : after.results.filter((r: State) => r.kind === "human").map((r: State) => ({
      room_id: id, player: r.name, game: after.game, puzzle_id: after.resultSeq, won: !!r.won, mistakes: 0,
      hints: after.seats[r.seat]?.hints ?? 0, seconds: Math.max(0, Math.round((Date.now() - (after.startedAt || Date.now())) / 1000)), detail: r.detail,
    }));
    if (rows.length) await db.from("results").insert(rows);
    for (const r of rows) await db.rpc("bank_hand", { p_player: r.player });
    for (const x of after.seats) x.hints = 0;
    after.startedAt = Date.now();
  }
}

/** Load -> mutate -> CAS save, retrying on concurrent writes. */
// Replay frames: public snapshots of each visible step inside one move (bot actions, dealer draws, streets, trick cards).
// Built with publicView, so a frame never shows more than the table showed at that moment. Scoped per request.
const frameStore = new AsyncLocalStorage<{ eng: Engine; frames: unknown[]; last: string }>();
const MAX_FRAMES = 80;
frameRec.on = (s, over) => {
  const fr = frameStore.getStore(); if (!fr) return;
  const v = { ...(fr.eng.publicView(s as State) as Record<string, unknown>), ...(over ?? {}) }; delete v.log; delete v.deadline;
  const j = JSON.stringify(v); if (j === fr.last) return; fr.last = j; fr.frames.push(JSON.parse(j));
};
function finishFrames(fr: { frames: unknown[] }, eng: Engine, after: State) {
  const f = fr.frames.slice(-MAX_FRAMES);
  const end = { ...(eng.publicView(after) as Record<string, unknown>) }; delete end.log; delete end.deadline;
  if (f.length && JSON.stringify(f[f.length - 1]) === JSON.stringify(end)) f.pop();
  return f;
}

async function mutate(id: string, fn: (s: State, eng: Engine, c: Ctx) => Promise<State> | State) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await load(id); if (!row) throw new IllegalMove("Table not found");
    const eng = ENGINES[row.state.game]; if (!eng) throw new Error("Unknown game");
    const before = row.state; before.ledger = [];
    const c: Ctx = { rng: cryptoRng(), now: Date.now(), params: eng.generic ? await params(before.game) : undefined };
    const fr = { eng, frames: [] as unknown[], last: "" };
    const after = await frameStore.run(fr, () => fn(before, eng, c));
    if (after === before) return { state: before, version: row.version };
    const done = await settleLedger(after); after.ledger = [];
    await recordResults(id, before, after, eng);
    const { data, error } = await db.from("card_secrets").update({ state: after, version: row.version + 1, updated_at: new Date().toISOString() }).eq("id", id).eq("version", row.version).select("id");
    if (error) { await undoLedger(done); throw error; }
    if (!data?.length) { await undoLedger(done); continue; } // lost the race; retry on fresh state
    const frames = finishFrames(fr, eng, after);
    await db.from("card_games").update({ public: { ...eng.publicView(after), frames }, version: row.version + 1, updated_at: new Date().toISOString() }).eq("id", id);
    return { state: after, version: row.version + 1, frames };
  }
  throw new Error("Table busy, try again");
}

async function tune(secret: string) {
  const { data: sec } = await db.from("app_secrets").select("hash").eq("name", "cards_tune").maybeSingle();
  if (!sec || secret.length < 24 || (await sha(secret, "tune:")) !== sec.hash) throw new IllegalMove("Not authorized");
  const { data: last } = await db.from("bot_tuning_log").select("created_at").order("created_at", { ascending: false }).limit(1);
  if (last?.length && Date.now() - Date.parse(last[0].created_at) < 6 * 3600e3) return { skipped: "ran less than 6 h ago", at: last[0].created_at };
  const rng = cryptoRng(); const report: unknown[] = [];
  for (const t of TUNERS) {
    const { data: cur } = await db.from("bot_params").select("level, params, candidate, generation, updated_at").eq("game", t.game);
    for (const level of LEVELS) {
      const c = cur?.find((r) => r.level === level) ?? null;
      const since = c?.updated_at ?? new Date(Date.now() - 30 * 864e5).toISOString();
      const { data: rows } = await db.from("card_hands").select("level, variant, metrics").eq("game", t.game).eq("kind", "bot").eq("level", level).gt("created_at", since).limit(5000);
      const out = tuneLevel(t, level, c ? { params: c.params ?? {}, candidate: c.candidate, generation: c.generation } : null, rows ?? [], rng);
      if (out.changed) await db.from("bot_params").upsert({ game: t.game, level, params: out.after.params, candidate: out.after.candidate, generation: out.after.generation, updated_at: new Date().toISOString() });
      await db.from("bot_tuning_log").insert({ game: t.game, level, generation: out.after.generation, before: out.before, after: out.after.params, candidate: out.after.candidate, review: out.review });
      report.push({ game: t.game, level, changed: out.changed, ...out.review });
    }
    paramCache.delete(t.game);
  }
  return { ok: true, report };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    if (b.action === "tune") return json(await tune(String(b.secret ?? "")));
    const id = String(b.id || "").slice(0, 40); if (!/^[a-z0-9]{4,40}$/i.test(id)) throw new IllegalMove("Bad table id");
    const token = String(b.token || ""); const th = token.length >= 16 ? await sha(token) : "";
    const mySeat = (s: State) => (th ? ENGINES[s.game].findSeat(s, th) : -1);
    const pendingSeat = (s: State) => (th ? s.seats.findIndex((x: State) => x.pending?.tokenHash === th) : -1);
    const reply = (r: { state: State; version: number; frames?: unknown[] }) => {
      const eng = ENGINES[r.state.game]; const seat = mySeat(r.state);
      return json({ version: r.version, seat, pending: pendingSeat(r.state), public: { ...eng.publicView(r.state), frames: r.frames ?? [] }, private: seat >= 0 && eng.privateView ? eng.privateView(r.state, seat) : null });
    };

    switch (b.action) {
      case "create": case "join": {
        if (!th) throw new IllegalMove("Missing seat token");
        const name = cleanName(b.name);
        const row = await load(id);
        if (!row) {
          const game = String(b.game ?? "blackjack"); const eng = ENGINES[game]; if (!eng) throw new IllegalMove("Unknown game");
          const level = LEVELS.includes(b.bot) ? b.bot : "medium";
          const s = eng.newTable({ seats: Math.max(eng.seats.min, Math.min(eng.seats.max, Number(b.seats) || 3)), botLevel: level, now: Date.now(), rng: cryptoRng(), timeoutMs: 30000, tutorial: !!b.tutorial, live: !!b.live && !b.tutorial });
          const { error } = await db.from("card_games").insert({ id, game, public: eng.publicView(s), version: 0 });
          if (error && !String(error.message).includes("duplicate")) throw error;
          if (!error) await db.from("card_secrets").insert({ id, state: s, version: 0 });
        }
        const stack = await bank(name);
        const r = await mutate(id, (s, eng, c) => {
          const mine = eng.findSeat(s, th);
          if (mine >= 0) { s.seats[mine].name = name; s.seats[mine].stack = stack; return s; }
          if (s.seats.some((x: State) => x.pending?.tokenHash === th)) return s;
          if (s.tutorial && s.seats.some((x: State) => x.kind === "human")) return s; // tutorial tables show every hand: owner only, others watch
          const bots = s.seats.map((x: State, i: number) => ({ x, i })).filter(({ x }: State) => x.kind === "bot" && !x.pending);
          const pick = bots.find(({ x }: State) => !x.inRound) ?? bots[0];
          if (!pick) return s; // full: watch as a spectator
          return eng.seatHuman(s, pick.i, { name, tokenHash: th, stack }, c);
        });
        return reply(r);
      }
      case "view": { const row = await load(id); if (!row) throw new IllegalMove("Table not found"); return reply(row); }
      case "act": {
        const r = await mutate(id, (s, eng, c) => { const i = mySeat(s); if (i < 0) throw new IllegalMove("You're not seated"); return eng.apply(s, i, b.move, c); });
        return reply(r);
      }
      case "hint": {
        const r = await mutate(id, (s) => { const i = mySeat(s); if (i < 0) return s; s.seats[i].hints = (s.seats[i].hints ?? 0) + 1; return s; });
        return reply(r);
      }
      case "tick": { const r = await mutate(id, (s, eng, c) => eng.timeout(s, c)); return reply(r); }
      case "leave": {
        const r = await mutate(id, (s, eng, c) => {
          const p = pendingSeat(s); if (p >= 0) { s.seats[p].pending = null; return s; }
          const i = mySeat(s); return i < 0 ? s : eng.leaveSeat(s, i, c);
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
