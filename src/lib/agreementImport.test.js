import { describe, it, expect } from "vitest";
import { pickAgreementFiles, parseAgreement, planImport, draftFromAgreement, customerKey, matchCustomer, repFromPath } from "./agreementImport.js";

const f = (path, modified = 1) => ({ path, name: path.split("/").pop(), modified });
const p = (t) => ({ text: t });

describe("pickAgreementFiles", () => {
  const files = [
    f("SALES CONTRACT -DINO/2026 TK OPTICAL.docx"),
    f("SALES CONTRACT -DINO/2026 TK OPTICAL.pdf"), // same agreement as a PDF: skipped
    f("SALES CONTRACT -DINO/2026 SVC.pdf"), // PDF only: cannot be read
    f("SALES CONTRACT -KHEN/2026 Medi Eye.docx", 1),
    f("SALES CONTRACT -KHEN/2026 Medi Eye-1.docx", 5), // a newer copy of the same one
    f("Proposal ( not confirm )/proposal X.docx"),
    f("SALES CONTRACT -DINO/Contract calculation.xlsx"),
    f("SALES CONTRACT -DINO/Template - BOC.docx"),
    f("SALES CONTRACT -DINO/~$temp.docx"),
  ];
  const r = pickAgreementFiles(files);

  it("reads one Word file per agreement and skips its PDF twin", () => {
    expect(r.chosen.map((x) => x.path)).toEqual(["SALES CONTRACT -DINO/2026 TK OPTICAL.docx", "SALES CONTRACT -KHEN/2026 Medi Eye-1.docx"]);
    expect(r.skipped.pdfTwins).toBe(1);
    expect(r.skipped.copies).toBe(1);
  });
  it("lists PDFs that have no Word version, and ignores proposals, templates and spreadsheets", () => {
    expect(r.pdfOnly.map((x) => x.name)).toEqual(["2026 SVC.pdf"]);
    expect(r.skipped.proposals).toBe(3); // proposal folder, template, calculation sheet
    expect(r.skipped.other).toBe(0);
  });
});

describe("parseAgreement", () => {
  const doc = [
    "MEMORANDUM OF UNDERSTANDING", "LOYALTY APPRECIATION CAMPAIGN 2026",
    "Supplier’s Name : SEED CONTACT LENS (M) SDN. BHD.", "Customer’s Name : TK OPTICAL (PUCHONG)",
    "DURATION", "1st JULY 2026 ~ 31st December 2026",
    "Target", "Additional Sponsorship", "16,000 & Above", "4%", "13,000 ~ 15,999", "3%", "10,000 ~ 12,999", "2%",
    "Special Promotion", "BUY 3 FREE 1 (1daypure sphere)",
    "Product Incentive", "1dayPure Moisture", "RM5/box", "RM3/set (Minasoft 1day Color 2+1)",
  ].map(p);
  const r = parseAgreement(doc, "2026 TK OPTICAL.docx");

  it("reads customer, year, dates and sponsorship bands lowest first", () => {
    expect(r.customer).toBe("TK OPTICAL (PUCHONG)");
    expect(r.year).toBe(2026);
    expect([r.start, r.end]).toEqual(["2026-07-01", "2026-12-31"]);
    expect(r.tiers).toEqual([{ from: 10000, pct: 2 }, { from: 13000, pct: 3 }, { from: 16000, pct: 4 }]);
    expect(r.detail).toBe("full");
  });
  it("reads the promotion and both styles of product incentive", () => {
    expect(r.promoNote).toBe("BUY 3 FREE 1 (1daypure sphere)");
    expect(r.incentives).toEqual([{ item: "1dayPure Moisture", value: "RM5/box" }, { item: "Minasoft 1day Color 2+1", value: "RM3/set" }]);
  });
  it("falls back to the file name when the customer line is blank", () => {
    const x = parseAgreement([p("Customer’s Name : ______________"), p("Terms")], "2025 CKL Sales Incentive.docx");
    expect(x.customer).toBe("CKL");
    expect(x.year).toBe(2025);
  });
});

describe("planImport", () => {
  const item = (customer, year, end, path = "SALES CONTRACT -DINO/x.docx") => ({ file: { path, name: "x.docx" }, parsed: { customer, year, end, tiers: [], incentives: [] } });
  it("keeps the newest agreement per customer and marks 2026 or later active", () => {
    const plan = planImport([
      item("TK OPTICAL (PUCHONG)", 2025, "2025-12-31"),
      item("TK Optical Sdn Bhd (Puchong)", 2026, "2026-12-31"),
      item("OLD SHOP", 2019, null),
    ]);
    expect(plan.rows.map((r) => [r.parsed.year, r.active])).toEqual([[2026, true], [2019, false]]);
    expect(plan.older).toBe(1);
  });
  it("flags what is already saved", () => {
    const plan = planImport([item("OLD SHOP", 2019, null)], { existing: [{ title: "Old Shop", contractYear: 2019 }] });
    expect(plan.rows[0].alreadySaved).toBe(true);
  });
});

describe("matching and drafts", () => {
  it("cleans names and matches dashboard customers", () => {
    expect(customerKey("SVC OPTICAL GROUP SDN BHD (RASAH JAYA)")).toBe("SVC OPTICAL GROUP RASAH JAYA");
    expect(matchCustomer("TK OPTICAL (PUCHONG)", ["99 OPTICS", "TK OPTICAL PUCHONG"])).toBe("TK OPTICAL PUCHONG");
    expect(matchCustomer("NEW", ["NEW MEGA OPTICS"])).toBeNull();
    expect(repFromPath("SALES CONTRACT -DINO/x.docx")).toBe("Dino");
  });
  it("builds a final, inactive-or-active draft from an agreement", () => {
    const row = { file: { path: "SALES CONTRACT -DINO/a.docx" }, rep: "Dino", active: false, parsed: { customer: "SHOP", year: 2019, start: null, end: null, tiers: [{ from: 20000, pct: 3 }, { from: 30000, pct: 5 }], incentives: [], promoNote: "" } };
    const d = draftFromAgreement(row, { clauses: [{ title: "T", body: "b" }], match: "SHOP SDN" });
    expect(d).toMatchObject({ kind: "ecp", status: "final", active: false, contractYear: 2019, baseYear: 2018, target: 20000, salesperson: "DINO LIM", customerNames: ["SHOP SDN"] });
    expect(d.tiers).toEqual([{ at: 1, pct: 3 }, { at: 1.5, pct: 5 }]);
    expect(d.startDate).toBe("2019-01-01");
    expect(d.inactiveNote).toMatch(/2019/);
  });
});
