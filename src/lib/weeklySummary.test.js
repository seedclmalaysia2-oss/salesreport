import { describe, it, expect } from "vitest";
import { monthToDateSummary, buildWeeklyShareText, reconcileToSalesAnalysis, UNASSIGNED_SP } from "./weeklySummary.js";

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

describe("reconcileToSalesAnalysis", () => {
  // Live 13 Nov 2026: per-rep Sales Analysis equals the invoice board exactly;
  // the RM 100 gap is XIN MIN OPTICAL, which has no salesman (sp "All").
  const nov = (v) => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, v, 0];
  const reps = { Alan: 85112.85, Dino: 41544, Khen: 37000.28, Sakinah: 8866, "Seed Malaysia": 4948.7, Simon: 8874, Wani: 605 };
  const board = new Map(Object.entries(reps));
  const perRep = Object.entries(reps).map(([sp, v]) => ({ sp, year: 2026, months: nov(v) }));

  it("ties the current month to the full total, unassigned customers included", () => {
    const custSummary = [...perRep, { sp: "All", year: 2026, months: nov(100) }];
    const r = reconcileToSalesAnalysis({ board, custSummary, year: 2026, month: 11, isCurrentMonth: true });
    expect(r.caughtUp).toBe(true);
    expect([...r.adj]).toEqual([[UNASSIGNED_SP, 100]]);
    expect(Math.round((r.boardTotal + 100) * 100) / 100).toBe(187050.83);
  });

  it("falls back to the live board when the current-month file lags", () => {
    const lag = perRep.map((s) => ({ ...s, months: nov(s.months[10] * 0.8) }));
    const r = reconcileToSalesAnalysis({ board, custSummary: lag, year: 2026, month: 11, isCurrentMonth: true });
    expect(r.caughtUp).toBe(false);
    expect(r.adj.size).toBe(0);
  });

  it("ignores a stale company-wide 'All' aggregate that would double-count", () => {
    const custSummary = [...perRep, { sp: "All", year: 2026, months: nov(186950.83) }];
    const r = reconcileToSalesAnalysis({ board, custSummary, year: 2026, month: 11, isCurrentMonth: true });
    expect(r.adj.size).toBe(0);
  });

  it("digest summary includes the unassigned line in the whole-team total", () => {
    const weekly = Object.entries(reps).map(([sp, amount]) => ({ periodStart: "2026-11-01", periodEnd: "2026-11-08", sp, amount }));
    const s = monthToDateSummary({ weeklySales: weekly, custSummary: [...perRep, { sp: "All", year: 2026, months: nov(100) }], todayIso: "2026-11-13" });
    expect(Math.round(s.scopes[1].total * 100) / 100).toBe(187050.83);
    expect(s.scopes[0].total).toBeCloseTo(163657.13, 2);
  });
});
