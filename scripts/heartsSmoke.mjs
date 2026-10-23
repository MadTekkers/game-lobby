// API smoke test for Hearts tables on the deployed "cards" function: solo game, random accepted moves (tries cards until one is legal).
// Usage: node --env-file=/workspace/.secrets/game-lobby.env scripts/heartsSmoke.mjs [seats] [bot] [hands]
import { randomBytes } from "node:crypto";
const FN = `${process.env.SUPABASE_URL}/functions/v1/cards`, KEY = process.env.SUPABASE_ANON_KEY;
const [seats = 4, bot = "hard", hands = 1] = process.argv.slice(2).map((x, i) => (i === 1 ? x : Number(x)));
const token = randomBytes(24).toString("hex"), id = "smk" + randomBytes(6).toString("hex"); const times = [];
async function call(body, soft = false) { const t0 = Date.now(); const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ id, token, ...body }) }); const j = await r.json(); times.push(Date.now() - t0); if (j.error) { if (soft) return null; throw new Error(j.error + " " + JSON.stringify(body)); } return j; }
let r = await call({ action: "join", game: "hearts", seats, bot, name: "SmokeTest" });
console.log("seat", r.seat, "phase", r.public.phase, "variant", r.public.v, "hands (null):", r.public.hands, "my hand", r.private?.hand?.length);
const leaks = []; const check = (x) => { const pub = JSON.stringify(x.public); for (const k of ["tokenHash", "stock\":[", "nextDeck"]) if (pub.includes(k)) leaks.push(k); };
let startHand = r.public.handNo, steps = 0;
while (r.public.phase !== "gameover" && r.public.handNo < startHand + hands && steps++ < 400) {
  check(r); const p = r.public, pv = r.private;
  if (p.phase === "pass" && !pv.passed) { r = await call({ action: "act", move: { t: "pass", cards: pv.hand.slice(-3) } }); continue; }
  if (p.actor !== r.seat) { r = await call({ action: "view" }); continue; }
  let nx = null; for (const c of [...pv.hand].sort(() => Math.random() - 0.5)) { nx = await call({ action: "act", move: { t: "play", card: c } }, true); if (nx) break; }
  if (!nx) throw new Error("no legal card accepted"); r = nx;
}
console.log("after", steps, "calls: phase", r.public.phase, "hand", r.public.handNo, "scores", r.public.scores, "lastHand", JSON.stringify(r.public.lastHand), "leaks", leaks);
const s = [...times].sort((a, b) => a - b); console.log("latency ms p50", s[s.length >> 1], "p90", s[Math.floor(s.length * 0.9)], "max", s[s.length - 1]);
await call({ action: "leave" }); console.log("table", id);
