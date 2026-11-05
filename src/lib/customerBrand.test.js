import { describe, it, expect } from "vitest";
import { buildCustomerBrand, pairKey } from "./customerBrand.js";

const rows = [
  { year: 2026, sp: "Alan", customer: "A OPTICS", brand: "1DPR", amt: 600, qty: 10 },
  { year: 2026, sp: "Alan", customer: "A OPTICS", brand: "ECB", amt: 300, qty: 30 },
  { year: 2026, sp: "Dino", customer: "A OPTICS", brand: "1DPR", amt: 100, qty: 2 },
  { year: 2026, sp: "Dino", customer: "B OPTICS", brand: "ECB", amt: 500, qty: 50 },
  { year: 2026, sp: "Dino", customer: "RETURNS ONLY", brand: "ECB", amt: -40, qty: -4 },
  { year: 2025, sp: "Alan", customer: "OLD", brand: "1DPR", amt: 9999, qty: 99 },
];

describe("buildCustomerBrand", () => {
  it("ranks customers and brands by revenue, summing salespeople under All", () => {
    const r = buildCustomerBrand(rows, 2026, "All", "amt");
    expect(r.customers.map((c) => [c.customer, c.total])).toEqual([["A OPTICS", 1000], ["B OPTICS", 500]]);
    // Brand totals are net of every return, including the returns-only customer's -40.
    expect(r.brands.map((b) => [b.brand, b.total])).toEqual([["ECB", 760], ["1DPR", 700]]);
    expect(r.total).toBe(1500);
    expect(r.customers[0].share).toBeCloseTo(1000 / 1500, 10);
  });

  it("splits each customer's total into brand shares that add to 100%", () => {
    const r = buildCustomerBrand(rows, 2026, "All", "amt");
    const a = r.customers[0];
    expect(a.brands.map((b) => [b.brand, b.value])).toEqual([["1DPR", 700], ["ECB", 300]]);
    expect(a.brands.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 10);
    // Quantity rides along so the revenue view can show units.
    expect(a.brands[0].qty).toBe(12);
  });

  it("leaves out customers and brands that net to zero or less", () => {
    const r = buildCustomerBrand(rows, 2026, "All", "amt");
    expect(r.customers.some((c) => c.customer === "RETURNS ONLY")).toBe(false);
  });

  it("ranks by units when asked, and the shares follow", () => {
    const r = buildCustomerBrand(rows, 2026, "All", "qty");
    expect(r.customers.map((c) => [c.customer, c.total])).toEqual([["B OPTICS", 50], ["A OPTICS", 42]]);
    expect(r.brands[0]).toMatchObject({ brand: "ECB", total: 76 });
  });

  it("narrows to one salesperson and ignores other years", () => {
    const r = buildCustomerBrand(rows, 2026, "Dino", "amt");
    expect(r.customers.map((c) => c.customer)).toEqual(["B OPTICS", "A OPTICS"]);
    expect(r.total).toBe(600);
    expect(buildCustomerBrand(rows, 2026, "Alan", "amt").customers.some((c) => c.customer === "OLD")).toBe(false);
  });

  it("exposes pair lookups for the grid and the colour-worthy top brands", () => {
    const r = buildCustomerBrand(rows, 2026, "All", "amt");
    expect(r.pair.get(pairKey("A OPTICS", "1DPR"))).toMatchObject({ amt: 700, qty: 12 });
    expect(r.topBrands).toEqual(["ECB", "1DPR"]);
  });

  it("returns an empty roll-up for a year with no rows", () => {
    const r = buildCustomerBrand(rows, 2030, "All", "amt");
    expect(r.customers).toEqual([]);
    expect(r.total).toBe(0);
  });
});
