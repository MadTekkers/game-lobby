// Two-browser Hold'em test: Alice opens a live table, Bob joins by link, Alice deals; both play hands (mostly calling so
// hands reach showdown) while every edge-function response and realtime frame is captured. Audit: no deck, no seat
// tokens/hashes, public `holes` always null, and a browser only ever sees the other's hole cards inside lastHand.shown of
// a hand that went to showdown (poker rules: shown hands are public). Folded/uncontested holes must never appear.
// Usage: BASE=<url> SEATS=4 SECS=100 node scripts/holdemNetworkAudit.mjs
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const B = process.env.BASE || "http://localhost:4191/";
const SEATS = Number(process.env.SEATS || 4), SECS = Number(process.env.SECS || 100), OUT = process.env.OUT || "/workspace/reports/holdem-network-audit.json";
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
await A.p.goto(B + "#/play/holdem"); await A.p.waitForTimeout(600);
await A.p.click("text=Live table"); await A.p.click(`.seg button:has-text("${SEATS}")`); await A.p.click("text=Start now & share link");
await A.p.waitForSelector(".waitbox", { timeout: 20000 });
const url = A.p.url(); console.log("table url", url);
await Bo.p.goto(url); await Bo.p.waitForSelector(".waitbox", { timeout: 20000 });
await A.p.waitForTimeout(1500);
await A.p.click("text=Deal the first hand");
let shots = 0;
async function step(X) {
  const acts = await X.p.$(".pk-actions");
  if (acts) {
    if (shots < 1) { shots++; await A.p.screenshot({ path: "/workspace/screenshots/pk-live-alice.png", fullPage: true }); await Bo.p.screenshot({ path: "/workspace/screenshots/pk-live-bob.png", fullPage: true }); }
    const r = Math.random(); const raise = await X.p.$(".pk-raise .controls button.pill:not(.sm)");
    const b = r < 0.12 && raise ? raise : (await X.p.$('.pk-actions button:has-text("Call")')) ?? (await X.p.$('.pk-actions button:has-text("Check")'));
    if (r > 0.95) { const f = await X.p.$('.pk-actions button:has-text("Fold")'); if (f) { await f.click({ timeout: 1500 }).catch(() => {}); return "fold"; } }
    if (b) { await b.click({ timeout: 1500 }).catch(() => {}); return "act"; }
  }
  const nx = await X.p.$('button:has-text("Next hand"), button:has-text("Rebuy")'); if (nx) { await nx.click({ timeout: 1500 }).catch(() => {}); return "next"; }
  return "-";
}
const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) { const a = await step(A); const b = await step(Bo); if (a !== "-" || b !== "-") console.log(((Date.now() - t0) / 1000).toFixed(1), "A", a, "| B", b); await A.p.waitForTimeout(350); }
await A.p.screenshot({ path: "/workspace/screenshots/pk-live-alice-end.png", fullPage: true });
await Bo.p.screenshot({ path: "/workspace/screenshots/pk-live-bob-end.png", fullPage: true });
const tok = { Alice: await A.p.evaluate(() => localStorage.getItem("cards_token")), Bob: await Bo.p.evaluate(() => localStorage.getItem("cards_token")) };
// --- audit ---
const report = { url, frames: {}, violations: [], showdownReveals: [] };
const priv = { Alice: new Map(), Bob: new Map() }; // handNo -> hole (own private view)
const seatOf = { Alice: -1, Bob: -1 };
const parse = (body) => { let j; try { j = JSON.parse(body); } catch { return null; } const out = [];
  const walk = (o) => { if (o && typeof o === "object") { if (o.game === "holdem" && o.phase) out.push(o); for (const v of Object.values(o)) walk(v); } }; walk(j); return { j, out }; };
