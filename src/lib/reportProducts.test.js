// First-pass sanity checks for the HQ report brand→product mapping. These lock
// the unambiguous rules; the flagged-for-review cases (MC colour split, DISOP
// variants, overseas BOC) are intentionally NOT asserted until confirmed.
import { describe, it, expect } from "vitest";
import { brandToProduct, isFreeOrSample, REPORT_PRODUCTS, aggregateProductMonthly } from "./reportProducts.js";

describe("brandToProduct — unambiguous rules", () => {
  it("1-day pure torics → astigmatism", () => {
    expect(brandToProduct("1DPT -0.75/AX10 ce")).toBe("1 DAY PURE ASTIGMATISM");
    expect(brandToProduct("1DPT -1.25/AX180")).toBe("1 DAY PURE ASTIGMATISM");
  });
  it("Eye Coffret makes vs torics", () => {
    expect(brandToProduct("ECB10-M BASE MAKE")).toBe("EYE COFFRET-M");
    expect(brandToProduct("ECR10-M TORIC -0.75X180")).toBe("EYE COFFRET-M 10 TORIC");
    expect(brandToProduct("ECW30-M TORIC -1.25X180")).toBe("EYE COFFRET-M 30 TORIC");
  });
  it("1 day pure EDOF / SILFA / view support", () => {
    expect(brandToProduct("1D PURE EDOF [HIGH]")).toBe("1 DAYPURE EDOF");
    expect(brandToProduct("1D PURE SILFA")).toBe("1 DAY PURE SILFA");
    expect(brandToProduct("1D PURE VIEW SUPPORT")).toBe("1 DAY VIEW SUPPORT");
  });
  it("RGP / Ultra Vision / Wohlk", () => {
    expect(brandToProduct("SEED UV-1 KC RGP")).toBe("RGP UV-1 / UV-1 KC");
    expect(brandToProduct("UV DURAWAVE [Sphere]")).toBe("ULTRA VISION");
    expect(brandToProduct("Wohlk C.Life Sphere")).toBe("Wohlk KE RGP");
  });
});

describe("HQ-confirmed mappings (2026-07-31)", () => {
  it("Monthly Color split by colour", () => {
    expect(brandToProduct("MC-COCOA BRN")).toBe("MONTHLY COLOR UV - PEGAVISION");
    expect(brandToProduct("MC-NAT GRAY")).toBe("MONTHLY COLOR UV - BLUE");
    expect(brandToProduct("MC-FIRE BROWN")).toBe("MONTHLY COLOR UV - BLUE");
    expect(brandToProduct("MC-SPARK GRAY")).toBe("MONTHLY COLOR UV - ORANGE");
    expect(brandToProduct("MC-JADE GREEN")).toBe("MONTHLY COLOR UV - ORANGE");
    expect(brandToProduct("MC-SHINING HONEY")).toBe("MONTHLY COLOR UV - ORANGE");
    expect(brandToProduct("MCII-DARK GRAY")).toBe("MONTHLY COLOR UV  II");
  });
  it("DISOP eyedrop vs H2O2", () => {
    expect(brandToProduct("DISOP AQUA DUAL GEL 20VL")).toBe("DISOP ULTRA EYEDROP");
    expect(brandToProduct("DISOP ACUAISS ULTRA 10ml")).toBe("DISOP ULTRA EYEDROP");
    expect(brandToProduct("DISOP HidroHealth 360ml (Protein Removal)")).toBe("DISOP H2O2 SOLUTION");
  });
  it("1D Pure Up = base; MS = multistage; UP TORIC = astigmatism", () => {
    expect(brandToProduct("1D PURE UP")).toBe("1 DAY PURE");
    expect(brandToProduct("1D PURE UP MS A")).toBe("1 DAY MULSTISTAGE");
    expect(brandToProduct("1D PURE UP TORIC Trial Lens")).toBe("1 DAY PURE ASTIGMATISM");
  });
  it("accessories by ACC / ACCSD code", () => {
    expect(brandToProduct("ACCSD BATTERY")).toBe("ACCESSORIES/OTHERS");
    expect(brandToProduct("ACC CASE")).toBe("ACCESSORIES/OTHERS");
  });
});

describe("exclusions", () => {
  it("FOC tie-in goods and samples are excluded", () => {
    expect(isFreeOrSample("1D PURE EDOF HIGH [FOC tie in goods]")).toBe(true);
    expect(brandToProduct("1D PURE EDOF HIGH [FOC tie in goods]")).toBeNull();
    expect(brandToProduct("DISOP ACUAISS ULTRA 10ml SAMPLE")).toBeNull();
    expect(brandToProduct("NA")).toBeNull();
  });
});

