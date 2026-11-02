// Animations On/Off for Deep Dive. Saved in localStorage ("dd_anim" = "on" | "off");
// with no saved choice it follows the OS reduced-motion setting.
import { createElement, useLayoutEffect, useRef, useSyncExternalStore } from "react";

const KEY = "dd_anim";
const RM = "(prefers-reduced-motion: reduce)";
const subs = new Set<() => void>();
function osReduced() { return typeof matchMedia === "function" && matchMedia(RM).matches; }
export function animOn(): boolean {
  const v = localStorage.getItem(KEY);
  return v === "on" ? true : v === "off" ? false : !osReduced();
}
export function setAnim(on: boolean) { localStorage.setItem(KEY, on ? "on" : "off"); subs.forEach((f) => f()); }
function subscribe(f: () => void) {
  subs.add(f);
  const m = typeof matchMedia === "function" ? matchMedia(RM) : null;
  m?.addEventListener("change", f);
  return () => { subs.delete(f); m?.removeEventListener("change", f); };
}
export function useAnim(): boolean { return useSyncExternalStore(subscribe, animOn, () => true); }

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Eased number count via requestAnimationFrame, written straight to the DOM (no React re-render per frame). */
export function useCountUp<T extends HTMLElement>(value: number, format: (n: number) => string, ms = 800, from?: number) {
  const ref = useRef<T>(null);
  const shown = useRef(from ?? value);
  const on = useAnim();
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const from = shown.current, to = value;
    if (!on || from === to) { shown.current = to; el.textContent = format(to); return; }
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = Math.round(from + (to - from) * easeOut(k));
      shown.current = v; el.textContent = format(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, on, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

/** A number that eases to its new value (instantly when animations are off). */
export function CountUp({ value, format = String, className, from, ms }: { value: number; format?: (n: number) => string; className?: string; from?: number; ms?: number }) {
  const ref = useCountUp<HTMLSpanElement>(value, format, ms, from);
  return createElement("span", { ref, className });
}
