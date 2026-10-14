const EPOCH = Date.UTC(2026, 9, 1);
export function dayIndex(d = new Date()): number {
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((local - EPOCH) / 86400000);
}
export function dailyPick<T>(list: T[], offset = 0): { item: T; index: number } {
  const n = list.length;
  const index = (((dayIndex() + offset) % n) + n) % n;
  return { item: list[index], index };
}
export function fmtTime(s: number) { const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; }
