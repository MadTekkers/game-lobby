// Two-browser Spades test: Alice opens a live 4-seat table, Bob joins by link, Alice deals; both bid and play while every
// edge-function response and realtime frame is captured. Audit: no deck/stock order, no seat tokens/hashes, public `hands`
// always null, and neither browser ever receives a card that was in the other's private hand before it was played.
// Usage: BASE=<url> SEATS=4 node scripts/spadesNetworkAudit.mjs
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const B = process.env.BASE || "http://127.0.0.1:5199/";
const SEATS = Number(process.env.SEATS || 4), SECS = Number(process.env.SECS || 90);
const mk = async (name) => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  await ctx.addInitScript((n) => { localStorage.setItem("gm_player", n); localStorage.setItem("gm_sound", "off"); }, name);
  const p = await ctx.newPage(); const cap = [];
  p.on("pageerror", (e) => console.log(name, "PAGEERR", e.message));
  p.on("response", async (r) => { if (r.url().includes("/functions/v1/cards")) { try { cap.push({ kind: "http", req: r.request().postData(), body: await r.text() }); } catch {} } });
  p.on("websocket", (ws) => ws.on("framereceived", (f) => { const t = String(f.payload); if (t.includes("card_games")) cap.push({ kind: "ws", body: t }); }));
  return { browser, p, cap, name };
};
const A = await mk("Alice"), Bo = await mk("Bob");
await A.p.goto(B + "#/play/spades"); await A.p.waitForTimeout(600);
await A.p.click("text=Live table"); await A.p.click(`.seg button:has-text("${SEATS}")`); await A.p.click("text=Start now & share link");
await A.p.waitForSelector(".waitbox", { timeout: 20000 });
const url = A.p.url(); console.log("table url", url);
await Bo.p.goto(url); await Bo.p.waitForSelector(".waitbox", { timeout: 20000 });
await A.p.waitForTimeout(1500);
await A.p.screenshot({ path: "/workspace/screenshots/sp-live-waiting.png", fullPage: true });
await A.p.click("text=Deal the first hand");
let shots = 0;
async function step(X) {
  const pad = await X.p.$$(".bidpad button:not([disabled])");
  if (pad.length) { const pick = pad[Math.min(pad.length - 1, 2 + Math.floor(Math.random() * 2))]; await pick.click({ timeout: 1500 }).catch(() => {}); return "bid"; }
  if (await X.p.$("text=Look at my cards")) { await X.p.click("text=Look at my cards").catch(() => {}); return "look"; }
  if (await X.p.$("button:has-text('Keep')")) { await X.p.click("button:has-text('Keep')").catch(() => {}); return "keep"; }
  const ok = await X.p.$$(".fan-c.ok:not([disabled])");
  if (ok.length) {
    if (shots < 1) { shots++; await A.p.screenshot({ path: "/workspace/screenshots/sp-live-alice.png", fullPage: true }); await Bo.p.screenshot({ path: "/workspace/screenshots/sp-live-bob.png", fullPage: true }); }
    await ok[Math.floor(Math.random() * ok.length)].click({ timeout: 1500 }).catch(() => {}); return "play";
  }
  if (await X.p.$("text=Rematch at this table")) return "over";
  return "-";
}
const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) { const a = await step(A); const b = await step(Bo); console.log(((Date.now() - t0) / 1000).toFixed(1), "A", a, "| B", b); await A.p.waitForTimeout(400); }
await A.p.screenshot({ path: "/workspace/screenshots/sp-live-alice-end.png", fullPage: true });
await Bo.p.screenshot({ path: "/workspace/screenshots/sp-live-bob-end.png", fullPage: true });
const tok = { Alice: await A.p.evaluate(() => localStorage.getItem("cards_token")), Bob: await Bo.p.evaluate(() => localStorage.getItem("cards_token")) };
// --- audit ---
const report = { url, frames: {}, violations: [] };
const priv = { Alice: new Map(), Bob: new Map() }; // handNo -> Set(cards) seen in own private hand
const played = new Map(); // handNo -> Set(cards) played (public)
const pubsOf = (body) => { const out = []; let j; try { j = JSON.parse(body); } catch { return out; }
  const walk = (o) => { if (o && typeof o === "object") { if (o.game === "spades" && o.phase) out.push(o); for (const v of Object.values(o)) walk(v); } }; walk(j); return { j, out }; };
for (const X of [A, Bo]) {
  const other = X === A ? tok.Bob : tok.Alice;
  for (const c of X.cap) {
    if (other && c.body.includes(other)) report.violations.push(`${X.name} saw the other seat token`);
    if (/tokenHash|"stock"\s*:\s*\[|"deck"\s*:/.test(c.body)) report.violations.push(`${X.name} received tokenHash/stock/deck`);
    const r = pubsOf(c.body); if (!r.j) continue;
    for (const pb of r.out) {
      if (pb.hands && pb.hands.some((h) => h)) report.violations.push(`${X.name}: public hands present (hand ${pb.handNo})`);
      const s = played.get(pb.handNo) ?? new Set(); for (const t of pb.history ?? []) for (const cc of t.cards ?? []) s.add(cc); for (const cc of pb.trick ?? []) s.add(cc); played.set(pb.handNo, s);
    }
    const pv = r.j.private; const hn = r.out[0]?.handNo;
    if (pv?.hand && hn !== undefined) { const s = priv[X.name].get(hn) ?? new Set(); pv.hand.forEach((x) => s.add(x)); priv[X.name].set(hn, s); }
  }
  report.frames[X.name] = { messages: X.cap.length, http: X.cap.filter((c) => c.kind === "http").length, ws: X.cap.filter((c) => c.kind === "ws").length };
}
function strip(j) { return JSON.stringify(j, (k, v) => (k === "lastTrick" || k === "lastHand" || k === "log" || k === "results" ? undefined : v)); }
// any card both browsers held privately in the same hand = a leak (a dealt card belongs to exactly one seat)
for (const [hn, sa] of priv.Alice) { const sb = priv.Bob.get(hn); if (!sb) continue; for (const c of sa) if (sb.has(c)) report.violations.push(`hand ${hn}: ${c} in both private hands`); }
// every public object X received (realtime frames carry new + old record): no card of the other's private hand for that
// same hand appears unless it had been played; and X's private hand never contains the other's cards
for (const X of [A, Bo]) { const otherPriv = priv[X === A ? "Bob" : "Alice"];
  for (const c of X.cap) { const r = pubsOf(c.body); if (!r.j) continue;
    for (const pb of r.out) { const op = otherPriv.get(pb.handNo); if (!op) continue; const pl = played.get(pb.handNo) ?? new Set(); const txt = strip(pb);
      for (const card of op) if (!pl.has(card) && txt.includes(`"${card}"`)) { report.violations.push(`${X.name} got unplayed ${card} of the other player (hand ${pb.handNo})`); (report.evidence ??= []).push({ card, kind: c.kind, body: c.body.slice(0, 6000) }); break; } }
    const hn = r.out[0]?.handNo, op = otherPriv.get(hn);
    if (op) for (const card of r.j.private?.hand ?? []) if (op.has(card)) report.violations.push(`${X.name}'s private view held ${card} of the other player`); } }
report.note = "lastTrick/lastHand/log (previous hand, public by design) are excluded from the unplayed-card scan";
report.handsChecked = { Alice: [...priv.Alice.keys()], Bob: [...priv.Bob.keys()] };
writeFileSync("/workspace/reports/spades-network-audit.json", JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await A.browser.close(); await Bo.browser.close();
