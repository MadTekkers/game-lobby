// Replay check: in each card game, make a move and watch the rest of the deal play out step by step (bot actions, dealer draws,
// trick cards, streets), with inputs disabled until it ends; then check tap-to-skip and the Instant setting.
// Usage: BASE=<url> GAMES=blackjack,spades,hearts,holdem WIDTHS=390,1280 OUT=/workspace/screenshots/tables/replay node scripts/replayCheck.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const B = process.env.BASE || "http://localhost:4191/";
const OUT = process.env.OUT || "/workspace/screenshots/tables/replay"; mkdirSync(OUT, { recursive: true });
const GAMES = (process.env.GAMES || "blackjack,spades,hearts,holdem").split(",");
const WIDTHS = (process.env.WIDTHS || "390,1280").split(",").map(Number);
const SPEED = process.env.SPEED || "1";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ROUTE = { blackjack: "#/blackjack?mode=solo&seats=3&bot=medium", spades: "#/spades?mode=solo&seats=4&bot=medium", hearts: "#/hearts?mode=solo&seats=4&bot=medium", holdem: "#/holdem?mode=solo&seats=6&bot=medium" };
const READY = { blackjack: ".bet-box, .bj-acts", spades: ".tt-me", hearts: ".fan-c", holdem: ".pk-me" };
// what to sample while a replay runs
const METRIC = {
  blackjack: () => ({ d: document.querySelectorAll(".bj-dealer-cards .pc").length, up: document.querySelectorAll(".bj-dealer-cards .pc.up").length, said: document.querySelector(".bj-said")?.textContent || "", dturn: !!document.querySelector(".bj-dealer.turn"), turn: [...document.querySelectorAll(".bjs")].findIndex((x) => x.classList.contains("turn")), cards: document.querySelectorAll(".bjs .pc").length }),
  spades: () => ({ t: document.querySelectorAll(".tt-center:not(.tt-ghost) .tt-play").length, ghost: !!document.querySelector(".tt-ghost"), turn: document.querySelector(".tt-seat.turn")?.className.split(" ")[1] || "" }),
  holdem: () => ({ b: document.querySelectorAll(".pk-board .pc.up").length, turn: [...document.querySelectorAll(".pks")].findIndex((x) => x.classList.contains("turn")), lasts: [...document.querySelectorAll(".pks")].map((x) => x.querySelector(".pk-last, .last")?.textContent || "").join("|") }),
};
METRIC.hearts = METRIC.spades;
const inputsDisabled = () => { const b = [...document.querySelectorAll(".bj-acts button, .bet-box .controls button, .pk-actions button, .fan-c, .bidpad button")]; return b.length ? (b.every((x) => x.disabled) || b.filter((x) => !x.disabled).map((x) => x.textContent.trim().slice(0, 12)).join(",")) : null; };

async function move(p, game) {
  if (game === "blackjack") {
    if (await p.locator(".bj-acts button:has-text('Stand'):not([disabled])").count()) { await p.locator(".bj-acts button:has-text('Stand')").click(); return "stand"; }
    const d = p.locator(".bj-controls button:has-text('Deal'):not([disabled])"); if (await d.count()) { await d.click(); return "deal"; }
    return null;
  }
  if (game === "holdem") {
    const b = p.locator('.pk-actions button:has-text("Call"):not([disabled]), .pk-actions button:has-text("Check"):not([disabled])');
    if (await b.count()) { await b.first().click(); return "call/check"; }
    const nx = p.locator('button:has-text("Next hand"):not([disabled]), button:has-text("Deal the first"):not([disabled])'); if (await nx.count()) { await nx.first().click(); return "next"; }
    return null;
  }
  // trick games
  const start = p.locator('button:has-text("Deal the first hand"):not([disabled])'); if (await start.count()) { await start.click(); return "start"; }
  const look = p.locator('button:has-text("Look at my cards"):not([disabled])'); if (await look.count()) { await look.click(); return "look"; }
  const bid = p.locator(".bidpad button:not([disabled])"); if (await bid.count()) { await bid.nth(Math.min(3, (await bid.count()) - 1)).click(); return "bid"; }
  const keep = p.locator('button:has-text("Keep"):not([disabled])'); if (await keep.count()) { await keep.click(); return "keep"; }
  const pass = p.locator(".hrt-pass button"); if (await pass.count()) { const c = p.locator(".fan-c"); for (const k of [0, 1, 2]) await c.nth(k).click({ position: { x: 6, y: 20 } }); await pass.click(); return "pass"; }
  const ok = p.locator(".fan-c.ok:not([disabled])"); if (await ok.count()) { await ok.first().click({ position: { x: 6, y: 20 } }); return "play"; }
  return null;
}

