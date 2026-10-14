export function getPlayer(): string { return localStorage.getItem("gm_player") || ""; }
export function setPlayer(n: string) { localStorage.setItem("gm_player", n.trim().slice(0, 40)); }
export function ensurePlayer(): string {
  let p = getPlayer();
  if (!p) { p = (window.prompt("Your name (for history & leaderboard):") || "").trim() || `Player${Math.floor(Math.random() * 1000)}`; setPlayer(p); }
  return p;
}
export function newRoomId() { return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6); }
