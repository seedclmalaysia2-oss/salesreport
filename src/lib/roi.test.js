import { describe, it, expect } from "vitest";
import { buildStoreRoi, buildCostIndex, costPerBox, monthsWithSales, verdictFor, sortByPriority, LENS_LINES, ROI_CONFIG } from "./roi.js";

const row = (customer, group, amount, qty, extra = {}) => ({ year: 2026, customer, sp: "Alan", group, amount, qty, ...extra });
const months = (n, v = 100) => Array.from({ length: 12 }, (_, i) => (i < n ? v : 0));
const line1dp = LENS_LINES.find(l => l.key === "1dp");

describe("trial usage", () => {
  it("converts trial pieces to boxes by each product's pack size", () => {
    const { stores } = buildStoreRoi({
      year: 2026,
      groupRows: [
        row("A", "1DPR", 14000, 100),
        row("A", "1DTR", 0, 320),   // 320 / 32 = 10 boxes
        row("A", "EC10-M", 3000, 100),
        row("A", "ECTR", 0, 100),   // 100 / 10 = 10 boxes
      ],
    });
    expect(stores[0].boxes).toBe(200);
    expect(stores[0].trialBoxes).toBe(20);
    expect(stores[0].trialPieces).toBe(420);
    expect(stores[0].usage).toBeCloseTo(0.1);
  });

  it("counts toric trial codes that the PRM/TR suffix rule would miss", () => {
    const { stores, unknownCodes } = buildStoreRoi({
      year: 2026,
      groupRows: [row("A", "MTPR", 1000, 10), row("A", "MTPRT", 0, 6), row("A", "EC-MT", 0, 10), row("A", "MCUVT", 0, 2)],
    });
    expect(stores[0].trialBoxes).toBeCloseTo(1 + 1 + 1);
    expect(unknownCodes).toEqual([]);
  });

  it("keeps PRM free boxes and non-lens goods out of usage, but non-lens stays in sales", () => {
    const { stores } = buildStoreRoi({
      year: 2026,
      groupRows: [row("A", "1DPR", 1400, 10), row("A", "1DPRPRM", 0, 5), row("A", "SDRGPSL", 500, 50)],
    });
    expect(stores[0].boxes).toBe(10);
    expect(stores[0].freeBoxes).toBe(5);
    expect(stores[0].trialBoxes).toBe(0);
    expect(stores[0].sales).toBe(1900);
    expect(stores[0].lensSales).toBe(1400);
  });

  it("surfaces an unmapped code instead of silently dropping it", () => {
    const { unknownCodes, stores } = buildStoreRoi({ year: 2026, groupRows: [row("A", "NEWCODE", 100, 3)] });
    expect(unknownCodes[0]).toMatchObject({ code: "NEWCODE", qty: 3 });
    expect(stores[0].sales).toBe(100);
  });

  it("merges name variants and only reads the chosen year and salesperson", () => {
    const { stores } = buildStoreRoi({
      year: 2026, sp: "Alan",
      groupRows: [
        row("Eye  Care ", "1DPR", 100, 1),
        row("EYE CARE", "1DPR", 100, 1),
        row("EYE CARE", "1DPR", 100, 1, { sp: "Dino" }),
        row("EYE CARE", "1DPR", 100, 1, { year: 2025 }),
      ],
    });
    expect(stores).toHaveLength(1);
    expect(stores[0].boxes).toBe(2);
  });
});

describe("returns", () => {
  it("handles a store whose returns outweigh its boxes sold", () => {
    const { stores } = buildStoreRoi({ year: 2026, groupRows: [row("A", "MCUV", -500, -100), row("A", "1DPR", 100, 10), row("A", "1DTR", 0, 320)] });
    expect(stores[0].usage).toBe(Infinity);
    expect(stores[0].overBoxes).toBe(10);
    expect(stores[0].verdict).toBe("review");
    expect(stores[0].advice).toContain("returns");
    expect(stores[0].advice).not.toContain("Infinity");
  });
});