describe("aggregateProductMonthly", () => {
  it("buckets by product & month; FOC boxes count, other years/promo/samples don't", () => {
    const rows = [
      { date: "2026-03-10", brand: "1D PURE EDOF [HIGH]", qty: 2, amount: 280, uom: "BOX" },
      { date: "2026-03-12", brand: "ECB10-M BASE MAKE", qty: 5, amount: 200, uom: "BOX" },
      { date: "2026-07-01", brand: "1D PURE EDOF [LOW]", qty: 1, amount: 140, uom: "BOX" },
      { date: "2026-03-15", brand: "1D PURE EDOF HIGH [FOC tie in goods]", qty: 3, amount: 0, uom: "BOX" },
      { date: "2026-03-16", brand: "Promotion Use - SEED Ball Pen [FOC tie in goods]", qty: 99, amount: 0, uom: "PCS" },
      { date: "2025-03-01", brand: "1D PURE EDOF [MID]", qty: 9, amount: 9, uom: "BOX" },
      { date: "2026-03-20", brand: "NA", qty: 4, amount: 44, uom: "BOX" },
    ];
    const { products, unmapped } = aggregateProductMonthly(rows, 2026);
    expect(products["1 DAYPURE EDOF"].qty[2]).toBe(5);    // March: 2 sold + 3 FOC boxes
    expect(products["1 DAYPURE EDOF"].amount[2]).toBe(280); // FOC adds 0 revenue
    expect(products["1 DAYPURE EDOF"].qty[6]).toBe(1);    // July
    expect(products["EYE COFFRET-M"].qty[2]).toBe(5);
    expect(products["1 DAYPURE EDOF"].qty.reduce((a, b) => a + b, 0)).toBe(6); // 2+3+1; 2025 & promo out
    expect(unmapped["NA"]).toEqual({ qty: 4, amount: 44 });
  });

  it("converts trial pieces to boxes by pack size; non-trial boxes count as-is", () => {
    const rows = [
      { date: "2026-02-01", brand: "1D PURE EDOF Trial", qty: 64, amount: 0, uom: "PCS" }, // 64/32 = 2 boxes
      { date: "2026-02-02", brand: "1D PURE EDOF [HIGH]", qty: 3, amount: 420, uom: "BOX" },
      { date: "2026-02-03", brand: "MC-COCOA BRN Trial Lens", qty: 4, amount: 0 }, // 4/2 = 2 boxes (Pegavision)
    ];
    const { products } = aggregateProductMonthly(rows, 2026);
    expect(products["1 DAYPURE EDOF"].qty[1]).toBe(5); // 2 converted + 3 box
    expect(products["MONTHLY COLOR UV - PEGAVISION"].qty[1]).toBe(2);
  });

  it("HQ trial-lens SKUs: map to the base product; Trial → pieces, no-Trial → boxes", () => {
    const rows = [
      // Eye Coffret: trial lens = 10pcs/box; BASE/RICH MAKE = boxes
      { date: "2026-04-01", brand: "ECB Trial Lens [FOC tie in goods]", qty: 40, amount: 0 }, // 40/10 = 4
      { date: "2026-04-02", brand: "EC10 BASE MAKE [FOC tie in goods]", qty: 3, amount: 0 },  // 3 boxes
      // Minasoft 1-day colour: MN- trial = 10pcs/box; MN- SiHy box = as-is
      { date: "2026-04-03", brand: "MN-Rose Brown Trial Lens (FOC tie in goods)", qty: 20, amount: 0 }, // 2
      { date: "2026-04-04", brand: "MN-VIOLET SiHy (FOC tie in goods)", qty: 5, amount: 0 },  // 5 boxes
      // Minasoft Care: trial = 3pcs/box
      { date: "2026-04-05", brand: "MN-Care UV Trial Lens (FOC tie in goods)", qty: 9, amount: 0 }, // 3
      // MonthlyPure trial = 6pcs/box → Pure6
      { date: "2026-04-06", brand: "MonthlyPure Trial Lens [FOC tie in goods]", qty: 12, amount: 0 }, // 2
    ];
    const { products, unmapped } = aggregateProductMonthly(rows, 2026);
    expect(Object.keys(unmapped)).toHaveLength(0);
    expect(products["EYE COFFRET-M"].qty[3]).toBe(7);          // 4 + 3
    expect(products["MINASOFT 1DAY COLOR UV"].qty[3]).toBe(7); // 2 + 5
    expect(products["MINASOFT CARE UV"].qty[3]).toBe(3);
    expect(products["MONTHLY PURE6"].qty[3]).toBe(2);
  });
});

describe("product list", () => {
  it("has the 31 report rows in order, starting 1 DAY PURE", () => {
    expect(REPORT_PRODUCTS).toHaveLength(31);
    expect(REPORT_PRODUCTS[0]).toBe("1 DAY PURE");
    expect(REPORT_PRODUCTS.at(-1)).toBe("ACCESSORIES/OTHERS");
  });
});
