// Simulates two clients in one room against Supabase and checks realtime sync.
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
const URL = process.env.VITE_SUPABASE_URL, KEY = process.env.VITE_SUPABASE_ANON_KEY;
const A = createClient(URL, KEY, { realtime: { transport: WebSocket } }), B = createClient(URL, KEY, { realtime: { transport: WebSocket } });
const room = "smoke" + Date.now().toString(36); const ok = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await A.from("rooms").insert({ id: room, game: "connections", puzzle_id: 1, state: { mistakes: 0 } });
const sub = (c, ch) => new Promise((res) => ch.subscribe((s) => s === "SUBSCRIBED" && res()));
const aPlayers = A.channel("p-" + room).on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${room}` }, (p) => { if (p.new.player === "Bob") ok.playerProgress = p.new.state; });
const aBoard = A.channel("b-" + room).on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room}` }, (p) => { ok.boardUpdate = p.new.version; });
const aBc = A.channel("board-" + room, { config: { presence: { key: "Alice" } } }).on("broadcast", { event: "select" }, ({ payload }) => { ok.broadcastLock = payload.words; }).on("presence", { event: "sync" }, () => { if (Object.keys(aBc.presenceState()).includes("Bob")) ok.presence = true; });
const bBc = B.channel("board-" + room, { config: { presence: { key: "Bob" } } });
await Promise.all([sub(A, aPlayers), sub(A, aBoard), sub(A, aBc), sub(B, bBc)]);
await bBc.track({ at: Date.now() });
await wait(1500);
await bBc.send({ type: "broadcast", event: "select", payload: { player: "Bob", words: ["APPLE", "MANGO"] } });
await B.from("room_players").upsert({ room_id: room, player: "Bob", state: { found: ["PEAR"] } });
// CAS submit lock: two concurrent guesses at version 0, only one may win
const g = (c) => c.from("rooms").update({ state: { mistakes: 1 }, version: 1 }).eq("id", room).eq("version", 0).select("version");
const [r1, r2] = await Promise.all([g(A), g(B)]);
ok.casWinners = (r1.data?.length || 0) + (r2.data?.length || 0);
await wait(3000);
console.log(JSON.stringify(ok));
const pass = ok.playerProgress && ok.boardUpdate === 1 && ok.broadcastLock && ok.presence && ok.casWinners === 1;
console.log(pass ? "PASS" : "FAIL"); process.exit(pass ? 0 : 1);
