import { describe, it, expect } from "vitest";
import {
  newDraft, computeCalc, applySuggestions, rebase, setGrowth, setTarget, activeCustomers, defaultBranches, recordFromDraft, draftFromRecord,
} from "./contractDraft.js";

const row = (customer, year, months, sp = "Alan") => ({ sp, customer, year, months, total: months.reduce((a, b) => a + b, 0) });
const flat = (v, n = 12) => Array.from({ length: 12 }, (_, i) => (i < n ? v : 0));

const rows = [
  row("A OPTICS", 2025, flat(1000)),
  row("A OPTICS", 2026, flat(1200, 4)),
  row("DR SPECS - PBJ", 2025, flat(2000)),
  row("DR SPECS - PBJ", 2026, flat(2500, 4)),
  row("DR SPECS - OLD", 2022, flat(900)), // closed years ago
  row("JAC'S OPTOMETRY-ASM", 2025, flat(1500)),
  row("JAC'S OPTOMETRY-ASM", 2026, flat(1500, 4)),
  row("KK SPECS HOUSE", 2025, flat(100)),
];
const clauses = [{ id: "x", title: "Term", body: "One year." }];
const make = (extra) => newDraft({ rows, baseYear: 2026, clauses, today: new Date("2026-11-06T00:00:00Z"), ...extra });

describe("activeCustomers / defaultBranches", () => {
  it("keeps customers that sold in the base year or the year before", () => {
    const m = activeCustomers(rows, 2026);
    expect(m.has("DR SPECS - OLD")).toBe(false);
    expect(m.get("A OPTICS")).toMatchObject({ cur: 4800, prev: 12000 });
    expect([...m.get("A OPTICS").reps]).toEqual(["Alan"]);
  });
  it("starts a group with the sure, active branches only", () => {
    expect(defaultBranches(rows, 2026)).toEqual(["JAC'S OPTOMETRY-ASM", "DR SPECS - PBJ"]);
  });
});

describe("newDraft", () => {
  it("starts an ECP contract with the suggested target, ladder and a year on", () => {
    const d = make({ kind: "ecp", name: "A OPTICS" });
    expect(d.contractYear).toBe(2027);
    expect(d.startDate).toBe("2027-01-01");
    expect(d.issued).toBe("2026-11-06");
    expect(d.customerNames).toEqual(["A OPTICS"]);
    // 2026 projects to 14,400 (own season), +30% on 2025 -> 15% growth step.
    expect(d.growth).toBe(0.15);
    expect(d.target).toBe(16560);
    expect(d.tiers.length).toBeGreaterThan(0);
    expect(d.touched).toBe(false);
    expect(d.quarters).toBeNull();
  });

  it("treats a group as one total across its branches", () => {
    const d = make({ kind: "group" });
    expect(d.title).toBe("G&A Retails");
    expect(d.customerNames).toEqual(["JAC'S OPTOMETRY-ASM", "DR SPECS - PBJ"]);
    const c = computeCalc(d, rows);
    expect(c.analysis.ytd).toBe(16000);
    expect(c.chains.map((x) => x.chain.key)).toEqual(["drspecs", "jac"]);
    expect(d.target).toBeGreaterThan(c.base);
  });

  it("sizes a prospect from the new-account benchmark, or leaves it at zero", () => {
    const d = make({ kind: "prospect", name: "NEW CLINIC" });
    expect(d.customerNames).toEqual([]);
    expect(d.growth).toBeNull();
    expect(d.target).toBe(0); // not enough history in this sample for a benchmark
  });
});

