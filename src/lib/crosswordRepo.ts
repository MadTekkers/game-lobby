import { supabase } from "./supabase";
import type { CW } from "../games/puzzleData";
export type CwMeta = { id: number; size: number; difficulty: string; created_at: string };
export const LEN_TO_SIZE: Record<string, number> = { "5": 7, "10": 11, "30": 15 };
export const SIZE_TO_LEN: Record<number, string> = { 7: "5", 11: "10", 15: "30" };
export const playedSet = (): Set<number> => new Set(JSON.parse(localStorage.getItem("gm_cw_played") || "[]"));
export function markPlayed(id: number) { const s = playedSet(); s.add(id); localStorage.setItem("gm_cw_played", JSON.stringify([...s])); }

export async function listCrosswords(f: { size?: number; difficulty?: string; order?: "newest" | "oldest" }): Promise<CwMeta[]> {
  if (!supabase) return [];
  let q = supabase.from("crosswords").select("id,size,difficulty,created_at").order("created_at", { ascending: f.order === "oldest" }).order("id", { ascending: f.order === "oldest" }).limit(500);
  if (f.size) q = q.eq("size", f.size); if (f.difficulty) q = q.eq("difficulty", f.difficulty);
  const { data } = await q; return (data as CwMeta[]) || [];
}
export async function countCrosswords(): Promise<number> {
  if (!supabase) return 0; const { count } = await supabase.from("crosswords").select("id", { count: "exact", head: true }); return count || 0;
}
export async function getCrossword(id: number): Promise<CW | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("crosswords").select("*").eq("id", id).maybeSingle();
  return data ? ({ size: data.size, difficulty: data.difficulty, grid: data.grid, across: data.across, down: data.down } as CW) : null;
}
/** Newest unplayed puzzle for a size/difficulty (falls back to newest). */
export async function pickCrossword(size: number, difficulty: string): Promise<number | null> {
  const list = await listCrosswords({ size, difficulty }); const played = playedSet();
  return (list.find((x) => !played.has(x.id)) || list[0])?.id ?? null;
}
