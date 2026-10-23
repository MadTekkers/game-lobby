// API smoke test for the Spades tables on the deployed "cards" function: solo game hand-by-hand with random legal moves, timing each call.
// Usage: node --env-file=/workspace/.secrets/game-lobby.env scripts/spadesSmoke.mjs [seats] [bot] [hands]
import { randomBytes } from "node:crypto";
const FN = `${process.env.SUPABASE_URL}/functions/v1/cards`, KEY = process.env.SUPABASE_ANON_KEY;
const [seats = 4, bot = "hard", hands = 1] = process.argv.slice(2).map((x, i) => (i === 1 ? x : Number(x)));
const token = randomBytes(24).toString("hex"), id = "smk" + randomBytes(6).toString("hex"); const times = [];
async function call(body) { const t0 = Date.now(); const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ id, token, ...body }) }); const j = await r.json(); times.push(Date.now() - t0); if (j.error) throw new Error(j.error + " " + JSON.stringify(body)); return j; }
function legal(hand, p) {
  const t = p.trick; if (t.length) { const f = hand.filter((c) => c[1] === t[0][1]); return f.length ? f : hand; }
  const ns = hand.filter((c) => c[1] !== "S"); return p.broken || !ns.length ? hand : ns;
}
let r = await call({ action: "join", game: "spades", seats, bot, name: "SmokeTest" });
console.log("seat", r.seat, "phase", r.public.phase, "variant", r.public.v, "hands field (should be null):", r.public.hands);
let startHand = r.public.handNo, steps = 0;
while (r.public.phase !== "gameover" && r.public.handNo < startHand + hands && steps++ < 400) {
  const p = r.public, me = r.seat, pv = r.private;
  if (p.actor !== me) { r = await call({ action: "view" }); continue; }
  if (p.phase === "draw") r = await call({ action: "act", move: { t: Math.random() < 0.5 ? "keep" : "discard" } });
  else if (p.phase === "bidding") { if (!pv.hand) r = await call({ action: "act", move: { t: "look" } }); else r = await call({ action: "act", move: { t: "bid", n: Math.max(1, Math.round(pv.hand.filter((c) => "AK".includes(c[0]) || c[1] === "S").length * 0.6)) } }); }
  else if (p.phase === "play") { const L = legal(pv.hand, p); r = await call({ action: "act", move: { t: "play", card: L[Math.floor(Math.random() * L.length)] } }); }
  else break;
}
console.log("after", steps, "calls: phase", r.public.phase, "hand", r.public.handNo, "scores", r.public.scores, "lastHand", JSON.stringify(r.public.lastHand?.score?.points));
const s = [...times].sort((a, b) => a - b); console.log("latency ms p50", s[s.length >> 1], "p90", s[Math.floor(s.length * 0.9)], "max", s[s.length - 1]);
await call({ action: "leave" }); console.log("table", id);