for (const X of [A, Bo]) {
  for (const c of X.cap) { const r = parse(c.body); if (!r) continue;
    if (typeof r.j.seat === "number" && r.j.seat >= 0) seatOf[X.name] = r.j.seat;
    const hn = r.j.private?.handNo; if (r.j.private?.hole?.length && hn !== undefined) priv[X.name].set(hn, r.j.private.hole); }
  report.frames[X.name] = { messages: X.cap.length, http: X.cap.filter((c) => c.kind === "http").length, ws: X.cap.filter((c) => c.kind === "ws").length };
}
for (const [hn, h] of priv.Alice) { const o = priv.Bob.get(hn); if (o) for (const c of h) if (o.includes(c)) report.violations.push(`hand ${hn}: ${c} in both private hands`); }
const strip = (pb) => JSON.stringify(pb, (k, v) => (k === "lastHand" || k === "log" || k === "results" ? undefined : v));
for (const X of [A, Bo]) {
  const oName = X === A ? "Bob" : "Alice", other = tok[oName], oSeat = seatOf[oName], oPriv = priv[oName];
  for (const c of X.cap) {
    if (other && c.body.includes(other)) report.violations.push(`${X.name} saw the other seat token`);
    if (/tokenHash|"deck"\s*:/.test(c.body)) report.violations.push(`${X.name} received tokenHash/deck`);
    const r = parse(c.body); if (!r) continue;
    // X's own private view never holds the other's cards
    const myHn = r.j.private?.handNo; const oh = myHn === undefined ? null : oPriv.get(myHn);
    if (oh) for (const card of r.j.private?.hole ?? []) if (oh.includes(card)) report.violations.push(`${X.name}'s private view held ${card} of ${oName}`);
    // allowed reveals: other's hole inside lastHand.shown of a contested hand
    const allowed = new Set();
    for (const pb of r.out) { if (pb.holes && pb.holes.some((h) => h)) report.violations.push(`${X.name}: public holes present (hand ${pb.handNo})`);
      const lh = pb.lastHand; if (lh?.shown) for (const s of lh.shown) if (s.seat === oSeat) {
        if (lh.uncontested) report.violations.push(`${X.name}: hole of ${oName} shown in an uncontested hand ${lh.handNo}`);
        else { allowed.add(lh.handNo); if (!report.showdownReveals.some((x) => x.to === X.name && x.hand === lh.handNo)) report.showdownReveals.push({ to: X.name, hand: lh.handNo, hole: s.hole, desc: s.desc, inPrivateOf: oName, matches: String(oPriv.get(lh.handNo)) === String(s.hole) }); } } }
    // no public object (minus previous-hand summary) contains the other's current hole; and whole body only if a showdown explains it
    for (const pb of r.out) { const h = oPriv.get(pb.handNo); if (!h) continue; const t = strip(pb);
      for (const card of h) if (t.includes(`"${card}"`) && !(pb.board ?? []).includes(card)) { report.violations.push(`${X.name} got ${oName}'s hole ${card} (hand ${pb.handNo}, ${pb.phase})`); break; } }
    // whole frame (any field, any nesting — minus the previous hand's public summary/log, which reuse card names from another deal)
    const bodyNow = JSON.stringify(r.j, (k, v) => (k === "lastHand" || k === "log" || k === "results" ? undefined : v));
    for (const [hn, h] of oPriv) { if (allowed.has(hn)) continue; const cur = r.out.find((pb) => pb.handNo === hn && pb.phase === "betting"); if (!cur) continue;
      const inBody = h.filter((card) => bodyNow.includes(`"${card}"`) && !(cur.board ?? []).includes(card));
      if (inBody.length === 2) { report.violations.push(`${X.name}: both of ${oName}'s hole cards in a frame during hand ${hn}`); (report.evidence ??= []).push({ hn, h, kind: c.kind, body: c.body.slice(0, 4000) }); } }
  }
}
report.handsChecked = { Alice: [...priv.Alice.keys()], Bob: [...priv.Bob.keys()] }; report.seats = seatOf;
report.note = "lastHand (the finished hand's showdown, public by poker rules) and log/results are excluded from the current-hand scan; every reveal is listed in showdownReveals and must be from a contested hand";
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, showdownReveals: report.showdownReveals.length }, null, 1));
await A.browser.close(); await Bo.browser.close();
