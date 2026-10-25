// Two-browser Blackjack test: Alice opens a live table, Bob joins by link; both play ~60s while every edge-function response
// and realtime frame is captured and audited (no shoe, no hole card before reveal, no seat tokens). Usage: BASE=<url> node scripts/bjNetworkAudit.mjs
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const B = process.env.BASE || "http://127.0.0.1:5199/";
const mk = async (name) => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  await ctx.addInitScript((n) => { localStorage.setItem("gm_player", n); localStorage.setItem("gm_sound", "off"); }, name);
  const p = await ctx.newPage(); const cap = [];
  p.on("pageerror", (e) => console.log(name, "PAGEERR", e.message));
  p.on("response", async (r) => { if (r.url().includes("/functions/v1/cards")) { try { cap.push({ kind: "http", req: r.request().postData(), body: await r.text() }); } catch {} } });
  p.on("websocket", (ws) => ws.on("framereceived", (f) => { const t = String(f.payload); if (t.includes("card_games")) cap.push({ kind: "ws", body: t }); }));
  return { browser, p, cap, name };
};
const A = await mk("Alice"), Bo = await mk("Bob");
await A.p.goto(B + "#/play/blackjack"); await A.p.waitForTimeout(600);
await A.p.click("text=Live table"); await A.p.click("text=Start now & share link");
await A.p.waitForSelector(".bet-box", { timeout: 20000 });
const url = A.p.url(); console.log("table url", url);
await Bo.p.goto(url); await Bo.p.waitForSelector(".bj-seat.mine", { timeout: 20000 });
await A.p.waitForTimeout(1500);
let shots = 0;
async function step(X) {
  if (await X.p.$(".bet-box")) { await X.p.click("button:has-text('Deal')", { timeout: 1500 }).catch(() => {}); return true; }
  if (await X.p.$("text=Take insurance")) { await X.p.click("text=No thanks", ).catch(() => {}); return true; }
  const st = await X.p.$("button.act.stand:not([disabled])");
  if (st) {
    if (shots < 1) { shots++; await A.p.screenshot({ path: "/workspace/screenshots/bj-live-alice.png", fullPage: true }); await Bo.p.screenshot({ path: "/workspace/screenshots/bj-live-bob.png", fullPage: true }); }
    await X.p.click(Math.random() < 0.3 ? "button.act.hit" : "button.act.stand", { timeout: 1500 }).catch(() => {}); return true;
  }
  return false;
}
const t0 = Date.now();
const st = async (X) => (await X.p.textContent(".bj-controls").catch(() => "")).slice(0, 40);
while (Date.now() - t0 < 60000) { const a = await step(A); const b = await step(Bo); console.log(((Date.now() - t0) / 1000).toFixed(1), "A", a, await st(A), "| B", b, await st(Bo)); await A.p.waitForTimeout(500); }
await A.p.screenshot({ path: "/workspace/screenshots/bj-live-alice-end.png", fullPage: true });
await Bo.p.screenshot({ path: "/workspace/screenshots/bj-live-bob-end.png", fullPage: true });
const tokA = await A.p.evaluate(() => localStorage.getItem("cards_token"));
const tokB = await Bo.p.evaluate(() => localStorage.getItem("cards_token"));
// --- network audit ---
const report = { url, frames: {}, violations: [] };
for (const X of [A, Bo]) {
  const other = X === A ? tokB : tokA;
  let n = 0, hidden = 0, revealed = 0, rounds = new Set();
  for (const c of X.cap) {
    n++;
    if (c.body.includes(other)) report.violations.push(`${X.name} saw the other seat token`);
    if (/"shoe"\s*:/.test(c.body)) report.violations.push(`${X.name} received a shoe array`);
    if (/tokenHash/.test(c.body)) report.violations.push(`${X.name} received a tokenHash`);
    let j; try { j = JSON.parse(c.body); } catch { continue; }
    const pubs = [];
    const walk = (o) => { if (o && typeof o === "object") { if (o.game === "blackjack" && o.phase && o.dealer) pubs.push(o); for (const v of Object.values(o)) walk(v); } };
    walk(j);
    for (const pb of pubs) {
      rounds.add(pb.round);
      // replay frames include the dealer's own turn (every hand finished, hole flipped): the hole is public by then
      const dealerTurn = pb.phase === "play" && pb.turn === null && pb.holeHidden === false;
      if (dealerTurn) { if (pb.seats.some((x) => x.inRound && x.hands.some((h) => !h.done))) report.violations.push(`${X.name}: hole shown while a hand is still open (round ${pb.round})`); report.dealerTurnFrames = (report.dealerTurnFrames || 0) + 1; continue; }
      if ((pb.phase === "play" || pb.phase === "insurance") && pb.dealer.length) { if (pb.dealer[1] !== null) report.violations.push(`${X.name}: hole card visible during ${pb.phase} round ${pb.round}: ${pb.dealer[1]}`); else hidden++; }
      if (pb.phase === "betting" && pb.dealer.length >= 2 && pb.dealer[1]) revealed++;
    }
  }
  report.frames[X.name] = { messages: n, http: X.cap.filter((c) => c.kind === "http").length, ws: X.cap.filter((c) => c.kind === "ws").length, hiddenHoleStates: hidden, revealedAfterSettle: revealed, rounds: [...rounds].sort((a, b) => a - b) };
}
writeFileSync("/workspace/reports/blackjack-network-audit.json", JSON.stringify({ ...report, sample: A.cap.slice(-2) }, null, 1));
console.log(JSON.stringify(report, null, 1));
console.log("Alice:", await A.p.textContent(".bj-foot")); console.log("Bob:", await Bo.p.textContent(".bj-foot"));
await A.browser.close(); await Bo.browser.close();
