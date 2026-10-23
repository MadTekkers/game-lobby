// UI smoke for Hold'em: solo tables at 320–390px in train + tutorial modes; plays decisions, checks coach card / tutorial tips,
// the "Play another" button and horizontal overflow. Usage: BASE=<url> node scripts/holdemUiSmoke.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE || "http://localhost:4191/";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let fails = 0;
for (const [label, q, W] of [["train6", "seats=6&bot=hard&train=1", 360], ["tut4", "seats=4&bot=medium&tut=1", 320], ["train8", "seats=8&bot=medium&train=1", 390], ["hu", "seats=2&bot=easy&train=1", 320]]) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 820 } });
  await ctx.addInitScript(() => { localStorage.setItem("gm_player", "UiTester"); localStorage.setItem("gm_sound", "off"); });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  try {
    await p.goto(B + "#/holdem?mode=solo&" + q); await p.waitForSelector(".pk-me", { timeout: 30000 });
    let coachSeen = 0, tipsSeen = 0, acts = 0, hands = new Set(), coachText = "", maxOver = 0, shot = false;
    for (let step = 0; step < 90 && acts < 8; step++) {
      await p.waitForTimeout(600);
      maxOver = Math.max(maxOver, await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
      const hn = await p.locator(".pk-board").count() ? await p.evaluate(() => document.body.innerText.match(/Hand\s*\n?\s*(\d+)/)?.[1]) : null; if (hn) hands.add(hn);
      if (await p.locator(".coach-h").count()) { coachSeen++; coachText ||= (await p.locator(".coach").first().innerText()).slice(0, 300);
        if (!shot) { shot = true; await p.screenshot({ path: `/workspace/screenshots/holdem-${label}-coach.png`, fullPage: true }); }
        await p.locator(".coach-h .x").click(); continue; }
      if (await p.locator(".pk-actions").count()) {
        if (await p.locator(".tutor-row").count()) { tipsSeen++; if (!shot) { shot = true; await p.waitForTimeout(800); await p.screenshot({ path: `/workspace/screenshots/holdem-${label}-tips.png`, fullPage: true }); } }
        const btn = acts % 3 === 2 && (await p.locator(".pk-raise .controls button.pill:not(.sm)").count()) ? p.locator(".pk-raise .controls button.pill:not(.sm)") : p.locator('.pk-actions button:has-text("Call"), .pk-actions button:has-text("Check")').first();
        if (!(await btn.click({ timeout: 2000 }).then(() => true, () => false))) continue; acts++; await p.waitForTimeout(label.startsWith("tut") ? 600 : 1500); continue;
      }
      const nx = p.locator('button:has-text("Next hand"), button:has-text("Rebuy")'); if (await nx.count()) await nx.first().click().catch(() => {});
    }
    const another = await p.locator('button:has-text("Play another")').count();
    await p.screenshot({ path: `/workspace/screenshots/holdem-${label}.png`, fullPage: true });
    console.log(label, `acts=${acts} hands=${hands.size} coach=${coachSeen} tips=${tipsSeen} playAnother=${another} overflow=${maxOver}px errors=${errs.length}`, JSON.stringify(coachText.slice(0, 160)), errs.slice(0, 2));
    if (errs.length || maxOver > 2 || acts < 3 || (label.startsWith("tut") ? tipsSeen < 2 : coachSeen < 2)) fails++;
  } catch (e) { fails++; console.log(label, "FAIL", e.message.split("\n")[0], errs); await p.screenshot({ path: `/workspace/screenshots/holdem-${label}-fail.png`, fullPage: true }); }
  await ctx.close();
}
await browser.close(); process.exit(fails ? 1 : 0);
