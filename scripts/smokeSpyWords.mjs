// Spy Words server smoke test: seats, key secrecy, clue validation, classic + duet rules, results. Uses only the public anon key.
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { realtime: { transport: WebSocket } });
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? "  ✓ " : "  ✗ ") + m); };
const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); return { data, err: error?.message }; };
const game = async (room) => (await sb.from("spy_games").select("*").eq("room_id", room).single()).data;
const newRoom = async (mode, host) => { const id = "swsmoke" + mode + Date.now().toString(36); await sb.from("rooms").insert({ id, game: "spywords", puzzle_id: 0, state: {}, host, status: "lobby", private: true, params: { game: "spywords", mode } }); return id; };

console.log("Classic");
{
  const room = await newRoom("versus", "Hal");
  const t = {}; for (const p of ["Hal", "Rita", "Bo", "Bea"]) t[p] = (await rpc("spy_join", { p_room: room, p_player: p })).data;
  ok(Object.values(t).every(Boolean), "4 players joined with seat tokens");
  ok((await rpc("spy_start", { p_room: room, p_token: t.Hal })).err?.startsWith("need_"), "start blocked until teams are complete");
  await rpc("spy_seat", { p_room: room, p_token: t.Hal, p_team: "red", p_spy: true });
  ok((await rpc("spy_seat", { p_room: room, p_token: t.Rita, p_team: "red", p_spy: true })).err === "spymaster_taken", "only one spymaster per team");
  await rpc("spy_seat", { p_room: room, p_token: t.Rita, p_team: "red", p_spy: false });
  await rpc("spy_seat", { p_room: room, p_token: t.Bo, p_team: "blue", p_spy: true });
  await rpc("spy_seat", { p_room: room, p_token: t.Bea, p_team: "blue", p_spy: false });
  ok((await rpc("spy_start", { p_room: room, p_token: t.Rita })).err === "not_host", "only host can start");
  ok(!(await rpc("spy_start", { p_room: room, p_token: t.Hal })).err, "host starts");
  let g = await game(room);
  ok(g.words.length === 25 && new Set(g.words).size === 25 && g.phase === "clue", "25 unique words, clue phase");
  ok(!JSON.stringify(g).match(/assassin|neutral/) && g.key_reveal === null, "public game row has no key info");
  const key = (await rpc("spy_key", { p_room: room, p_token: t.Hal })).data;
  ok(key?.length === 25 && key.filter((c) => c === g.start_team).length === 9 && key.filter((c) => c === "assassin").length === 1 && key.filter((c) => c === "neutral").length === 7, "spymaster gets 9/8/7/1 key");
  ok(JSON.stringify((await rpc("spy_key", { p_room: room, p_token: t.Bo })).data) === JSON.stringify(key), "other spymaster gets the same key");
  ok((await rpc("spy_key", { p_room: room, p_token: t.Rita })).err === "not_allowed", "guesser denied the key");
  ok((await rpc("spy_key", { p_room: room, p_token: "00000000-0000-0000-0000-000000000000" })).err === "not_seated", "random token denied");
  const kq = await sb.from("spy_keys").select("*"); ok(!kq.data?.length, `direct spy_keys read blocked (${kq.error?.code || "0 rows"})`);
  const sq = await sb.from("spy_seats").select("*"); ok(!sq.data?.length, `direct spy_seats read blocked (${sq.error?.code || "0 rows"})`);
  const uq = await sb.from("spy_games").update({ phase: "over" }).eq("room_id", room).select(); ok(!uq.data?.length, "direct spy_games write blocked");
  ok((await rpc("spy_join", { p_room: room, p_player: "Hal" })).err === "name_taken", "seat cannot be taken over by name after start");
  ok((await rpc("spy_seat", { p_room: room, p_token: t.Rita, p_team: "red", p_spy: true })).err === "game_started", "roles locked after start");
  const sm = g.start_team === "red" ? t.Hal : t.Bo, gu = g.start_team === "red" ? t.Rita : t.Bea;
  const osm = g.start_team === "red" ? t.Bo : t.Hal, ogu = g.start_team === "red" ? t.Bea : t.Rita;
  ok((await rpc("spy_clue", { p_room: room, p_token: sm, p_word: g.words[3], p_n: 2 })).err === "board_word", "clue that is a board word rejected");
  ok((await rpc("spy_clue", { p_room: room, p_token: sm, p_word: g.words[3] + "s", p_n: 2 })).err === "board_word", "plural of board word rejected");
  ok((await rpc("spy_clue", { p_room: room, p_token: sm, p_word: "two words", p_n: 2 })).err === "one_word", "multi-word clue rejected");
  ok((await rpc("spy_clue", { p_room: room, p_token: gu, p_word: "zzyzx", p_n: 2 })).err === "not_your_turn", "guesser cannot give clue");
  ok(!(await rpc("spy_clue", { p_room: room, p_token: sm, p_word: "zzyzx", p_n: 1 })).err, "spymaster gives clue ZZYZX 1");
  ok((await rpc("spy_guess", { p_room: room, p_token: sm, p_idx: 0 })).err === "not_your_turn", "spymaster cannot guess");
  ok((await rpc("spy_pass", { p_room: room, p_token: gu })).err === "guess_first", "must guess before ending turn");
  const mine = key.map((c, i) => [c, i]).filter(([c]) => c === g.start_team).map(([, i]) => i);
  ok((await rpc("spy_guess", { p_room: room, p_token: gu, p_idx: mine[0] })).data === g.start_team, "correct guess reveals team color");
  ok((await rpc("spy_guess", { p_room: room, p_token: gu, p_idx: mine[0] })).err === "already_revealed", "cannot re-reveal");
  ok(!(await rpc("spy_guess", { p_room: room, p_token: gu, p_idx: mine[1] })).err, "second correct guess (n+1)");
  g = await game(room); ok(g.turn !== g.start_team && g.phase === "clue", "turn passes after number+1 guesses");
  await rpc("spy_clue", { p_room: room, p_token: osm, p_word: "qwerty", p_n: 3 });
  const neu = key.indexOf("neutral"); await rpc("spy_guess", { p_room: room, p_token: ogu, p_idx: neu });
  g = await game(room); ok(g.turn === g.start_team && g.revealed[neu] === "neutral", "neutral ends the turn");
  await rpc("spy_clue", { p_room: room, p_token: sm, p_word: "plugh", p_n: 0 });
  for (const i of mine.slice(2)) await rpc("spy_guess", { p_room: room, p_token: gu, p_idx: i });
  g = await game(room); ok(g.phase === "over" && g.winner === g.start_team && Array.isArray(g.key_reveal), "finding all words wins; key revealed at end");
  const res = (await sb.from("results").select("*").eq("room_id", room)).data;
  ok(res.length === 4 && res.filter((r) => r.won).length === 2 && res[0].detail?.turns === 3, "results saved for all 4 (winner, turns, time)");
  ok(!(await rpc("spy_reset", { p_room: room, p_token: t.Hal })).err && (await game(room)).phase === "setup", "host can reset for another round");
  await rpc("spy_start", { p_room: room, p_token: t.Hal }); g = await game(room);
  const k2 = (await rpc("spy_key", { p_room: room, p_token: t.Hal })).data; const sm2 = g.start_team === "red" ? t.Hal : t.Bo, gu2 = g.start_team === "red" ? t.Rita : t.Bea;
  await rpc("spy_clue", { p_room: room, p_token: sm2, p_word: "xyzzy", p_n: 1 }); await rpc("spy_guess", { p_room: room, p_token: gu2, p_idx: k2.indexOf("assassin") });
  g = await game(room); ok(g.phase === "over" && g.winner !== g.start_team && g.reason === "assassin", "assassin = instant loss");
}

