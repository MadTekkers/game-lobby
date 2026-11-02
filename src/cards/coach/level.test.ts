import { describe, it, expect } from "vitest";
import { coachGate, getCoachLevel, setCoachLevel, onCoachLevel } from "./level.ts";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe("coach level", () => {
  it("new players start on Guided", () => expect(getCoachLevel("spades", mem())).toBe("guided"));
  it("is saved per game", () => {
    const kv = mem(); setCoachLevel("hearts", "off", kv); setCoachLevel("holdem", "catch", kv);
    expect(getCoachLevel("hearts", kv)).toBe("off"); expect(getCoachLevel("holdem", kv)).toBe("catch"); expect(getCoachLevel("blackjack", kv)).toBe("guided");
  });
  it("ignores junk values", () => { const kv = mem(); kv.setItem("coach_level_spades", "expert"); expect(getCoachLevel("spades", kv)).toBe("guided"); });
  it("tells listeners when it changes", () => { let k = 0; const off = onCoachLevel(() => k++); setCoachLevel("spades", "off", mem()); off(); setCoachLevel("spades", "guided", mem()); expect(k).toBe(1); });
});

describe("coach gating", () => {
  it("Guided: hint before every move (tutorial tables already have their own tips)", () => {
    for (const m of ["solo", "train", "live"] as const) expect(coachGate("guided", m)).toMatchObject({ hintBefore: true, checkBeforeSend: false, speakAfter: false });
    expect(coachGate("guided", "tutorial").hintBefore).toBe(false);
  });
  it("Catch mistakes: try-again only where nobody is waiting on you", () => {
    for (const m of ["solo", "train", "tutorial"] as const) expect(coachGate("catch", m)).toMatchObject({ hintBefore: false, checkBeforeSend: true, speakAfter: false });
    expect(coachGate("catch", "live")).toMatchObject({ hintBefore: false, checkBeforeSend: false, speakAfter: true });
  });
  it("Off: silent, but still records for review and drills", () => {
    for (const m of ["solo", "train", "tutorial", "live"] as const) expect(coachGate("off", m)).toEqual({ hintBefore: false, checkBeforeSend: false, speakAfter: false, record: true });
  });
  it("every level records", () => { for (const l of ["guided", "catch", "off"] as const) expect(coachGate(l, "live").record).toBe(true); });
});
