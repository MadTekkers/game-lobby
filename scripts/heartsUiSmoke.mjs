// UI smoke for Hearts: solo table at 360px in train + tutorial modes; passes 3 cards, plays several tricks, checks coach/tips and overflow.
// Usage: BASE=<url> node scripts/heartsUiSmoke.mjs
import { chromium } from "playwright-core";
const B = process.env.BASE || "http://127.0.0.1:4191/";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let fails = 0;
for (const [label, q, W] of [["train4", "seats=4&bot=hard&train=1", 360], ["tut4", "seats=4&bot=medium&tut=1", 320], ["train3", "seats=3&bot=medium&train=1", 390], ["two", "seats=2&bot=easy&train=1", 360]]) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 800 } });
  await ctx.addInitScript(() => { localStorage.setItem("gm_player", "UiTester"); localStorage.setItem("gm_sound", "off"); });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  try {
    await p.goto(B + "#/hearts?mode=solo&" + q); await p.waitForSelector(".fan-c", { timeout: 30000 });
    let coachSeen = 0, tipsSeen = 0, plays = 0, passed = false;
    for (let step = 0; step < 60 && plays < 8; step++) {
      await p.waitForTimeout(700);
      const passBtn = p.locator(".hrt-pass button");
      if (await passBtn.count()) {
        if (await p.locator(".tutor").count()) tipsSeen++;
        const cards = p.locator(".fan-c"); for (const k of [0, 1, 2]) await cards.nth(k).click({ position: { x: 6, y: 20 } });
        await passBtn.click(); passed = true; await p.waitForTimeout(2500); if (await p.locator(".coach, .train-card, .coach-h").count()) coachSeen++; continue;
      }
      const ok = p.locator(".fan-c.ok:not([disabled])");
      if (await ok.count()) {
        if (await p.locator(".tutor-row").count()) tipsSeen++;
        await ok.first().click({ position: { x: 6, y: 20 } }); plays++; await p.waitForTimeout(1800);
        if (await p.locator(".coach-h").count()) coachSeen++;
      }
      if (await p.locator("text=Rematch").count()) break;
    }
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await p.screenshot({ path: `/workspace/screenshots/hearts-${label}.png`, fullPage: true });
    const coachText = (await p.locator(".coach-h").count()) ? (await p.locator(".coach-h").first().textContent()) : "";
    console.log(label, `passed=${passed} plays=${plays} coach=${coachSeen} tips=${tipsSeen} overflow=${over}px errors=${errs.length}`, coachText?.slice(0, 60), errs.slice(0, 2));
    if (errs.length || over > 2 || plays < 3) fails++;
  } catch (e) { fails++; console.log(label, "FAIL", e.message.split("\n")[0], errs); await p.screenshot({ path: `/workspace/screenshots/hearts-${label}-fail.png`, fullPage: true }); }
  await ctx.close();
}
await browser.close(); process.exit(fails ? 1 : 0);