describe("keeping growth and target consistent", () => {
  it("setGrowth moves the target and setTarget moves the growth", () => {
    const d = make({ kind: "ecp", name: "A OPTICS" });
    const g = setGrowth(d, rows, 0.1);
    expect(g.target).toBe(15840); // 14,400 * 1.1
    expect(g.touched).toBe(true);
    const t = setTarget(g, rows, 18000);
    expect(t.growth).toBeCloseTo(0.25, 10);
    expect(t.target).toBe(18000);
  });

  it("a prospect's target can be set directly without a growth figure", () => {
    const d = setTarget(make({ kind: "prospect", name: "X" }), rows, 30000);
    expect(d.target).toBe(30000);
    expect(d.growth).toBeNull();
  });
});

describe("rebase", () => {
  it("an untouched draft follows the new suggestions", () => {
    const d = make({ kind: "group" });
    const fewer = rebase({ ...d, customerNames: ["DR SPECS - PBJ"] }, rows);
    expect(fewer.target).toBeLessThan(d.target);
  });

  it("a hand-tuned draft keeps its target and re-derives growth", () => {
    const d = setTarget(make({ kind: "group" }), rows, 50000);
    const fewer = rebase({ ...d, customerNames: ["DR SPECS - PBJ"] }, rows);
    expect(fewer.target).toBe(50000);
    expect(fewer.growth).not.toBe(d.growth);
  });

  it("applySuggestions resets a tuned draft", () => {
    const tuned = setTarget(make({ kind: "ecp", name: "A OPTICS" }), rows, 99999);
    const back = applySuggestions(tuned, rows);
    expect(back.target).toBe(16560);
    expect(back.touched).toBe(false);
  });
});

describe("calc", () => {
  it("fills quarters from the season until they are edited, and reports a gap", () => {
    const d = make({ kind: "ecp", name: "A OPTICS" });
    const c = computeCalc(d, rows);
    expect(c.quarters.reduce((a, b) => a + b, 0)).toBeCloseTo(d.target, 6);
    expect(c.quarterGap).toBe(0);
    const edited = computeCalc({ ...d, quarters: [1000, 1000, 1000, 1000] }, rows);
    expect(edited.quarterGap).toBe(d.target - 4000);
  });
});

describe("active / inactive and the signed-agreement fields", () => {
  it("starts active, with the salesperson as printed on the agreements", () => {
    const d = newDraft({ kind: "ecp", name: "A OPTICS", rows: rows.map((r) => ({ ...r, sp: "Dino" })), baseYear: 2026, clauses });
    expect(d.active).toBe(true);
    expect(d.salesperson).toBe("DINO LIM");
    expect(d.supplier).toBe("SEED CONTACT LENS (M) SDN. BHD.");
    expect(d.supplierSignatory).toBe("SIMON LOW");
  });

  it("falls back to the rep's own name when the full name isn't known", () => {
    const d = newDraft({ kind: "ecp", name: "A OPTICS", rows, baseYear: 2026, clauses });
    expect(d.salesperson).toBe("ALAN");
  });

  it("opens a contract saved before these fields existed as active, and keeps an inactive one inactive", () => {
    const old = { id: "o1", title: "OLD", kind: "ecp", baseYear: 2025, contractYear: 2026, status: "final", payload: { target: 5000 } };
    expect(draftFromRecord(old)).toMatchObject({ active: true, incentives: [], docTitle: "Loyalty Appreciation Campaign", target: 5000 });
    const off = draftFromRecord({ ...old, payload: { target: 5000, active: false, inactiveNote: "Closed down" } });
    expect(off.active).toBe(false);
    expect(off.inactiveNote).toBe("Closed down");
  });
});

describe("saving", () => {
  it("round-trips through the saved record", () => {
    const d = { ...make({ kind: "ecp", name: "A OPTICS" }), id: "abc" };
    const rec = recordFromDraft(d);
    expect(rec).toMatchObject({ id: "abc", title: "A OPTICS", kind: "ecp", baseYear: 2026, contractYear: 2027, status: "draft" });
    expect(rec.payload.id).toBeUndefined();
    expect(draftFromRecord({ ...rec, payload: JSON.parse(JSON.stringify(rec.payload)) })).toEqual(d);
  });
});