let fails = 0; const summary = [];
for (const game of GAMES) for (const W of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: W, height: W < 500 ? 844 : 800 }, deviceScaleFactor: W < 500 ? 2 : 1 });
  await ctx.addInitScript((sp) => { localStorage.setItem("gm_player", "ReplayTester"); localStorage.setItem("gm_sound", "off"); localStorage.setItem("cards_speed", sp); localStorage.setItem("cards_sheet", "0"); }, SPEED);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const frames = []; let leak = "";
  p.on("response", async (r) => {
    if (!r.url().includes("/functions/v1/cards")) return;
    try { const j = await r.json(); const f = j?.public?.frames; if (Array.isArray(f)) { frames.push(f.length);
      for (const x of f) { if (x.holes && !x.tutorial) leak = "holdem holes"; if (x.holeHidden && x.dealer?.[1]) leak = "bj hole"; if (x.hands && !x.tutorial) leak = "hands"; if (x.shoe || x.deck) leak = "deck"; } } } catch {}
  });
  const tag = `${game}-${W}`; const r = { tag, replays: 0, maxSteps: 0, disabledOk: true, skipOk: null, seen: new Set(), notes: [] };
  try {
    await p.goto(B + ROUTE[game]); await p.waitForSelector(READY[game], { timeout: 40000 });
    let shotMid = false;
    for (let step = 0; step < 40 && r.replays < 3; step++) {
      await p.waitForTimeout(400);
      if (await p.locator(".replay-bar.on").count()) continue;
      const m = await move(p, game); if (!m) continue;
      // watch the replay
      const t0 = Date.now(); let started = false; const seq = [];
      while (Date.now() - t0 < 25000) {
        await p.waitForTimeout(90);
        const on = await p.locator(".replay-bar.on").count() > 0;
        if (on) { started = true; seq.push(JSON.stringify(await p.evaluate(METRIC[game])));
          const dis = await p.evaluate(inputsDisabled); if (dis !== true && dis !== null) { r.disabledOk = false; r.notes.push("enabled: " + dis); }
          if (!shotMid && Date.now() - t0 > 700) { shotMid = true; await p.screenshot({ path: `${OUT}/${tag}-mid.png` }); }
          // on the third replay, test tap-to-skip after a moment
          if (r.replays === 2 && Date.now() - t0 > 600) { const s0 = Date.now(); await p.locator(".bjt, .tt, .pkt").first().click({ position: { x: 12, y: 12 }, force: true }); await p.waitForTimeout(150); r.skipOk = (await p.locator(".replay-bar.on").count()) === 0; r.notes.push(`skip ${Date.now() - s0}ms`); break; }
        } else if (started || Date.now() - t0 > 6000) break;
      }
      if (started) { r.replays++; const uniq = seq.filter((x, i) => x !== seq[i - 1]); r.maxSteps = Math.max(r.maxSteps, uniq.length); for (const u of uniq) r.seen.add(u); r.notes.push(`${m}: ${uniq.length} steps`);
        if (game === "blackjack" && m === "stand") r.notes.push("dealer seq " + uniq.map((u) => { const o = JSON.parse(u); return `${o.d}/${o.up}${o.dturn ? "D" : ""}${o.said ? ":" + o.said : ""}`; }).join(" "));
      }
    }
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${tag}-end.png` });
    // the slider is there and persists
    const sl = await p.locator(".deal-speed input[type=range]").count();
    await p.locator(".ds-p:has-text('Fast')").click(); const saved = await p.evaluate(() => localStorage.getItem("cards_speed"));
    await p.locator(".deal-speed").scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}/${tag}-slider.png` });
    await p.locator(".ds-p:has-text('Normal')").click();
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const ok = r.replays >= 2 && r.maxSteps >= 2 && r.disabledOk && r.skipOk !== false && !leak && !errs.length && sl === 1 && saved === "2" && over <= 2;
    if (!ok) fails++;
    summary.push(`${ok ? "OK  " : "FAIL"} ${tag} replays=${r.replays} maxSteps=${r.maxSteps} frames=[${frames.join(",")}] inputsDisabled=${r.disabledOk} skip=${r.skipOk} slider=${sl} saved=${saved} overflow=${over} leak=${leak || "none"} errs=${errs.slice(0, 2).join(";")}\n     ${r.notes.join(" | ")}`);
  } catch (e) { fails++; summary.push(`FAIL ${tag} ${e.message.split("\n")[0]} ${errs.join(";")}`); await p.screenshot({ path: `${OUT}/${tag}-fail.png` }).catch(() => {}); }
  await ctx.close();
}
console.log(summary.join("\n")); await browser.close(); process.exit(fails ? 1 : 0);
