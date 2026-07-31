// Filename → kind detection. These labels decide which fact table an uploaded
// workbook feeds, so the mapping is load-bearing: a "Stock Sales Analysis -
// Detail" file must read as the WEEKLY source, not as a brand summary, even
// though both filenames start "Stock Sales Analysis…". parseFilename is pure
// string work (no xlsx), so it tests cleanly in the Node environment.
import { describe, it, expect } from "vitest";
import { parseFilename } from "./parseXlsx.js";

describe("parseFilename — classifies each Autocount export", () => {
  it("year-only customer file", () => {
    expect(parseFilename("2026 Sales Analysis by customer.xlsx"))
      .toMatchObject({ kind: "Sales Analysis by customer", year: 2026, sp: "All" });
  });

  it("year-last customer file (new naming)", () => {
    expect(parseFilename("Sales Analysis 2026.xlsx"))
      .toMatchObject({ kind: "Sales Analysis by customer", year: 2026, sp: "All" });
    expect(parseFilename("Sales Analysis 2025.xlsx"))
      .toMatchObject({ kind: "Sales Analysis by customer", year: 2025, sp: "All" });
    expect(parseFilename("Sales Analysis by customer 2026.xlsx"))
      .toMatchObject({ kind: "Sales Analysis by customer", year: 2026, sp: "All" });
    // must NOT be mistaken for the brand file (which starts "Stock Sales Analysis")
    expect(parseFilename("Alan 2026 Stock Sales Analysis - Summary by Brand.xlsx")?.kind)
      .toMatch(/Summary by brand/i);
  });

  it("per-rep customer file", () => {
    expect(parseFilename("Alan 2025 Sales Analysis by customer.xlsx"))
      .toMatchObject({ kind: "Sales Analysis by customer", year: 2025, sp: "Alan" });
  });

  it("brand summary file", () => {
    expect(parseFilename("Dino 2026 Stock Sales Analysis - Summary by brand.xlsx")?.kind)
      .toMatch(/Summary by brand/i);
  });

  it("customer invoice listing (a weekly source)", () => {
    expect(parseFilename("Customer Invoice Listing jul2026.xlsx"))
      .toMatchObject({ kind: "Customer Invoice Listing", year: 2026 });
  });

  it("stock sales analysis - detail (the current weekly source)", () => {
    expect(parseFilename("Stock Sales Analysis - Detail 31052026.xlsx")?.kind)
      .toBe("Stock Sales Analysis - Detail");
  });

  it("returns null for unrecognised names", () => {
    expect(parseFilename("random.xlsx")).toBeNull();
    expect(parseFilename("notes.txt")).toBeNull();
  });
});

describe("Stock-Detail must stay distinct from the brand summary", () => {
  // Regression guard: a naive /Stock Sales/i substring test matches BOTH files,
  // which once routed Stock-Detail uploads into brand sync and skipped the
  // weekly sync entirely — so the Weekly board never moved on a dropzone upload.
  it("Detail is not the brand summary, and vice versa", () => {
    const detail = parseFilename("Stock Sales Analysis - Detail 290726.xlsx");
    const brand = parseFilename("Dino 2026 Stock Sales Analysis - Summary by brand.xlsx");
    expect(detail.kind).toBe("Stock Sales Analysis - Detail");
    expect(detail.kind).not.toMatch(/Summary by brand/i);
    expect(brand.kind).toMatch(/Summary by brand/i);
    expect(brand.kind).not.toMatch(/Detail/i);
  });
});
