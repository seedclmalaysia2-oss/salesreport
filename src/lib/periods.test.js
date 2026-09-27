// Split-period uploads: each calendar month comes from the newest file that has
// data in it, so period-only files add up and YTD re-exports replace old copies.
import { describe, it, expect } from "vitest";
import { mergeDatedRowsByMonth, mergeMonthlyRowsByMonth } from "./periods.js";
import { parseFilename } from "./parseXlsx.js";

const m12 = (vals) => Array.from({ length: 12 }, (_, i) => vals[i] ?? 0);

describe("the user's date-stamped file names are accepted", () => {
  it.each([
    ["2026 Sales Analysis by customer 31082026.xlsx", "Sales Analysis by customer"],
    ["2026 Sales Analysis by customer 27092026.xlsx", "Sales Analysis by customer"],
    ["Stock Sales Analysis - Detail 31082026.xlsx", "Stock Sales Analysis - Detail"],
    ["Stock Sales Analysis - Detail 27092026.xlsx", "Stock Sales Analysis - Detail"],
  ])("%s", (name, kind) => {
    expect(parseFilename(name)).toMatchObject({ kind, year: 2026 });
  });
  it("undated names still work", () => {
    expect(parseFilename("2026 Sales Analysis by customer.xlsx")).toMatchObject({ year: 2026, sp: "All" });
    expect(parseFilename("Sales Analysis 2026 31082026.xlsx")).toMatchObject({ year: 2026 });
  });
});

describe("mergeDatedRowsByMonth (invoice files)", () => {
  const aug = { uploadedAt: 1, rows: [
    { date: "2026-07-03", invoice: "A", amount: 10 },
    { date: "2026-08-20", invoice: "B", amount: 20 },
  ] };
  it("split periods add up", () => {
    const sep = { uploadedAt: 2, rows: [{ date: "2026-09-02", invoice: "C", amount: 30 }] };
    expect(mergeDatedRowsByMonth([aug, sep]).map((r) => r.invoice).sort()).toEqual(["A", "B", "C"]);
  });
  it("a YTD re-export replaces every older month (no double count, voids drop)", () => {
    const ytd = { uploadedAt: 2, rows: [
      { date: "2026-07-03", invoice: "A", amount: 10 },
      { date: "2026-08-21", invoice: "B2", amount: 25 }, // B voided, B2 issued
      { date: "2026-09-02", invoice: "C", amount: 30 },
    ] };
    expect(mergeDatedRowsByMonth([aug, ytd]).map((r) => r.invoice).sort()).toEqual(["A", "B2", "C"]);
  });
});

describe("mergeMonthlyRowsByMonth (customer files)", () => {
  const aug = { sp: "All", uploadedAt: 1, rows: [
    { sp: "Alan", customer: "X", months: m12([100, 0, 0, 0, 0, 0, 0, 50]) },
  ] };
  it("split periods add up", () => {
    const sep = { sp: "All", uploadedAt: 2, rows: [
      { sp: "Alan", customer: "X", months: m12({ 8: 70 }) },
    ] };
    const [row] = mergeMonthlyRowsByMonth([aug, sep]);
    expect(row.months[0]).toBe(100);
    expect(row.months[7]).toBe(50);
    expect(row.months[8]).toBe(70);
    expect(row.total).toBe(220);
  });
  it("a YTD re-export wins every month it covers", () => {
    const ytd = { sp: "All", uploadedAt: 2, rows: [
      { sp: "Alan", customer: "X", months: m12([90, 0, 0, 0, 0, 0, 0, 50, 70]) },
    ] };
    const [row] = mergeMonthlyRowsByMonth([aug, ytd]);
    expect(row.total).toBe(210);
  });
});
