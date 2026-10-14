// Small UI effects: player colors/avatars, WebAudio sounds (toggleable), confetti, streaks.
export const PLAYER_COLORS = ["#4f85e5", "#e05c5c", "#3fae5a", "#b25fc9", "#f29b30", "#1aa3a3", "#d6589a", "#7a6ad8"];
export function playerColor(name: string) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PLAYER_COLORS[h % PLAYER_COLORS.length]; }
export const initials = (n: string) => n.trim().split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase() || "?";

export const soundOn = () => localStorage.getItem("gm_sound") !== "off";
export const setSound = (on: boolean) => localStorage.setItem("gm_sound", on ? "on" : "off");
let ctx: AudioContext | null = null;
export function beep(kind: "tap" | "good" | "bad" | "win") {
  if (!soundOn()) return;
  try {
    ctx ||= new AudioContext();
    const notes = { tap: [660], good: [660, 880], bad: [220, 180], win: [523, 659, 784, 1047] }[kind];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain(); const t = ctx!.currentTime + i * 0.09;
      o.type = kind === "bad" ? "sawtooth" : "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === "tap" ? 0.04 : 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx!.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch { /* ignore */ }
}

export function confetti() {
  const c = document.createElement("canvas"); c.className = "confetti"; document.body.appendChild(c);
  const W = (c.width = innerWidth), H = (c.height = innerHeight); const x = c.getContext("2d")!;
  const cols = ["#6aaa64", "#c9b458", "#f9df6d", "#a0c35a", "#b0c4ef", "#ba81c5", "#aedfee", "#f5d33f"];
  const ps = Array.from({ length: 140 }, () => ({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4, r: Math.random() * 6 + 4, c: cols[(Math.random() * cols.length) | 0], a: Math.random() * 6 }));
  let f = 0;
  (function step() {
    x.clearRect(0, 0, W, H);
    for (const p of ps) { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.a += 0.2; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); x.restore(); }
    if (++f < 150) requestAnimationFrame(step); else c.remove();
  })();
  beep("win");
}

/** Daily streak per game, stored locally. */
export function bumpStreak(game: string) {
  const k = `gm_streak_${game}`; const today = new Date().toDateString();
  const s = JSON.parse(localStorage.getItem(k) || '{"n":0,"last":""}');
  if (s.last === today) return s.n;
  const y = new Date(Date.now() - 86400000).toDateString();
  s.n = s.last === y ? s.n + 1 : 1; s.last = today; localStorage.setItem(k, JSON.stringify(s)); return s.n;
}
export function getStreak(game: string) {
  const s = JSON.parse(localStorage.getItem(`gm_streak_${game}`) || '{"n":0,"last":""}');
  const y = new Date(Date.now() - 86400000).toDateString();
  return s.last === new Date().toDateString() || s.last === y ? s.n : 0;
}

export function rememberRoom(r: { room: string; game: string; url: string; name?: string }) {
  const list = JSON.parse(localStorage.getItem("gm_recent_rooms") || "[]").filter((x: any) => x.room !== r.room);
  list.unshift({ ...r, at: Date.now() }); localStorage.setItem("gm_recent_rooms", JSON.stringify(list.slice(0, 8)));
}
export const recentRooms = (): { room: string; game: string; url: string; name?: string; at: number }[] => JSON.parse(localStorage.getItem("gm_recent_rooms") || "[]");
export function rememberPeers(names: string[]) {
  const s = new Set<string>(JSON.parse(localStorage.getItem("gm_peers") || "[]")); names.forEach((n) => s.add(n));
  localStorage.setItem("gm_peers", JSON.stringify([...s].slice(-50)));
}
export const knownPeers = (): string[] => JSON.parse(localStorage.getItem("gm_peers") || "[]");

export const CAPS: Record<string, number> = { shared: 8, versus: 24 };
