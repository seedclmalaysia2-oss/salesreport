import { describe, it, expect } from "vitest";
import {
  monthsFor, reportedMonths, analyse, rollupByChain, baseAmount, suggestGrowth, targetFromGrowth,
  growthFromTarget, prospectBenchmark, suggestTiers, tierCosts, tierWarnings, splitQuarters, quarterShares, niceRound,
} from "./contractPlan.js";

const row = (customer, year, months, sp = "Alan") => ({ sp, customer, year, months, total: months.reduce((a, b) => a + b, 0) });
const flat = (v, n = 12) => Array.from({ length: 12 }, (_, i) => (i < n ? v : 0));

// 2025 is a full year, 2026 has four months reported.
const rows = [
  row("A OPTICS", 2025, flat(1000)),
  row("A OPTICS", 2026, flat(1200, 4)),
  row("A OPTICS", 2026, flat(100, 4), "Dino"), // same customer under a second salesperson
  row("B OPTICS", 2025, flat(500)),
  row("B OPTICS", 2026, flat(400, 4)),
  row("DR SPECS - PBJ", 2025, flat(2000)),
  row("DR SPECS - PBJ", 2026, flat(2500, 4)),
  row("JAC'S OPTOMETRY-ASM", 2025, flat(1500)),
  row("JAC'S OPTOMETRY-ASM", 2026, flat(1500, 4)),
];

describe("monthsFor / reportedMonths", () => {
  it("adds a customer's rows across salespeople", () => {
    expect(monthsFor(rows, ["A OPTICS"], 2026).slice(0, 5)).toEqual([1300, 1300, 1300, 1300, 0]);
  });
  it("reports months from the data, not the calendar", () => {
    expect(reportedMonths(rows, 2026)).toBe(4);
    expect(reportedMonths(rows, 2025)).toBe(12);
    expect(reportedMonths(rows, 2030)).toBe(0);
  });
});

describe("analyse", () => {
  it("projects from the customer's own seasonality when last year has enough months", () => {
    const a = analyse(rows, ["A OPTICS"], 2026);
    expect(a.monthsReported).toBe(4);
    expect(a.ytd).toBe(5200);
    expect(a.lastYear).toBe(12000);
    expect(a.ytdPrior).toBe(4000);
    expect(a.method).toBe("own");
    expect(a.projected).toBeCloseTo(15600, 5); // 5200 / (4000 / 12000)
    expect(a.yoyYtd).toBeCloseTo(0.3, 10);
  });

  it("falls back to the company's seasonality, then a straight line", () => {
    const sparse = [...rows, row("NEW CO", 2026, flat(300, 4))];
    const a = analyse(sparse, ["NEW CO"], 2026);
    expect(a.method).toBe("company");
    expect(a.projected).toBeCloseTo(1200 / (sum4(rows) / sum12(rows)), 5);
    const lone = analyse([row("X", 2026, flat(100, 4))], ["X"], 2026);
    expect(lone.method).toBe("linear");
    expect(lone.projected).toBe(1200); // 400 over 4 months, straight-lined to 12
  });

  it("uses actuals once the year is complete and never projects below the year to date", () => {
    const a = analyse(rows, ["A OPTICS"], 2025);
    expect(a.method).toBe("actual");
    expect(a.projected).toBe(12000);
  });

  it("rolls branches up under one total and keeps each branch", () => {
    const names = ["DR SPECS - PBJ", "JAC'S OPTOMETRY-ASM"];
    const a = analyse(rows, names, 2026);
    expect(a.ytd).toBe(16000);
    expect(a.branches.map((b) => b.name)).toEqual(["DR SPECS - PBJ", "JAC'S OPTOMETRY-ASM"]);
    const chains = rollupByChain(a.branches);
    expect(chains.map((c) => [c.chain.key, c.branches, c.ytd])).toEqual([["drspecs", 1, 10000], ["jac", 1, 6000]]);
  });

  it("copes with a customer that has no rows", () => {
    const a = analyse(rows, ["NOBODY"], 2026);
    expect(a.ytd).toBe(0);
    expect(a.projected).toBe(0);
    expect(a.hasHistory).toBe(false);
    expect(baseAmount(a)).toBe(0);
    expect(suggestGrowth(a)).toBeNull();
  });
});

describe("suggestGrowth", () => {
  const a = (projected, lastYear, extra = {}) => ({ baseYear: 2026, monthsReported: 6, projected, lastYear, ...extra });

  it("steps growth by how the year is running against last year, in 5% steps", () => {
    expect(suggestGrowth(a(80, 100)).growth).toBe(0); // -20%
    expect(suggestGrowth(a(101, 100)).growth).toBe(0.05); // +1%
    expect(suggestGrowth(a(108, 100)).growth).toBe(0.1);
    expect(suggestGrowth(a(150, 100)).growth).toBe(0.15); // capped
  });

  it("explains itself in one line with the actual trend in it", () => {
    const s = suggestGrowth(a(108000, 100000));
    expect(s.reason).toContain("+8%");
    expect(s.reason).toContain("RM 108K");
    expect(s.reason.split("\n")).toHaveLength(1);
  });

  it("handles new, dormant and very early accounts", () => {
    expect(suggestGrowth(a(5000, 0)).reason).toMatch(/New this year/);
    const dormant = suggestGrowth(a(0, 9000));
    expect(dormant.growth).toBe(0);
    expect(dormant.reason).toMatch(/No sales reported/);
    expect(suggestGrowth(a(1000, 900, { monthsReported: 2 })).reason).toMatch(/Only 2 months in/);
  });
});

