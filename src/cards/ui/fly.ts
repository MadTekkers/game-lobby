// Card-table motion: cards fly from the shoe / deck to their spot in real deal order, chips slide between spots.
// Everything is skipped when the user prefers reduced motion.
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Deal speed: 0 = instant (no motion), otherwise a multiplier (0.25x–3x). Persisted; reduced-motion users default to instant.
const SPEED_KEY = "cards_speed";
let speedV: number | null = null; const speedSubs = new Set<() => void>();
export function dealSpeed(): number {
  if (speedV === null) {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SPEED_KEY) : null; const n = raw === null ? NaN : Number(raw);
    speedV = Number.isFinite(n) && (n === 0 || (n >= 0.25 && n <= 3)) ? n : reducedMotion() ? 0 : 1;
  }
  return speedV;
}
export function setDealSpeed(v: number) {
  speedV = v === 0 ? 0 : Math.min(3, Math.max(0.25, v));
  try { localStorage.setItem(SPEED_KEY, String(speedV)); } catch { /* private mode */ }
  speedSubs.forEach((f) => f());
}
export function onDealSpeed(f: () => void) { speedSubs.add(f); return () => { speedSubs.delete(f); }; }
const instant = () => dealSpeed() === 0;
const sp = (ms: number) => ms / (dealSpeed() || 1);

export type Fly = { from: string; order: number; flip?: boolean; gap?: number; dur?: number };
type Job = { el: HTMLElement; f: Fly };
let queue: Job[] = []; let busyUntil = 0; let raf = 0;

/** Queue a freshly mounted card. Cards mounted in the same frame are sorted by `order` (deal order) and staggered;
 *  a later batch waits for the previous one to land, so the table reads like a dealer pitching one card at a time. */
export function flyCard(el: HTMLElement, f: Fly) {
  if (instant() || !el.animate) return;
  el.style.opacity = "0"; queue.push({ el, f });
  if (!raf) raf = requestAnimationFrame(flush);
}
function flush() {
  raf = 0; const jobs = queue.sort((a, b) => a.f.order - b.f.order); queue = [];
  const now = performance.now(); let t = Math.max(0, busyUntil - now);
  for (const { el, f } of jobs) {
    const src = document.querySelector(f.from) as HTMLElement | null; const r = el.getBoundingClientRect();
    el.style.opacity = "";
    if (!src || !r.width) continue;
    const s = src.getBoundingClientRect();
    const dx = s.left + s.width / 2 - (r.left + r.width / 2), dy = s.top + s.height / 2 - (r.top + r.height / 2);
    const dur = sp(f.dur ?? 380), delay = t;
    el.animate([{ transform: `translate(${dx}px, ${dy}px) rotate(-25deg) scale(.7)`, opacity: 0.9 }, { transform: "none", opacity: 1 }],
      { duration: dur, delay, easing: "cubic-bezier(.2,.75,.3,1)", fill: "backwards" });
    const inner = el.querySelector(".pc-in") as HTMLElement | null;
    if (inner && f.flip) inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(180deg)", offset: 0.55 }, { transform: "none" }], { duration: dur + 160, delay, easing: "ease-out", fill: "backwards" });
    t += sp(f.gap ?? 170);
  }
  busyUntil = now + t + sp(220);
}
/** Time (ms from now) until queued deals have landed — lets callers wait before e.g. sliding chips. */
export const dealBusyFor = () => Math.max(0, busyUntil - performance.now());

const DENOMS: [number, string][] = [[500, "c500"], [100, "c100"], [25, "c25"], [10, "c10"], [5, "c5"], [1, "c1"]];
/** Break a bet into casino chip colours (at most `max` discs). */
export function chipStack(amount: number, max = 7): string[] {
  const out: string[] = []; let a = Math.max(0, Math.floor(amount));
  for (const [v, c] of DENOMS) while (a >= v && out.length < max) { out.push(c); a -= v; }
  return out;
}
/** Slide a little chip stack from one element to another (position: fixed overlay, removed when done). */
export function flyChips(from: DOMRect | Element | null, to: DOMRect | Element | null, amount: number, delay = 0) {
  if (!from || !to || amount <= 0 || instant() || typeof document === "undefined") return;
  const a = from instanceof Element ? from.getBoundingClientRect() : from, b = to instanceof Element ? to.getBoundingClientRect() : to;
  if (!a.width && !a.height) return;
  const g = document.createElement("div"); g.className = "chipfly";
  for (const c of chipStack(amount, 4)) { const d = document.createElement("i"); d.className = `disc ${c}`; g.appendChild(d); }
  g.style.left = `${a.left + a.width / 2 - 11}px`; g.style.top = `${a.top + a.height / 2 - 11}px`;
  document.body.appendChild(g);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const an = g.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 1, offset: 0.85 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }],
    { duration: sp(650), delay: sp(delay), easing: "cubic-bezier(.3,.7,.3,1)", fill: "both" });
  an.onfinish = () => g.remove(); setTimeout(() => g.remove(), sp(650 + delay) + 500);
}
