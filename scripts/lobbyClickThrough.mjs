// "Create lobby -> Start" click-through for each live card game: host creates a lobby, a guest joins by the lobby link,
// host presses Start, both land on the table and the first hand is dealt. Usage: BASE=<url> GAMES=blackjack,spades node scripts/lobbyClickThrough.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE || "http://127.0.0.1:5199/";
const GAMES = (process.env.GAMES || "blackjack,spades").split(",");
const READY = { blackjack: ".bet-box", spades: ".tt-me", hearts: ".fan-c", holdem: ".hm-me" };
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const mk = async (name) => { const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  await ctx.addInitScript((n) => { localStorage.setItem("gm_player", n); localStorage.setItem("gm_sound", "off"); }, name);
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log(name, "PAGEERR", e.message)); return p; };
let fails = 0;
for (const g of GAMES) {
  const H = await mk("Host" + g.slice(0, 2)), G = await mk("Guest" + g.slice(0, 2));
  try {
    await H.goto(B + "#/play/" + g); await H.click("text=Live table"); await H.click("text=Create lobby");
    await H.waitForSelector("text=Start game", { timeout: 20000 }); const lobby = H.url();
    await G.goto(lobby); await H.waitForTimeout(2500);
    await H.click("text=Start game");
    await Promise.all([H.waitForSelector(READY[g], { timeout: 30000 }), G.waitForSelector(READY[g] + (g === "blackjack" ? "" : ", .tt-me"), { timeout: 30000 })]);
    const hn = await H.evaluate(() => document.querySelectorAll(".tt-seat, .bj-seat").length);
    await H.screenshot({ path: `/workspace/screenshots/lobby-${g}-host.png`, fullPage: true }); await G.screenshot({ path: `/workspace/screenshots/lobby-${g}-guest.png`, fullPage: true });
    const gt = await G.textContent("body");
    console.log(g, "OK host", H.url().split("#")[1], "| seats rendered", hn, "| guest sees host:", gt.includes("Host" + g.slice(0, 2)));
  } catch (e) { fails++; console.log(g, "FAIL", e.message.split("\n")[0]); await H.screenshot({ path: `/workspace/screenshots/lobby-${g}-fail.png`, fullPage: true }); }
  await H.context().close(); await G.context().close();
}
await browser.close(); process.exit(fails ? 1 : 0);
