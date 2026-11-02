import { describe, it, expect } from "vitest";
import { classify, recordDecision, loadLog, loadDrills, handDecisions, recentHands, addDrill, answerDrill, dueDrills, sessionQueue, requeue, gradeHand, RETIRE_AFTER, AGAIN_AFTER_MS, LOG_MAX, type Decision, type KV } from "./record.ts";
import { bjDecision, bjVariant, bjSig } from "../blackjack/review.ts";
import { seededRng } from "../core.ts";
import type { Row } from "../blackjack/sim.ts";

const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; };
let n = 0;
const dec = (o: Partial<Decision> = {}): Decision => ({
  id: `d${++n}`, game: "blackjack", hand: "room:0:1", handLabel: "Round 1", at: 1000 + n, step: "First move", situation: "16 vs 10",
  chosen: { key: "stand", label: "Stand" }, best: { key: "hit", label: "Hit" }, verdict: "mistake", why: "…", cost: "", sig: "bj|hard16|10|d",
  spot: { prompt: "?", groups: [], facts: [], options: [{ key: "hit", label: "Hit" }, { key: "stand", label: "Stand" }], ok: ["hit"], best: "hit", why: "…" }, ...o });

describe("classify", () => {
  const rows = [{ key: "hit", label: "Hit", ev: -0.50, seGap: 0.01 }, { key: "stand", label: "Stand", ev: -0.54, seGap: 0.01 }, { key: "double", label: "Double", ev: -1.0, seGap: 0.01 }];
  it("best move", () => expect(classify(rows, "hit", 0.02).verdict).toBe("best"));
  it("a real gap is a mistake", () => { const c = classify(rows, "double", 0.02); expect(c.verdict).toBe("mistake"); expect(c.gap).toBeCloseTo(0.5); });
  it("a gap inside the trivial margin is close, not a mistake", () => expect(classify(rows, "stand", 0.05).verdict).toBe("close"));
  it("a gap inside the simulation noise is close", () => expect(classify([{ key: "a", label: "A", ev: 1, seGap: 0 }, { key: "b", label: "B", ev: 0.9, seGap: 0.1 }], "b", 0).verdict).toBe("close"));
  it("an option the coach didn't score counts as a mistake", () => expect(classify(rows, "split", 0.02).verdict).toBe("mistake"));
  it("lists every acceptable answer for drills", () => expect(classify(rows, "hit", 0.05).ok).toEqual(["hit", "stand"]));
});

describe("decision recording", () => {
  it("stores decisions per game and groups them by hand", () => {
    const kv = mem();
    recordDecision(dec({ verdict: "best", chosen: { key: "hit", label: "Hit" } }), kv);
    recordDecision(dec({ hand: "room:0:2", handLabel: "Round 2" }), kv);
    recordDecision(dec({ game: "spades", hand: "x:0:1", sig: "sp|1" }), kv);
    expect(loadLog("blackjack", kv)).toHaveLength(2);
    expect(loadLog("spades", kv)).toHaveLength(1);
    expect(handDecisions("blackjack", "room:0:1", kv)).toHaveLength(1);
    expect(recentHands("blackjack", kv).map((h) => h.hand)).toEqual(["room:0:2", "room:0:1"]);
  });
  it("only mistakes (or caught mistakes) become drills", () => {
    const kv = mem();
    recordDecision(dec({ verdict: "best", sig: "a" }), kv);
    recordDecision(dec({ verdict: "close", sig: "b" }), kv);
    recordDecision(dec({ verdict: "mistake", sig: "c" }), kv);
    recordDecision(dec({ verdict: "best", sig: "d", caught: { key: "stand", label: "Stand" } }), kv);
    expect(loadDrills("blackjack", kv).map((d) => d.sig)).toEqual(["c", "d"]);
  });
  it("caps the log", () => {
    const kv = mem();
    for (let i = 0; i < LOG_MAX + 20; i++) recordDecision(dec({ verdict: "best", sig: `s${i}` }), kv);
    expect(loadLog("blackjack", kv)).toHaveLength(LOG_MAX);
  });
  it("survives broken storage", () => {
    const kv = mem(); kv.m.set("coach_log_blackjack", "{not json");
    expect(loadLog("blackjack", kv)).toEqual([]);
    expect(() => recordDecision(dec(), { getItem: () => null, setItem: () => { throw new Error("full"); } })).not.toThrow();
  });
});

