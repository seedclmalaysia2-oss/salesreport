import { describe, it, expect, vi } from "vitest";
vi.mock("./supabase.js", () => ({ supabase: {} }));
import { withUnassignedCustomers, recomputeFromFiles } from "./files.js";

const m = (nov) => { const a = new Array(12).fill(0); a[10] = nov; return a; };

describe("unrecognised salesman on the customer file", () => {
  const file = {
    id: 1, kind: "customer", sp: null, year: 2026,
    rows: [
      { sp: "Alan", year: 2026, customer: "A", months: m(1000), total: 1000 },
      { sp: "All", year: 2026, customer: "NA Customer", months: m(100), total: 100 },
    ],
  };

  it("keeps the rep-less row under Unassigned", () => {
    const out = withUnassignedCustomers(file);
    expect(out.rows.map((r) => r.sp)).toEqual(["Alan", "Unassigned"]);
    expect(file.rows[1].sp).toBe("All"); // input untouched
  });

  it("leaves a whole-company file (no rep on any row) alone", () => {
    const whole = { ...file, rows: [{ sp: "All", customer: "X", months: m(5), total: 5 }] };
    expect(withUnassignedCustomers(whole)).toBe(whole);
  });

  it("leaves a per-SP file alone", () => {
    const perSp = { ...file, sp: "Dino" };
    expect(withUnassignedCustomers(perSp)).toBe(perSp);
  });

  it("includes the Unassigned sales in the summary", () => {
    const agg = recomputeFromFiles([file]);
    const nov = (agg.summary || []).filter((s) => s.year === 2026)
      .reduce((a, s) => a + (Number(s.months?.[10]) || 0), 0);
    expect(nov).toBe(1100);
    expect((agg.summary || []).some((s) => s.sp === "Unassigned")).toBe(true);
  });
});
