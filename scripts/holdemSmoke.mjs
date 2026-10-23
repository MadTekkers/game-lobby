// API smoke test for Hold'em tables on the deployed "cards" function: solo table, plays N hands with a simple policy.
// Usage: node --env-file=/workspace/.secrets/game-lobby.env scripts/holdemSmoke.mjs [seats] [bot] [hands]
import { randomBytes } from "node:crypto";
const FN = `${process.env.SUPABASE_URL}/functions/v1/cards`, KEY = process.env.SUPABASE_ANON_KEY;
const [seats = 6, bot = "hard", hands = 3] = process.argv.slice(2).map((x, i) => (i === 1 ? x : Number(x)));
const token = randomBytes(24).toString("hex"), id = "smk" + randomBytes(6).toString("hex"); const times = [];
async function call(body, soft = false) { const t0 = Date.now(); const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ id, token, ...body }) }); const j = await r.json(); times.push(Date.now() - t0); if (j.error) { if (soft) return null; throw new Error(j.error + " " + JSON.stringify(body)); } return j; }
let r = await call({ action: "join", game: "holdem", seats, bot, name: "SmokeTest" });
console.log("seat", r.seat, "phase", r.public.phase, "holes (null):", r.public.holes, "my hole", r.private?.hole, "chips", r.public.seats[r.seat].chips, "bankroll", r.public.seats[r.seat].stack);
const leaks = []; const check = (x) => { const pub = JSON.stringify({ ...x.public, lastHand: null, results: null }); for (const k of ["tokenHash", "\"deck\"", "nextDeck"]) if (pub.includes(k)) leaks.push(k);
  if (x.public.phase === "betting") for (const c of x.private?.hole ?? []) void c; if (x.public.holes) leaks.push("holes"); };
const start = r.public.handNo; let steps = 0; const nets = [];
while (r.public.handNo < start + hands && steps++ < 300) {
  check(r); const p = r.public;
  if (p.phase === "handover") { nets.push(p.lastHand?.net?.[r.seat]); if (p.handNo >= start + hands - 1) break; r = await call({ action: "act", move: p.seats[r.seat].chips < p.bb ? { t: "rebuy" } : { t: "next" } }); continue; }
  if (p.actor !== r.seat) { r = await call({ action: "view" }); continue; }
  const m = p.toCall > 0 ? (Math.random() < 0.7 ? { t: "call" } : { t: "fold" }) : (Math.random() < 0.3 && p.canRaise ? { t: "raise", to: p.minRaiseTo } : { t: "check" });
  r = await call({ action: "act", move: m });
}
check(r);
console.log("after", steps, "calls: phase", r.public.phase, "hand", r.public.handNo, "nets", nets, "last", JSON.stringify(r.public.lastHand)?.slice(0, 400), "leaks", leaks);
console.log("chips", r.public.seats[r.seat].chips, "bankroll", r.public.seats[r.seat].stack);
const s = [...times].sort((a, b) => a - b); console.log("latency ms p50", s[s.length >> 1], "p90", s[Math.floor(s.length * 0.9)], "max", s[s.length - 1]);
await call({ action: "leave" }); console.log("table", id);