console.log("Duet");
{
  const room = await newRoom("coop", "Ann");
  const a = (await rpc("spy_join", { p_room: room, p_player: "Ann" })).data, b = (await rpc("spy_join", { p_room: room, p_player: "Ben" })).data, c = (await rpc("spy_join", { p_room: room, p_player: "Cy" })).data;
  await rpc("spy_seat", { p_room: room, p_token: a, p_team: "A", p_spy: false });
  ok((await rpc("spy_seat", { p_room: room, p_token: b, p_team: "A", p_spy: false })).err === "seat_taken", "one agent per side");
  await rpc("spy_seat", { p_room: room, p_token: b, p_team: "B", p_spy: false });
  ok(!(await rpc("spy_start", { p_room: room, p_token: a })).err, "duet starts with two agents");
  let g = await game(room);
  const ka = (await rpc("spy_key", { p_room: room, p_token: a })).data, kb = (await rpc("spy_key", { p_room: room, p_token: b })).data;
  const greens = new Set(); ka.forEach((x, i) => x === "green" && greens.add(i)); kb.forEach((x, i) => x === "green" && greens.add(i));
  ok(ka.filter((x) => x === "green").length === 9 && kb.filter((x) => x === "green").length === 9 && greens.size === 15 && ka.filter((x) => x === "assassin").length === 3, "dual key: 9+9 green (15 distinct), 3 assassins each");
  ok(JSON.stringify(ka) !== JSON.stringify(kb), "each agent only gets their own half");
  ok((await rpc("spy_key", { p_room: room, p_token: c })).err === "not_allowed", "spectator denied the key");
  ok(g.turns_left === 9, "9 shared turns");
  // play to win: giver clues, partner guesses all giver's greens
  let guard = 0;
  while ((g = await game(room)).phase !== "over" && guard++ < 20) {
    if (g.phase === "sudden") break;
    const giverTok = g.turn === "A" ? a : b, guessTok = g.turn === "A" ? b : a, key = g.turn === "A" ? ka : kb;
    await rpc("spy_clue", { p_room: room, p_token: giverTok, p_word: "foo", p_n: 9 });
    const todo = key.map((x, i) => [x, i]).filter(([x, i]) => x === "green" && !g.revealed[i].g).map(([, i]) => i);
    for (const i of todo) await rpc("spy_guess", { p_room: room, p_token: guessTok, p_idx: i });
    if ((await game(room)).phase === "guess") { const n = key.findIndex((x, i) => x === "neutral" && !g.revealed[i]["n" + g.turn]); await rpc("spy_guess", { p_room: room, p_token: guessTok, p_idx: n }); }
  }
  ok(g.phase === "over" && g.winner === "team" && g.turns <= 3, `co-op win after finding 15 greens (turns used ${g.turns}, left ${g.turns_left})`);
  const res = (await sb.from("results").select("*").eq("room_id", room)).data; ok(res.length === 2 && res.every((r) => r.won && r.puzzle_id === 1), "duet results saved");
}
{ // duet neutral ends turn + turn limit -> sudden death
  const room = await newRoom("coop", "Ann");
  const a = (await rpc("spy_join", { p_room: room, p_player: "Ann" })).data, b = (await rpc("spy_join", { p_room: room, p_player: "Ben" })).data;
  await rpc("spy_seat", { p_room: room, p_token: a, p_team: "A", p_spy: false }); await rpc("spy_seat", { p_room: room, p_token: b, p_team: "B", p_spy: false });
  await rpc("spy_start", { p_room: room, p_token: a });
  const ka = (await rpc("spy_key", { p_room: room, p_token: a })).data, kb = (await rpc("spy_key", { p_room: room, p_token: b })).data;
  let g;
  for (let t = 0; t < 9; t++) {
    g = await game(room); const key = g.turn === "A" ? ka : kb; const giverTok = g.turn === "A" ? a : b, guessTok = g.turn === "A" ? b : a;
    await rpc("spy_clue", { p_room: room, p_token: giverTok, p_word: "bar", p_n: 1 });
    const n = key.findIndex((x, i) => x === "neutral" && !g.revealed[i]["n" + g.turn] && !g.revealed[i].g);
    await rpc("spy_guess", { p_room: room, p_token: guessTok, p_idx: n });
  }
  g = await game(room); ok(g.phase === "sudden" && g.turns_left === 0, "neutral guesses burn turns; after 9 turns -> sudden death");
  const bad = kb.findIndex((x, i) => x !== "green" && !g.revealed[i].nB); // A guesses on B's key
  await rpc("spy_guess", { p_room: room, p_token: a, p_idx: bad }); g = await game(room);
  ok(g.phase === "over" && g.winner === "none", "mistake in sudden death loses");
}
await sb.from("results").delete().like("room_id", "swsmoke%"); // (no delete policy: rows stay; harmless)
console.log(fails.length ? `FAIL (${fails.length})` : "PASS"); process.exit(fails.length ? 1 : 0);
