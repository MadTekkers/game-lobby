import { describe, expect, it } from "vitest";
import { seededRng } from "./cards/core";
import { tuneLevel, MIN_N } from "./cards/tune";
import { spadesTuner } from "./cards/spades/tune";

const row = (variant: string, points: number, bags: number, extra: Record<string, unknown> = {}) => ({ level: "medium", variant, metrics: { points, bags, bid: 3, tricks: 3, nil: 0, ...extra } });
describe("nightly tuner", () => {
  it("adopts a candidate that clearly beats the live params", () => {
    const rows = [...Array.from({ length: MIN_N + 10 }, (_, k) => row("A", 30 + (k % 5), 1)), ...Array.from({ length: MIN_N + 10 }, (_, k) => row("B", 60 + (k % 5), 1))];
    const out = tuneLevel(spadesTuner, "medium", { params: {}, candidate: { bagCost: 5 }, generation: 2 }, rows, seededRng(1));
    expect(out.review.verdict).toMatch(/adopted/); expect(out.after.params.bagCost).toBe(5); expect(out.after.generation).toBe(3);
    expect(out.after.candidate).not.toBeNull(); // a fresh candidate is generated
  });
  it("drops a clearly worse candidate and keeps A", () => {
    const rows = [...Array.from({ length: 40 }, (_, k) => row("A", 60 + (k % 5), 1)), ...Array.from({ length: 40 }, (_, k) => row("B", 20 + (k % 5), 1))];
    const out = tuneLevel(spadesTuner, "medium", { params: {}, candidate: { bagCost: 9 }, generation: 0 }, rows, seededRng(2));
    expect(out.review.verdict).toMatch(/dropped/); expect(out.after.params.bagCost).toBe(3);
  });
  it("review shifts the bid offset when bots systematically overtrick, and nil when nils fail", () => {
    const rows = [...Array.from({ length: 50 }, () => row("A", 50, 2, { bid: 3, tricks: 4 })), ...Array.from({ length: 10 }, () => row("A", -100, 0, { bid: 0, tricks: 1, nil: 1, nilOk: false }))];
    const out = tuneLevel(spadesTuner, "medium", null, rows, seededRng(3));
    expect(out.after.params.bidOffset).toBeGreaterThan(0); expect(out.after.params.nilMax).toBeLessThan(0.7);
    expect((out.review.adjust as string[]).length).toBe(2);
  });
  it("never tunes easy bots and keeps params inside bounds", () => {
    const out = tuneLevel(spadesTuner, "easy", { params: { err: 5 }, candidate: null, generation: 0 }, [], seededRng(4));
    expect(out.after.params.err).toBe(0.6); expect(out.after.candidate).toBeNull();
  });
});