describe("target and growth convert both ways", () => {
  it("rounds sensibly for the account size", () => {
    expect(targetFromGrowth(15600, 0.1)).toBe(17160); // nearest 10 below 20K
    expect(targetFromGrowth(118000, 0.1)).toBe(129800);
    expect(niceRound(1234567)).toBe(1235000);
    expect(growthFromTarget(100000, 110000)).toBeCloseTo(0.1, 10);
    expect(growthFromTarget(0, 110000)).toBeNull();
  });
});

describe("prospectBenchmark", () => {
  const history = [
    row("OLD ONE", 2022, flat(900)), // already a customer when the data starts
    row("S1", 2023, flat(100)), row("S1", 2024, flat(500)), // 6,000 in year two
    row("S2", 2023, flat(50)), row("S2", 2024, flat(900)), // 10,800
    row("S3", 2023, flat(300)), row("S3", 2024, flat(10)), // 120: did not settle
    row("S4", 2024, flat(200)), row("S4", 2025, flat(400)), // 4,800
    row("S5", 2024, flat(100)), row("S5", 2025, flat(1000)), // 12,000
    row("DR SPECS - NEW", 2024, flat(9999)), row("DR SPECS - NEW", 2025, flat(9999)), // chains are not prospects
    row("STARTED LAST YEAR", 2025, flat(900)), // second year not complete, ignored
  ];

  it("takes the median second-year spend of new accounts that settled", () => {
    const b = prospectBenchmark(history, 2026);
    expect(b.n).toBe(4);
    expect(b.median).toBe(8400); // (6,000 + 10,800) / 2
    expect(b.low).toBe(5700);
    expect(b.high).toBe(11100);
    expect(b.reason).toContain("4 new ECPs");
    expect(b.reason).toContain("kept buying");
  });

  it("returns null when there is not enough history to be fair", () => {
    expect(prospectBenchmark(rows, 2026)).toBeNull();
    expect(prospectBenchmark([], 2026)).toBeNull();
  });
});

describe("rebate ladder", () => {
  it("scales the starting ladder to the account", () => {
    expect(suggestTiers(150000).tiers.map((t) => t.pct)).toEqual([1, 2, 3, 4]);
    expect(suggestTiers(60000).tiers.map((t) => t.pct)).toEqual([1, 1.5, 2.5, 3]);
    expect(suggestTiers(10000).tiers.map((t) => t.pct)).toEqual([0.5, 1, 1.5, 2]);
    expect(suggestTiers(150000).reason).toMatch(/commercial call/);
  });

  it("prices every tier at the sales it is reached on", () => {
    const c = tierCosts(100000, [{ at: 1, pct: 2 }, { at: 1.25, pct: 4 }]);
    expect(c.map((x) => [x.sales, x.cost])).toEqual([[100000, 2000], [125000, 5000]]);
  });

  it("warns about ladders that do not rise", () => {
    expect(tierWarnings([{ at: 1, pct: 2 }, { at: 1.1, pct: 3 }])).toEqual([]);
    expect(tierWarnings([{ at: 1, pct: 2 }, { at: 0.9, pct: 3 }])[0]).toMatch(/rise in achievement/);
    expect(tierWarnings([{ at: 1, pct: 3 }, { at: 1.1, pct: 2 }])[0]).toMatch(/pays less/);
  });
});

describe("quarters", () => {
  it("splits the target by the customer's own season and always adds back up", () => {
    const { shares, method } = quarterShares(rows, ["A OPTICS"], 2025);
    expect(method).toBe("own");
    expect(shares).toEqual([0.25, 0.25, 0.25, 0.25]);
    const q = splitQuarters(100001, [0.333, 0.333, 0.2, 0.134]);
    expect(q.reduce((a, b) => a + b, 0)).toBeCloseTo(100001, 6);
  });

  it("falls back to equal quarters when there is no history at all", () => {
    expect(quarterShares([], ["X"], 2025)).toEqual({ shares: [0.25, 0.25, 0.25, 0.25], method: "equal" });
  });
});

function sum12(rs) { return rs.filter((r) => r.year === 2025).reduce((s, r) => s + r.total, 0); }
function sum4(rs) { return rs.filter((r) => r.year === 2025).reduce((s, r) => s + r.months.slice(0, 4).reduce((a, b) => a + b, 0), 0); }

describe("quarter season guard", () => {
  it("ignores a customer's own year when it did not sell in every quarter", () => {
    const lateStart = [row("LATE", 2025, [0, 0, 0, 500, 500, 500, 500, 500, 500, 500, 500, 500]), row("ALL", 2025, flat(100))];
    const r = quarterShares(lateStart, ["LATE"], 2025);
    expect(r.method).toBe("company");
    expect(r.shares.every((x) => x > 0)).toBe(true);
  });
});
