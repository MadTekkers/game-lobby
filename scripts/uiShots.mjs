// Screenshots of the card tables at phone and laptop widths.
// Usage: BASE=<url> OUT=/workspace/screenshots/ui2 SHOTS="label|#/route|step;step..." node scripts/uiShots.mjs
// steps: click:<selector>  wait:<selector>  sleep:<ms>  shot:<name>  eval:<js>
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const B = process.env.BASE || "http://localhost:4191/";
const OUT = process.env.OUT || "/workspace/screenshots/ui2";
const WIDTHS = (process.env.WIDTHS || "390,1280").split(",").map(Number);
const RM = process.env.REDUCED === "1";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
for (const spec of (process.env.SHOTS || "").split("||").filter(Boolean)) {
  const [label, route, steps = ""] = spec.split("|");
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 800 }, deviceScaleFactor: w < 600 ? 2 : 1, reducedMotion: RM ? "reduce" : "no-preference" });
    const p = await ctx.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await p.goto(B + route);
    for (const st of steps.split(";").filter(Boolean)) {
      const i = st.indexOf(":"); const k = st.slice(0, i), v = st.slice(i + 1);
      try {
        if (k === "click") await p.click(v, { timeout: 20000 });
        else if (k === "try") await p.click(v, { timeout: 4000 }).catch(() => {});
        else if (k === "wait") await p.waitForSelector(v, { timeout: 30000 });
        else if (k === "sleep") await p.waitForTimeout(Number(v));
        else if (k === "eval") await p.evaluate(v);
        else if (k === "shot") { const f = `${OUT}/${label}-${v}-${w}.png`; await p.screenshot({ path: f, fullPage: process.env.FULL === "1" }); console.log("shot", f); }
      } catch (e) { console.log(label, w, "step failed", st, String(e).split("\n")[0]); }
    }
    if (errs.length) console.log(label, w, "errors:", errs.slice(0, 5).join(" | "));
    await ctx.close();
  }
}
await browser.close();
