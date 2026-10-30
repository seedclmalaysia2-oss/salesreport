import { describe, it, expect } from "vitest";
import { monthToDateSummary, buildWeeklyShareText } from "./weeklySummary.js";

const weeklySales = [
  { periodStart: "2026-09-29", periodEnd: "2026-09-30", sp: "Alan", amount: 999 },
  { periodStart: "2026-10-01", periodEnd: "2026-10-07", sp: "Alan", amount: 100 },
  { periodStart: "2026-10-08", periodEnd: "2026-10-14", sp: "Alan", amount: 50 },
  { periodStart: "2026-10-01", periodEnd: "2026-10-07", sp: "Simon", amount: 200 },
  { periodStart: "2026-10-29", periodEnd: "2026-10-31", sp: "Dino", amount: 30 },
];
const targets = [{ year: 2026, month: 10, sp: "_TEAM", target: 1000 }];

describe("monthToDateSummary", () => {
  it("sums the latest month per rep and splits retail vs whole team", () => {
    const s = monthToDateSummary({ weeklySales, targets, todayIso: "2026-10-30" });
    expect(s.monthKey).toBe("2026-10");
    expect(s.periodLabel).toBe("1 Oct – 30 Oct"); // capped at today
    expect(s.target).toBe(1000);
    expect(s.scopes[0].rows).toEqual([{ sp: "Alan", amount: 150 }, { sp: "Dino", amount: 30 }]);
    expect(s.scopes[1].total).toBe(380);
  });

  it("ignores a customer file that hasn't caught up", () => {
    const custSummary = [{ sp: "Alan", year: 2026, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0] }];
    const s = monthToDateSummary({ weeklySales, targets, custSummary, todayIso: "2026-10-30" });
    expect(s.scopes[1].total).toBe(380);
  });

  it("reconciles to a caught-up customer file", () => {
    const m = (v) => [0, 0, 0, 0, 0, 0, 0, 0, 0, v, 0, 0];
    const custSummary = [
      { sp: "Alan", year: 2026, months: m(160) },
      { sp: "Simon", year: 2026, months: m(200) },
      { sp: "Dino", year: 2026, months: m(30) },
    ];
    const s = monthToDateSummary({ weeklySales, targets, custSummary, todayIso: "2026-10-30" });
    expect(s.scopes[0].rows[0]).toEqual({ sp: "Alan", amount: 160 });
    expect(s.scopes[1].total).toBe(390);
  });

  it("builds the share text", () => {
    const text = buildWeeklyShareText(monthToDateSummary({ weeklySales, targets, todayIso: "2026-10-30" }));
    expect(text).toContain("📊 SEED Weekly Sales — October 2026");
    expect(text).toContain("month to date");
    expect(text).toMatch(/Total: RM 380 \(38% of RM 1,000\)/);
  });
});
