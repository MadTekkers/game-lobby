// Seat/table plumbing shared by the Spades, Hearts and Hold'em engines (Blackjack predates it and keeps its own).
import type { Rng } from "./core.ts";

export type Level = "easy" | "medium" | "hard";
export const LEVELS: Level[] = ["easy", "medium", "hard"];
export type Pending = { name: string; tokenHash: string; stack: number };
export type BaseSeat = {
  kind: "human" | "bot"; name: string; level: Level; variant: "A" | "B"; tokenHash?: string; stack: number;
  pending?: Pending | null; hints: number; idle: number;
};
export type Ledger = { seat: number; name: string; delta: number; reason: string; clamp?: boolean };
/** Tuned bot parameters loaded by the edge function: per level, variant A (live) and B (candidate under A/B test). */
export type ParamSet = Partial<Record<Level, { A?: Record<string, number>; B?: Record<string, number> | null }>>;
export type Ctx = { rng: Rng; now: number; params?: ParamSet };
export type LogEv = { text: string; at: number };
export type Review = { seat: number; kind: string; level: Level | null; variant: string | null; metrics: Record<string, number | boolean | string> };
export type ResultRow = { seat: number; name: string; kind: string; net: number; won: boolean; detail: Record<string, unknown> };
/** Fields every new-style table state carries (read generically by the edge function). */
export type TableBase<S extends BaseSeat> = {
  seats: S[]; log: LogEv[]; ledger: Ledger[]; results: ResultRow[]; resultSeq: number; reviews: Review[]; reviewSeq: number;
  deadline: number | null; timeoutMs: number; botLevel: Level; tutorial: boolean; live: boolean; startedAt: number; round: number;
};

export const BOT_NAMES = ["Dot", "Ace", "Lucky", "Penny", "Chip", "Rosie", "Duke", "Mo"];
export function botBase(i: number, level: Level, rng: Rng, stack = 1000): BaseSeat {
  return { kind: "bot", name: `${BOT_NAMES[i % BOT_NAMES.length]} 🤖`, level, variant: rng() < 0.5 ? "A" : "B", stack, pending: null, hints: 0, idle: 0 };
}
export function humanBase(p: Pending): BaseSeat {
  return { kind: "human", name: p.name, level: "medium", variant: "A", tokenHash: p.tokenHash, stack: p.stack, pending: null, hints: 0, idle: 0 };
}
/** Merge defaults with the tuned set for this bot's level+variant, clamped to bounds. */
export function paramsFor<P extends Record<string, number>>(defaults: Record<Level, P>, bounds: Record<string, [number, number]>, level: Level, variant: string, ctx: Ctx): P {
  const t = ctx.params?.[level]; const over = (variant === "B" ? t?.B ?? t?.A : t?.A) ?? {};
  const out = { ...defaults[level] } as Record<string, number>;
  for (const [k, v] of Object.entries(over)) if (k in out && typeof v === "number" && Number.isFinite(v)) { const b = bounds[k]; out[k] = b ? Math.max(b[0], Math.min(b[1], v)) : v; }
  return out as P;
}
export function pushLog(s: { log: LogEv[] }, text: string, now: number) { s.log.push({ text, at: now }); if (s.log.length > 60) s.log.splice(0, s.log.length - 60); }
export const humanCount = (s: { seats: BaseSeat[] }) => s.seats.filter((x) => x.kind === "human").length;
export function findSeat(s: { seats: BaseSeat[] }, tokenHash: string) { return s.seats.findIndex((x) => x.kind === "human" && x.tokenHash === tokenHash); }
export function stripSeat<S extends BaseSeat>(x: S) { const { tokenHash: _t, pending, ...rest } = x; return { ...rest, pending: pending ? { name: pending.name } : null }; }
