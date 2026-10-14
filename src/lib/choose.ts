type Played = Record<string, number>;
/** Prefer puzzles nobody in the room has played; otherwise the one played longest ago. */
export function choose(ids: number[], current: number, played: Played[]): number {
  const merged: Played = {};
  for (const p of played) for (const [k, t] of Object.entries(p)) merged[+k] = Math.max(merged[+k] || 0, t);
  const fresh = ids.filter((i) => i !== current && !(i in merged));
  if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
  const others = ids.filter((i) => i !== current);
  if (!others.length) return current;
  return others.sort((a, b) => (merged[a] || 0) - (merged[b] || 0))[0];
}

