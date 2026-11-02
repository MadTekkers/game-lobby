// Coach difficulty levels (saved per device, per game) and what each level is allowed to do at a given kind of table.
export type CoachGame = "blackjack" | "spades" | "hearts" | "holdem";
export type CoachLevel = "guided" | "catch" | "off";
/** solo = you vs bots, train = solo with Train mode on, tutorial = all cards face up, live = a table with other people */
export type TableMode = "solo" | "train" | "tutorial" | "live";

export const LEVELS: { id: CoachLevel; label: string; blurb: string }[] = [
  { id: "guided", label: "Guided", blurb: "The coach suggests a move before every decision." },
  { id: "catch", label: "Catch mistakes", blurb: "Quiet until you pick something the coach wouldn't — then it tells you why (and in solo play you can try again)." },
  { id: "off", label: "Off", blurb: "No hints while you play. Hand reviews and mistake drills still work." },
];
export const levelLabel = (l: CoachLevel) => LEVELS.find((x) => x.id === l)!.label;

type KV = Pick<Storage, "getItem" | "setItem">;
const store = (): KV | null => (typeof localStorage === "undefined" ? null : localStorage);
const key = (g: CoachGame) => `coach_level_${g}`;
/** New players (nothing saved yet) start on Guided. */
export function getCoachLevel(g: CoachGame, kv: KV | null = store()): CoachLevel {
  let v: string | null | undefined = null; try { v = kv?.getItem(key(g)); } catch { /* private mode */ }
  return v === "guided" || v === "catch" || v === "off" ? v : "guided";
}
const subs = new Set<() => void>();
export const onCoachLevel = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setCoachLevel(g: CoachGame, l: CoachLevel, kv: KV | null = store()) { try { kv?.setItem(key(g), l); } catch { /* private mode */ } subs.forEach((f) => f()); }

export type Gate = {
  /** show the coach's suggestion before the move */ hintBefore: boolean;
  /** check the move before sending it; if it's a mistake, offer "keep it / try again" */ checkBeforeSend: boolean;
  /** after a move that differs from the coach, say so (no undo) */ speakAfter: boolean;
  /** record decisions for hand review and drills */ record: boolean;
};
/** What the coach may do. Tutorial tables already show tips before every move, so the level only adds the catch step there.
 *  Undo/try-again only exists where nobody else is waiting on you (solo, train, tutorial) — never at a live table. */
export function coachGate(level: CoachLevel, mode: TableMode): Gate {
  const canUndo = mode !== "live";
  return {
    hintBefore: level === "guided" && mode !== "tutorial",
    checkBeforeSend: level === "catch" && canUndo,
    speakAfter: level === "catch" && !canUndo,
    record: true,
  };
}
