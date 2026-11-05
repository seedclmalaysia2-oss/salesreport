import { describe, it, expect } from "vitest";
import { chainOf, chainBranches, CHAINS } from "./chains.js";

describe("chainOf", () => {
  it("recognises branch names from the real data", () => {
    expect(chainOf("DR SPECS - PBJ").key).toBe("drspecs");
    expect(chainOf("JAC'S OPTOMETRY-JABI").key).toBe("jac");
    expect(chainOf("MAG EYEWEAR - PCH").key).toBe("mag");
    expect(chainOf("OPTICS 81 - KPG").key).toBe("optics81");
    expect(chainOf("MAX VISION - WMJ").key).toBe("maxvision");
    expect(chainOf("MAX VISION OPTOMETRY").key).toBe("maxvision");
    expect(chainOf("SPECS HOUSE - SHGBA").key).toBe("specshouse");
  });

  it("does not claim ordinary customers", () => {
    expect(chainOf("99 OPTICS")).toBeNull();
    expect(chainOf("MAXIMUM OPTICAL")).toBeNull();
    expect(chainOf("")).toBeNull();
    expect(chainOf(undefined)).toBeNull();
  });

  it("only matches KK SPECS HOUSE when asked to be loose", () => {
    expect(chainOf("KK SPECS HOUSE")).toBeNull();
    expect(chainOf("KK SPECS HOUSE", { loose: true }).key).toBe("specshouse");
  });

  it("covers the six chains under G&A Retails", () => {
    expect(CHAINS.map((c) => c.label)).toEqual(["Jac's Optometry", "Dr. Specs", "Mag Eyewear", "Optics 81", "Max Vision", "Specs House"]);
  });
});

describe("chainBranches", () => {
  const names = ["SPECS HOUSE - TAS", "DR SPECS - PBJ", "KK SPECS HOUSE", "99 OPTICS", "JAC'S OPTOMETRY-ASM", "DR SPECS - PBJ"];

  it("lists branches by chain order, flags the uncertain one, and drops the rest", () => {
    const r = chainBranches(names);
    expect(r.map((b) => b.name)).toEqual(["JAC'S OPTOMETRY-ASM", "DR SPECS - PBJ", "KK SPECS HOUSE", "SPECS HOUSE - TAS"]);
    expect(r.find((b) => b.name === "KK SPECS HOUSE").sure).toBe(false);
    expect(r.find((b) => b.name === "DR SPECS - PBJ").sure).toBe(true);
  });

  it("narrows to the chains asked for", () => {
    const r = chainBranches(names, ["drspecs"]);
    expect(r.map((b) => b.name)).toEqual(["DR SPECS - PBJ"]);
  });
});
