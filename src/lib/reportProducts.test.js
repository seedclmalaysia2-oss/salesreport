// First-pass sanity checks for the HQ report brand→product mapping. These lock
// the unambiguous rules; the flagged-for-review cases (MC colour split, DISOP
// variants, overseas BOC) are intentionally NOT asserted until confirmed.
import { describe, it, expect } from "vitest";
import { brandToProduct, isFreeOrSample, REPORT_PRODUCTS } from "./reportProducts.js";

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
  it("1D Pure Up = base; MS = multistage", () => {
    expect(brandToProduct("1D PURE UP")).toBe("1 DAY PURE");
    expect(brandToProduct("1D PURE UP MS A")).toBe("1 DAY MULSTISTAGE");
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

describe("product list", () => {
  it("has the 31 report rows in order, starting 1 DAY PURE", () => {
    expect(REPORT_PRODUCTS).toHaveLength(31);
    expect(REPORT_PRODUCTS[0]).toBe("1 DAY PURE");
    expect(REPORT_PRODUCTS.at(-1)).toBe("ACCESSORIES/OTHERS");
  });
});
