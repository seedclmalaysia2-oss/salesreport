import { describe, it, expect } from "vitest";
import { ALL_EX_HOUSE, spInScope, scopeName, targetFor, isTeamScope } from "./teamScope.js";

describe("teamScope", () => {
  it("matches reps per scope", () => {
    expect(spInScope("Alan", "All")).toBe(true);
    expect(spInScope("Seed Malaysia", "All")).toBe(true);
    expect(spInScope("Alan", ALL_EX_HOUSE)).toBe(true);
    expect(spInScope("Seed Malaysia", ALL_EX_HOUSE)).toBe(false);
    expect(spInScope("Dino", "Alan")).toBe(false);
    expect(isTeamScope(ALL_EX_HOUSE)).toBe(true);
    expect(isTeamScope("Alan")).toBe(false);
    expect(scopeName(ALL_EX_HOUSE)).toBe("All Teams except Seed Malaysia");
  });

  it("targets: _TEAM for All, per-rep sum minus the house account otherwise", () => {
    const T = [
      { year: 2026, month: 1, sp: "_TEAM", target: 500 },
      { year: 2026, month: 1, sp: "Alan", target: 200 },
      { year: 2026, month: 1, sp: "Dino", target: 100 },
      { year: 2026, month: 1, sp: "Seed Malaysia", target: 50 },
      { year: 2026, month: 2, sp: "Alan", target: 999 },
    ];
    expect(targetFor(T, "All", 2026, 1)).toBe(500);
    expect(targetFor(T, ALL_EX_HOUSE, 2026, 1)).toBe(300);
    expect(targetFor(T, "Dino", 2026, 1)).toBe(100);
    expect(targetFor(T, "Dino", 2026, 2)).toBe(0);
  });
});
