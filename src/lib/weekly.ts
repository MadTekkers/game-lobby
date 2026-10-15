import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Weekly puzzles live in Supabase `weekly_puzzles`; in URLs/rooms they use p = WEEKLY_BASE + row id. */
export const WEEKLY_BASE = 100000;
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKLY_GAMES = ["wordle", "connections", "strands", "mini", "bee"] as const;
export type WRow = { id: number; week_start: string; day: number; game: string; difficulty: string; data: any };

/** Weeks start Monday, America/Chicago (same as the generator). */
function chicagoToday() {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(s + "T00:00:00Z");
}
export function todayDay() { return (chicagoToday().getUTCDay() + 6) % 7; }
export function thisWeek() { const d = chicagoToday(); d.setUTCDate(d.getUTCDate() - todayDay()); return d.toISOString().slice(0, 10); }
export function weekLabel(w: string) { return "Week of " + new Date(w + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }); }
export const weeklyDiff = (game: string, d?: string) => (game === "connections" ? d || "easy" : "");
export const isWeekly = (p: number | null | undefined) => p != null && p >= WEEKLY_BASE;

const rowCache = new Map<number, Promise<WRow | null>>();
export function getWeekly(id: number) {
  if (!rowCache.has(id)) rowCache.set(id, (async () => {
    if (!supabase) return null;
    const { data } = await supabase.from("weekly_puzzles").select("id,week_start,day,game,difficulty,data").eq("id", id).maybeSingle();
    return (data as WRow) || null;
  })());
  return rowCache.get(id)!;
}

let weeksP: Promise<string[]> | null = null;
/** Weeks that have started (current week first). Next week is pre-generated but hidden until Monday. */
export function listWeeks() {
  if (!weeksP) weeksP = (async () => {
    if (!supabase) return [];
    const { data } = await supabase.from("weekly_puzzles").select("week_start").eq("game", "wordle").eq("day", 0).lte("week_start", thisWeek()).order("week_start", { ascending: false });
    return [...new Set((data || []).map((r: any) => r.week_start as string))];
  })();
  return weeksP;
}
export function useWeeks() { const [w, setW] = useState<string[] | null>(null); useEffect(() => { listWeeks().then(setW); }, []); return w; }

type Meta = Omit<WRow, "data">;
const weekCache = new Map<string, Promise<Meta[]>>();
/** All puzzle rows (without data) for a week. */
export function weekRows(week: string) {
  if (!weekCache.has(week)) weekCache.set(week, (async () => {
    if (!supabase) return [];
    const { data } = await supabase.from("weekly_puzzles").select("id,week_start,day,game,difficulty").eq("week_start", week).order("day");
    return (data as Meta[]) || [];
  })());
  return weekCache.get(week)!;
}
export async function findWeekly(week: string, game: string, difficulty: string, day: number) {
  return (await weekRows(week)).find((r) => r.game === game && r.difficulty === difficulty && r.day === day) || null;
}
export async function weekPoolIds(week: string, game: string, difficulty: string) {
  return (await weekRows(week)).filter((r) => r.game === game && r.difficulty === difficulty).map((r) => r.id + WEEKLY_BASE);
}

/** Loads the weekly row for a puzzle index (null when not a weekly index or still loading). */
export function useWeeklyRow(idx: number | null) {
  const [row, setRow] = useState<WRow | null>(null);
  useEffect(() => { setRow(null); if (isWeekly(idx)) getWeekly(idx! - WEEKLY_BASE).then(setRow); }, [idx]);
  return isWeekly(idx) && row && row.id === idx! - WEEKLY_BASE ? row : null;
}
