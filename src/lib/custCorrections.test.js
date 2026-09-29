import { describe, it, expect } from "vitest";
import { applyCustCorrections } from "./custCorrections.js";

describe("applyCustCorrections", () => {
  it("deducts June 2026 Khen's missing CN01885 portion without touching other reps/years", () => {
    const months = new Array(12).fill(0); months[5] = 82926.81;
    const input = [
      { sp: "Khen", year: 2026, months, total: 82926.81 },
      { sp: "Alan", year: 2026, months: [...months], total: 82926.81 },
      { sp: "Khen", year: 2025, months: [...months], total: 82926.81 },
    ];
    const out = applyCustCorrections(input);
    expect(out[0].months[5]).toBe(77373.85);
    expect(out[0].total).toBe(77373.85);
    expect(out[1]).toBe(input[1]);
    expect(out[2]).toBe(input[2]);
    expect(input[0].months[5]).toBe(82926.81); // input not mutated
  });
});
