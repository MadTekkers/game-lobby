// Forced-split UI check: serves a local Blackjack engine with a stacked shoe (you get 8-8) in place of the edge function, splits,
// and confirms the action tray sits inside the active split hand and moves to the second hand after you stand on the first.
// Usage: BASE=<url> node scripts/bjSplitCheck.mjs   (OUT defaults to /workspace/screenshots/tables/replay)
import { chromium } from "playwright-core";
import { build } from "rolldown";
import { mkdirSync } from "node:fs";
const B = process.env.BASE || "http://localhost:4191/";
const OUT = process.env.OUT || "/workspace/screenshots/tables/replay"; mkdirSync(OUT, { recursive: true });
const entry = "/tmp/bjsplit/entry.ts"; const file = "/tmp/bjsplit/engine.mjs";
await build({ input: entry, platform: "neutral", output: { file, format: "esm" }, logLevel: "warn" });
const { BJ, frameRec, makeDeck, shuffle, seededRng } = await import(file);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let fails = 0;
for (const W of [390, 1280]) {
  const stacked = ["8S", "5D", "9H", "8D", "TC", "7C", "3S", "2H"];
  let s = BJ.newTable({ seats: 2, botLevel: "medium", now: Date.now(), rng: seededRng(3), shoe: [...stacked, ...shuffle(makeDeck(6), seededRng(5))] });
  let version = 1; let frames = [];
  frameRec.on = (st, over) => { const v = { ...BJ.publicView(st), ...(over ?? {}) }; delete v.log; frames.push(JSON.parse(JSON.stringify(v))); };
  const reply = () => ({ version, seat: 0, pending: -1, public: { ...BJ.publicView(s), frames }, private: null });
  const ctx = await browser.newContext({ viewport: { width: W, height: W < 500 ? 844 : 800 }, deviceScaleFactor: W < 500 ? 2 : 1 });
  await ctx.addInitScript(() => { localStorage.setItem("gm_player", "SplitTester"); localStorage.setItem("gm_sound", "off"); localStorage.setItem("cards_speed", "1"); localStorage.setItem("bj_bet", "25"); });
  await ctx.route("**/functions/v1/cards", async (route) => {
    const b = JSON.parse(route.request().postData() || "{}"); frames = [];
    try {
      const c = { rng: seededRng(version), now: Date.now() };
      if (b.action === "join" && !s.seats.some((x) => x.kind === "human")) { s = BJ.seatHuman(s, 0, { name: "SplitTester", tokenHash: "t", stack: 1000 }, c); version++; frames = []; }
      else if (b.action === "act") { s = BJ.apply(s, 0, b.move, c); version++; }
      await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(reply()) });
    } catch (e) { await route.fulfill({ status: 400, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: e.message }) }); }
  });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const where = () => p.evaluate(() => { const a = document.querySelector(".bj-acts"); const h = a?.closest(".bj-hand"); return h ? h.id : a ? "outside" : "none"; });
  const overlap = () => p.evaluate(() => { const a = document.querySelector(".bj-acts")?.getBoundingClientRect(); if (!a) return -1; let worst = 0;
    for (const c of document.querySelectorAll(".bj-hand .pc")) { const r = c.getBoundingClientRect(); const x = Math.max(0, Math.min(a.right, r.right) - Math.max(a.left, r.left)), y = Math.max(0, Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top)); worst = Math.max(worst, x * y); } return Math.round(worst); });
  try {
    await p.goto(B + "#/blackjack?mode=solo&seats=2&bot=medium&room=splittest" + W); await p.waitForSelector(".bet-box", { timeout: 30000 });
    await p.locator(".bj-controls button:has-text('Deal')").click();
    await p.waitForSelector(".bj-acts button:has-text('Split'):not([disabled])", { timeout: 15000 }); await p.waitForTimeout(1200);
    await p.locator(".bj-acts button:has-text('Split')").click();
    await p.waitForSelector(".bj-acts button:has-text('Stand'):not([disabled])", { timeout: 15000 }); await p.waitForTimeout(1500);
    const hands = await p.locator(".bjs.mine .bj-hand").count(); const w1 = await where(); const o1 = await overlap();
    await p.screenshot({ path: `${OUT}/split-${W}-hand1.png` });
    await p.locator(".bj-acts button:has-text('Stand')").click();
    await p.waitForFunction(() => document.querySelector(".bj-acts")?.closest(".bj-hand")?.id?.endsWith("h1") && !document.querySelector(".bj-acts button:has-text('Stand')")?.disabled, null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const w2 = await where(); const o2 = await overlap();
    await p.screenshot({ path: `${OUT}/split-${W}-hand2.png` });
    await p.locator(".bj-acts button:has-text('Stand')").click();
    let sawReplay = false; for (let k = 0; k < 40; k++) { await p.waitForTimeout(100); if (await p.locator(".replay-bar.on").count()) sawReplay = true; else if (sawReplay) break; }
    await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/split-${W}-end.png` });
    const res = await p.locator(".bjs.mine .res").allTextContents();
    const ok = hands === 2 && w1 === "bj-s0-h0" && w2 === "bj-s0-h1" && o1 === 0 && o2 === 0 && sawReplay && !errs.length;
    if (!ok) fails++;
    console.log(`${ok ? "OK  " : "FAIL"} split-${W} hands=${hands} tray(hand1)=${w1} tray(after stand)=${w2} trayOverlapPx=${o1}/${o2} replay=${sawReplay} results=${res.join(",")} errs=${errs.join(";")}`);
  } catch (e) { fails++; console.log(`FAIL split-${W}`, e.message.split("\n")[0], errs); await p.screenshot({ path: `${OUT}/split-${W}-fail.png` }); }
  await ctx.close();
}
await browser.close(); process.exit(fails ? 1 : 0);
