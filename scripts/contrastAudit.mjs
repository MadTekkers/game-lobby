// WCAG AA text-contrast audit. For every visible element with its own text, computes the foreground colour (with ancestor
// opacity) against the effective background (semi-transparent layers composited; gradients checked at every colour stop,
// worst case kept). Normal text needs 4.5:1, large text (≥24px, or ≥18.66px bold) 3:1.
// Usage: BASE=<url> PAGES="label=#/route,..." WIDTH=390 node scripts/contrastAudit.mjs   (writes /workspace/reports/contrast-<label>.json)
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const B = process.env.BASE || "http://localhost:4191/";
const W = Number(process.env.WIDTH || 390);
const PAGES = (process.env.PAGES || "").split(",").filter(Boolean).map((x) => { const i = x.indexOf("="); return [x.slice(0, i), x.slice(i + 1)]; });
const WAIT = Number(process.env.WAIT || 9000);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let total = 0;
for (const [label, route] of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => { localStorage.setItem("gm_player", "UiTester"); localStorage.setItem("gm_sound", "off"); });
  const p = await ctx.newPage(); await p.goto(B + route); await p.waitForTimeout(WAIT);
  if (process.env.CLICK) for (const sel of process.env.CLICK.split("|")) { await p.click(sel, { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(1500); }
  const bad = await p.evaluate(() => {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
    const stops = (img) => [...img.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0]));
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
    // all candidate opaque backgrounds behind el (list because gradients give several)
    const bgs = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e);
      const felt = el.closest("[data-felt]"); let layers = [felt ? [...felt.dataset.felt.split(",").map(Number), 1] : [255, 255, 255, 1]];
      for (const e of chain.reverse()) { if (felt && !felt.contains(e)) continue; const cs = getComputedStyle(e); const img = cs.backgroundImage; const col = parse(cs.backgroundColor);
        if (img && img !== "none" && img.includes("gradient")) { const st = stops(img).filter(Boolean); if (st.length) layers = st.flatMap((s) => layers.map((l) => over(s, l))); }
        else if (col && col[3] > 0) layers = layers.map((l) => over(col, l)); }
      return layers; };
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0); if (!own) continue;
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      if (op < 0.05) continue;
      if (el.closest("[aria-hidden=true], .pc-back, svg, input, select")) continue;
      if (el.closest("button:disabled")) continue; // WCAG exempts inactive controls
      const fg0 = parse(cs.color); if (!fg0) continue;
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700; const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      let worst = 99, wbg = null;
      for (const bg of bgs(el)) { const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg); const c = ratio(fg, bg); if (c < worst) { worst = c; wbg = bg; } }
      if (worst < need) { const path = []; for (let e = el; e && e !== document.body && path.length < 4; e = e.parentElement) path.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 3).join(".") : ""));
        out.push({ text: el.textContent.trim().slice(0, 60), ratio: Math.round(worst * 100) / 100, need, color: cs.color, bg: `rgb(${wbg.slice(0, 3).map(Math.round).join(",")})`, size, path: path.join(" > ") }); }
    }
    return out;
  });
  const uniq = [...new Map(bad.map((b) => [b.path + "|" + b.color + "|" + b.text.slice(0, 20), b])).values()];
  total += uniq.length;
  writeFileSync(`/workspace/reports/contrast-${label}.json`, JSON.stringify(uniq, null, 1));
  console.log(`${label} (${W}px): ${uniq.length} failing text elements`); for (const b of uniq.slice(0, 40)) console.log("  ", b.ratio, "<", b.need, JSON.stringify(b.text), b.color, "on", b.bg, "|", b.path);
  await p.screenshot({ path: `/workspace/screenshots/ui2/contrast-${label}.png`, fullPage: true });
  await ctx.close();
}
await browser.close(); console.log("TOTAL", total);
