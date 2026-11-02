// Deep Dive's sounds (same tones and the same on/off setting as the lobby's beep()).
// Creating an AudioContext costs ~40 ms of main thread on a throttled phone profile; doing it lazily on the first
// answer would land in the middle of the feedback animation. warmAudio() builds it during idle time after the first tap instead.
import { soundOn } from "../../lib/fx";

let ctx: AudioContext | null = null;
export function warmAudio() {
  if (ctx || !soundOn() || typeof AudioContext === "undefined") return;
  const make = () => {
    try { ctx ||= new AudioContext(); } catch { /* ignore */ }
  };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(make, { timeout: 1500 }); else setTimeout(make, 200);
}
export function beep(kind: "tap" | "good" | "bad" | "win") {
  if (!soundOn()) return;
  try {
    ctx ||= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const notes = { tap: [660], good: [660, 880], bad: [220, 180], win: [523, 659, 784, 1047] }[kind];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain(); const t = ctx!.currentTime + i * 0.09;
      o.type = kind === "bad" ? "sawtooth" : "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === "tap" ? 0.04 : 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx!.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch { /* ignore */ }
}