describe("cost and ROI", () => {
  const costRows = [
    { year: 2026, product: "1 DAY PURE", cost: 2000, cost_qty: 100 }, // RM 20 per box
    { year: 2024, product: "EYE COFFRET-M", cost: 1500, cost_qty: 100 },
  ];

  it("averages cost per box and falls back to the most recent year", () => {
    const idx = buildCostIndex(costRows);
    expect(costPerBox(idx, 2026, line1dp)).toBe(20);
    expect(costPerBox(idx, 2026, LENS_LINES.find(l => l.key === "ec"))).toBe(15);
    expect(costPerBox(idx, 2026, LENS_LINES.find(l => l.key === "js"))).toBeNull();
  });

  it("works out trial cost, gross profit, ROI and over-allowance cost", () => {
    const { stores, totals, costAvailable } = buildStoreRoi({
      year: 2026, costRows,
      groupRows: [row("A", "1DPR", 14000, 100), row("A", "1DTR", 0, 320)],
    });
    const s = stores[0];
    expect(costAvailable).toBe(true);
    expect(s.trialCost).toBe(200);                // 10 boxes x RM 20
    expect(s.grossProfit).toBe(12000);            // 14000 - 100 x RM 20
    expect(s.roi).toBe(60);
    expect(s.overBoxes).toBe(0);                  // 10 given, 30 allowed
    expect(s.overCost).toBe(0);
    expect(totals.roi).toBe(60);
  });

  it("shows no cost figures at all when cost is missing, rather than a guess", () => {
    const { stores, totals, costAvailable } = buildStoreRoi({
      year: 2026,
      groupRows: [row("A", "1DPR", 14000, 100), row("A", "1DTR", 0, 1600)],
    });
    expect(costAvailable).toBe(false);
    expect(stores[0].trialCost).toBeNull();
    expect(stores[0].roi).toBeNull();
    expect(stores[0].overCost).toBeNull();
    expect(stores[0].usage).toBeCloseTo(0.5);
    expect(totals.roi).toBeNull();
    expect(stores[0].advice).toContain("boxes over");
    expect(stores[0].advice).not.toContain("RM");
  });

  it("flags a store when one of its lines has no known cost", () => {
    const { stores } = buildStoreRoi({
      year: 2026, costRows,
      groupRows: [row("A", "1DPR", 1400, 100), row("A", "1DTR", 0, 32), row("A", "JS10", 500, 10)],
    });
    expect(stores[0].costPartial).toBe(true);
    expect(stores[0].trialCost).toBe(20);
  });
});

describe("trend", () => {
  it("compares the same months only, so a part-year is fair", () => {
    const customers = [
      { year: 2026, customer: "A", sp: "Alan", months: months(8, 110) },
      { year: 2025, customer: "A", sp: "Alan", months: months(12, 100) },
    ];
    expect(monthsWithSales(customers, 2026)).toBe(8);
    const { stores, months: n } = buildStoreRoi({ year: 2026, customers, groupRows: [row("a", "1DPR", 100, 1)] });
    expect(n).toBe(8);
    expect(stores[0].growth).toBeCloseTo(0.1);
  });

  it("has no trend for a store with no sales last year", () => {
    const customers = [{ year: 2026, customer: "A", sp: "Alan", months: months(3) }];
    const { stores } = buildStoreRoi({ year: 2026, customers, groupRows: [row("A", "1DPR", 100, 1)] });
    expect(stores[0].growth).toBeNull();
  });
});

describe("verdicts", () => {
  const base = { boxes: 100, trialBoxes: 20, usage: 0.2, sales: 5000, growth: 0, roi: null };
  const v = (o) => verdictFor({ ...base, ...o });

  it("reviews usage far above the allowance, even when growing", () => {
    expect(v({ usage: 0.46, growth: 0.5 })).toBe("review");
  });
  it("reviews over-allowance stores that are flat or falling", () => {
    expect(v({ usage: 0.35, growth: 0 })).toBe("review");
    expect(v({ usage: 0.35, growth: -0.2 })).toBe("review");
  });
  it("coaches over-allowance stores that are growing, or new", () => {
    expect(v({ usage: 0.35, growth: 0.1 })).toBe("coach");
    expect(v({ usage: 0.35, growth: null })).toBe("coach");
  });
  it("treats exactly the allowance as within it", () => {
    expect(v({ usage: ROI_CONFIG.allowance, growth: 0 })).toBe("keep");
  });
  it("grows stores within allowance that are growing or strong on return", () => {
    expect(v({ growth: 0.1 })).toBe("grow");
    expect(v({ growth: 0, roi: ROI_CONFIG.highRoi })).toBe("grow");
    expect(v({ growth: -0.2, roi: ROI_CONFIG.highRoi })).toBe("keep");
  });
  it("flags big stores with almost no trial use as untapped", () => {
    expect(v({ sales: 50000, usage: 0.02, growth: 0.3 })).toBe("untapped");
  });
  it("won't judge tiny stores, unless trials went in anyway", () => {
    expect(v({ boxes: 5, usage: 0, trialBoxes: 0 })).toBe("small");
    expect(v({ boxes: 5, usage: 1, trialBoxes: 5 })).toBe("review");
    expect(v({ boxes: 0, usage: Infinity, trialBoxes: 3 })).toBe("review");
  });
  it("sorts action first, biggest overrun first", () => {
    const sorted = sortByPriority([
      { customer: "keep", verdict: "keep", overBoxes: 0, sales: 9 },
      { customer: "small", verdict: "review", overBoxes: 1, sales: 1 },
      { customer: "big", verdict: "review", overBoxes: 9, sales: 1 },
    ]);
    expect(sorted.map(s => s.customer)).toEqual(["big", "small", "keep"]);
  });
});
