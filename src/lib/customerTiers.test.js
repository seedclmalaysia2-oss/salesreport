import { describe, it, expect } from "vitest";
import { TIERS, tierIndex, buildTierRanking } from "./customerTiers.js";

const row = (sp, year, customer, total, month = 0) => {
  const months = new Array(12).fill(0);
  months[month] = total;
  return { sp, year, customer, months, total };
};

describe("tierIndex", () => {
  it("puts a customer in the highest band their revenue reaches", () => {
    const label = (v) => TIERS[tierIndex(v)].label;
    expect(label(250000)).toBe("RM 100K and above");
    expect(label(100000)).toBe("RM 100K and above");
    expect(label(99999.99)).toBe("RM 80K – 100K");
    expect(label(80000)).toBe("RM 80K – 100K");
    expect(label(60000)).toBe("RM 60K – 80K");
    expect(label(50000)).toBe("RM 50K – 60K");
    expect(label(40000)).toBe("RM 40K – 50K");
    expect(label(30000)).toBe("RM 30K – 40K");
    expect(label(20000)).toBe("RM 20K – 30K");
    expect(label(10000)).toBe("RM 10K – 20K");
    expect(label(6000)).toBe("RM 6K – 10K");
    expect(label(3000)).toBe("RM 3K – 6K");
    expect(label(2999)).toBe("Under RM 3K");
    expect(label(1)).toBe("Under RM 3K");
  });
});

describe("buildTierRanking", () => {
  const rows = [
    row("Alan", 2026, "BIG OPTICS", 90000),
    row("Dino", 2026, "BIG OPTICS", 30000),        // 120K across two reps
    row("Alan", 2026, "MID OPTICS", 55000),
    row("Alan", 2026, "SMALL OPTICS", 1500),
    row("Alan", 2026, "CREDIT ONLY", -200),
    row("Alan", 2025, "MID OPTICS", 40000),
    row("Alan", 2025, "OTHER YEAR", 999999),
  ];

  it("ranks customers by yearly revenue, summing reps under All Teams", () => {
    const r = buildTierRanking(rows, 2026, "All");
    expect(r.customers.map((c) => [c.rank, c.customer, c.total])).toEqual([
      [1, "BIG OPTICS", 120000],
      [2, "MID OPTICS", 55000],
      [3, "SMALL OPTICS", 1500],
    ]);
    expect(r.total).toBe(176500);
    expect(r.unranked).toBe(1); // the credit-only customer
    expect(r.customers[0].sps.sort()).toEqual(["Alan", "Dino"]);
  });

  it("counts every ringgit once: tier revenue and shares add up", () => {
    const r = buildTierRanking(rows, 2026, "All");
    expect(r.tiers.reduce((a, t) => a + t.revenue, 0)).toBe(r.total);
    expect(r.tiers.reduce((a, t) => a + t.count, 0)).toBe(3);
    expect(r.tiers.reduce((a, t) => a + t.share, 0)).toBeCloseTo(1, 10);
    expect(r.tiers[r.tiers.length - 1].cumulative).toBeCloseTo(1, 10);
    expect(r.tiers[0]).toMatchObject({ label: "RM 100K and above", count: 1, revenue: 120000 });
    expect(r.tiers.find((t) => t.label === "RM 50K – 60K")).toMatchObject({ count: 1, revenue: 55000 });
  });

  it("narrows to one salesperson and uses only that rep's revenue", () => {
    const r = buildTierRanking(rows, 2026, "Dino");
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0]).toMatchObject({ customer: "BIG OPTICS", total: 30000 });
    expect(r.tiers.find((t) => t.count > 0).label).toBe("RM 30K – 40K");
  });

  it("carries last year's revenue for the year-on-year comparison", () => {
    const r = buildTierRanking(rows, 2026, "Alan");
    expect(r.customers.find((c) => c.customer === "MID OPTICS").prev).toBe(40000);
    expect(r.customers.find((c) => c.customer === "SMALL OPTICS").prev).toBeNull();
  });

  it("returns an empty ranking for a year with no sales", () => {
    const r = buildTierRanking(rows, 2030, "All");
    expect(r.customers).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.tiers.every((t) => t.count === 0 && t.share === 0)).toBe(true);
  });
});
