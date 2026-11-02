// Frame-timing check for the Deep Dive countdown at 390 px (phone-like 4x CPU throttle).
// Usage: BASE=<url> [ANIM=on|off] node scripts/deepdive/perf.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const bank = JSON.parse(readFileSync(new URL("../../src/games/deepdive/bank.json", import.meta.url)));
const B = (process.env.BASE || "http://localhost:4297/").replace(/\/?$/, "/");
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(([anim, process_snd]) => { localStorage.setItem("gm_player", "PerfTest"); localStorage.setItem("dd_intro_v1", "1"); if (process_snd) localStorage.setItem("gm_sound", "off"); if (anim) localStorage.setItem("dd_anim", anim); }, [process.env.ANIM || "", process.env.MUTE === "1"]);
const p = await ctx.newPage();
// Headless Chrome fetches and decodes the favicon the first time a page plays audio (tab audio indicator); that ~200 ms
// browser task lands in the answer transition and is not app work. NOFAV=1 aborts it so the app's own frames are measured.
if (process.env.NOFAV) await p.route("**/favicon.svg", (r) => r.abort());
const cdp = await ctx.newCDPSession(p);
await cdp.send("Performance.enable");
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU || 4) });
await p.goto(B + "#/deepdive?v=dive&k=endless");
await p.getByRole("button", { name: /Start dive/ }).click();
await p.waitForSelector(".dd-answer input", { timeout: 10000 });
await p.waitForTimeout(500);
const measure = (secs) => p.evaluate((secs) => new Promise((res) => {
  const d = []; let last = performance.now(); const end = last + secs * 1000;
  const f = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(d.slice(1)); };
  requestAnimationFrame(f);
}), secs);
const summ = (d) => { d = [...d].sort((a, b) => a - b); return { frames: d.length, p95ms: d[Math.floor(d.length * .95)].toFixed(1), maxms: d[d.length - 1].toFixed(1), over34ms: d.filter((x) => x > 34).length }; };
const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
const before = await m();
const SECS = Number(process.env.SECS || 6);
const frames = await p.evaluate((secs) => new Promise((res) => {
  const d = []; let last = performance.now(); const end = last + secs * 1000;
  const loaf = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => loaf.push(e.duration))).observe({ type: "long-animation-frame", buffered: false }); } catch {}
  const f = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res({ d, loaf }); };
  requestAnimationFrame(f);
}), SECS);
const after = await m();
const d = frames.d.slice(1).sort((a, b) => a - b);
const pct = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))].toFixed(1);
const per = (k) => ((after[k] - before[k]) / SECS).toFixed(1);
console.log(JSON.stringify({
  frames: d.length, fps: (d.length / SECS).toFixed(1), p50ms: pct(0.5), p95ms: pct(0.95), maxms: d[d.length - 1].toFixed(1),
  over34ms: d.filter((x) => x > 34).length, longAnimFrames: frames.loaf.length,
  layoutsPerSec: per("LayoutCount"), styleRecalcsPerSec: per("RecalcStyleCount"), scriptMsPerSec: ((after.ScriptDuration - before.ScriptDuration) * 1000 / SECS).toFixed(1),
}));
// answer -> feedback: diver sinks, water darkens, numbers count, bars grow
const q = (await p.locator(".dd-prompt").first().textContent()).trim();
const pr = bank.prompts.find((x) => x.q === q);
await p.locator(".dd-answer input").fill(pr.answers[pr.answers.length - 1].t);
const b2 = await m();
const [fb] = await Promise.all([measure(1.5), p.keyboard.press("Enter")]);
const a2 = await m();
console.log("answer->feedback transition (1.5 s):", JSON.stringify({ ...summ(fb), layouts: a2.LayoutCount - b2.LayoutCount }));
await browser.close();