describe("drill scheduling", () => {
  it("dedupes the same kind of spot and brings it back at once", () => {
    let items = addDrill([], dec({ sig: "x" }), 0);
    items = answerDrill(items[0], true, 10) && [answerDrill(items[0], true, 10)];
    items = addDrill(items, dec({ sig: "x" }), 20);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ due: 20, streak: 0, lapses: 1, retired: false });
  });
  it(`retires a spot after ${RETIRE_AFTER} right answers in a row`, () => {
    let d = addDrill([], dec(), 0)[0];
    d = answerDrill(d, true, 100); expect(d).toMatchObject({ streak: 1, retired: false, due: 100 + AGAIN_AFTER_MS });
    d = answerDrill(d, true, 200); expect(d.retired).toBe(true);
  });
  it("a miss resets the streak and makes it due now", () => {
    let d = addDrill([], dec(), 0)[0];
    d = answerDrill(d, true, 100); d = answerDrill(d, false, 500);
    expect(d).toMatchObject({ streak: 0, lapses: 1, due: 500, retired: false });
    expect(dueDrills([d], 500)).toHaveLength(1);
  });
  it("right answers wait before they're due again; retired ones never are", () => {
    const d = answerDrill(addDrill([], dec(), 0)[0], true, 0);
    expect(dueDrills([d], AGAIN_AFTER_MS - 1)).toHaveLength(0);
    expect(dueDrills([d], AGAIN_AFTER_MS)).toHaveLength(1);
    expect(dueDrills([{ ...d, retired: true }], 1e15)).toHaveLength(0);
  });
  it("session order: most overdue first, then most missed; 'practise anyway' adds not-yet-due spots", () => {
    const a = { ...addDrill([], dec({ sig: "a" }), 0)[0], id: "a", due: 50 };
    const b = { ...a, id: "b", sig: "b", due: 10 };
    const c = { ...a, id: "c", sig: "c", due: 10, lapses: 3 };
    const later = { ...a, id: "z", sig: "z", due: 1e12 };
    expect(sessionQueue([a, b, c, later], 100)).toEqual(["c", "b", "a"]);
    expect(sessionQueue([a, b, c, later], 100, 10, true)).toEqual(["c", "b", "a", "z"]);
    expect(sessionQueue([a, b, c], 100, 2)).toHaveLength(2);
  });
  it("a missed spot comes back after two other questions", () => {
    expect(requeue(["x", "a", "b", "c"], "x")).toEqual(["a", "b", "x", "c"]);
    expect(requeue(["x"], "x")).toEqual(["x"]);
  });
  it("keeps at most 80 spots, dropping retired ones first", () => {
    let items = addDrill([], dec({ sig: "r" }), 0); items[0] = { ...items[0], retired: true };
    for (let i = 0; i < 85; i++) items = addDrill(items, dec({ sig: `s${i}` }), i);
    expect(items).toHaveLength(80);
    expect(items.some((x) => x.sig === "r")).toBe(false);
  });
});

describe("hand grade", () => {
  it("perfect", () => expect(gradeHand([dec({ verdict: "best" }), dec({ verdict: "best" })])).toMatchObject({ letter: "A", mistakes: 0 }));
  it("one mistake out of four", () => expect(gradeHand([dec({ verdict: "best" }), dec({ verdict: "best" }), dec({ verdict: "close" }), dec()])).toMatchObject({ letter: "C", mistakes: 1, headline: "One move to work on" }));
  it("all wrong", () => expect(gradeHand([dec(), dec()]).letter).toBe("D"));
});

describe("blackjack decisions", () => {
  const rows = (o: Partial<Record<Row["action"], number>>): Row[] => Object.entries(o).map(([action, ev]) => ({ action: action as Row["action"], n: 1000, win: 0.4, push: 0.1, lose: 0.5, ev: ev!, se: 0.005, dealerBust: 0.23, bustNext: 0.6, strong: 0.3 })).sort((a, b) => b.ev - a.ev);
  const input = { cards: ["TH", "6C"], dealerUp: "TS", seen: [], legal: ["hit", "stand", "double"] as ("hit" | "stand" | "double")[] };
  it("builds a plain-language mistake with a drill spot that only shows your own cards", () => {
    const d = bjDecision({ input, rows: rows({ hit: -0.53, stand: -0.58, double: -1.06 }), chosen: "double", hand: "r:0:1", handLabel: "Round 1", step: "First move" });
    expect(d.verdict).toBe("mistake"); expect(d.best.key).toBe("hit");
    expect(d.situation).toMatch(/You had 16/);
    expect(d.sig).toBe(bjSig(input, ["hit", "stand", "double"]));
    expect(d.spot.groups.flatMap((g) => g.cards)).toEqual(["TS", "TH", "6C"]);
    expect(d.cost).toMatch(/per \$1/);
  });
  it("variants keep the total and dealer card but change the cards", () => {
    const d = bjDecision({ input, rows: rows({ hit: -0.53, stand: -0.58 }), chosen: "stand", hand: "r:0:1", handLabel: "Round 1", step: "First move" });
    const v = bjVariant(d.spot, seededRng(7)); const st = v.state as { cards: string[]; up: string };
    expect(st.up).toBe("TS");
    const val = (c: string) => ("TJQK".includes(c[0]) ? 10 : Number(c[0]));
    expect(val(st.cards[0]) + val(st.cards[1])).toBe(16);
  });
});
