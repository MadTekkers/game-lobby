// Two browsers at one live Blackjack table: when one player acts, the other sees the same replay over realtime and both end on
// the same table state (no desync). Usage: BASE=<url> node scripts/liveReplaySync.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE || "https://game-lobby-games.vercel.app/";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const room = "rs" + Math.random().toString(36).slice(2, 10);
const mk = async (name, W) => { const c = await browser.newContext({ viewport: { width: W, height: 844 } });
  await c.addInitScript((n) => { localStorage.setItem("gm_player", n); localStorage.setItem("gm_sound", "off"); localStorage.setItem("cards_speed", "1"); }, name);
  const p = await c.newPage(); await p.goto(B + `#/blackjack?mode=live&seats=3&bot=medium&room=${room}`); return p; };
const A = await mk("Alice", 390); await A.waitForSelector(".bet-box", { timeout: 30000 });
const Bp = await mk("Bob", 1280); await Bp.waitForSelector(".bet-box, .bj-controls", { timeout: 30000 });
const sawReplay = { Alice: 0, Bob: 0 }; let rounds = 0; let mismatches = 0;
const watch = (p, n) => p.evaluate(() => !!document.querySelector(".replay-bar.on")).then((on) => { if (on) sawReplay[n]++; });
const snap = (p) => p.evaluate(() => JSON.stringify({ d: [...document.querySelectorAll(".bj-dealer-cards .pc.up")].map((x) => x.textContent), round: document.querySelector(".bj-foot .tiny")?.textContent?.match(/round (\d+)/)?.[1] }));
for (let step = 0; step < 160 && rounds < 3; step++) {
  await A.waitForTimeout(150); await watch(A, "Alice"); await watch(Bp, "Bob");
  for (const p of [A, Bp]) {
    const deal = p.locator(".bj-controls button:has-text('Deal'):not([disabled])"); if (await deal.count()) { await deal.click().catch(() => {}); continue; }
    const st = p.locator(".bj-acts button:has-text('Stand'):not([disabled])"); if (await st.count()) { await st.click().catch(() => {}); continue; }
    const no = p.locator(".bj-acts button:has-text('No thanks'):not([disabled])"); if (await no.count()) await no.click().catch(() => {});
  }
  // both back at betting with nothing replaying: compare
  const idle = await Promise.all([A, Bp].map((p) => p.evaluate(() => !document.querySelector(".replay-bar.on") && !!document.querySelector(".bet-box"))));
  if (idle[0] && idle[1]) { const [a, b] = await Promise.all([snap(A), snap(Bp)]); const r = JSON.parse(a).round;
    if (r && r !== String(rounds + 1)) { rounds = Number(r) - 1; if (a !== b) { mismatches++; console.log("mismatch", a, b); } else console.log("round", r, "in sync", a); } }
}
console.log(JSON.stringify({ room, rounds, sawReplay, mismatches }));
await browser.close(); process.exit(rounds >= 2 && !mismatches && sawReplay.Alice && sawReplay.Bob ? 0 : 1);
