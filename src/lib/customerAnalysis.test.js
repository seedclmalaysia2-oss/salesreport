import { describe, it, expect } from "vitest";
import { parseMasterRows, buildAccounts, summarize, normaliseArea, filterAccounts, NOT_LISTED } from "./customerAnalysis.js";

const z = () => new Array(12).fill(0);
const mo = (obj) => { const a = z(); for (const [k, v] of Object.entries(obj)) a[k] = v; return a; };

describe("parseMasterRows", () => {
  it("finds the header and maps columns, dropping email", () => {
    const rows = [
      ["Salesman ID", "Create Date", "Name", "Customer ID", "Remark", "Type", "Town", "state", "Email Address"],
      ["ALAN LOH", 45658, "Acme Optical Sdn Bhd", "ACME OPTICAL", "em", "SIO-OPTC", "Petaling Jaya", "Selangor", "x@y.com"],
      [null, null, null, null],
    ];
    const out = parseMasterRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      code: "ACME OPTICAL", name: "Acme Optical Sdn Bhd", sp: "Alan", created: "2025-01-01",
      chain: "EM", type: "SIO-OPTC", town: "PETALING JAYA", state: "Selangor",
    });
    expect(JSON.stringify(out)).not.toContain("x@y.com");
  });
});

describe("normaliseArea", () => {
  it("folds federal territories and overseas", () => {
    expect(normaliseArea("Wilayah Persekutuan Kuala Lumpur")).toEqual({ state: "Kuala Lumpur", region: "Central" });
    expect(normaliseArea("wilayah Persekutuan Labuan").state).toBe("Labuan");
    expect(normaliseArea("NEGERI SEMBILAN").region).toBe("Southern");
    expect(normaliseArea("brunei")).toEqual({ state: "Brunei", region: "Overseas" });
    expect(normaliseArea("Not Applicable", "OVERSEA").region).toBe("Overseas");
    expect(normaliseArea("", "SIO-OPTC").region).toBe("Unknown");
  });
});

describe("buildAccounts", () => {
  const master = [
    { code: "GROW", name: "Grow Co", sp: "Alan", created: "2020-01-01", chain: "", type: "A", town: "X", state: "Johor" },
    { code: "DROP", name: "Drop Co", sp: "Alan", created: "2020-01-01", chain: "", type: "A", town: "X", state: "Johor" },
    { code: "GONE", name: "Gone Co", sp: "Dino", created: "2020-01-01", chain: "", type: "B", town: "Y", state: "Sabah" },
    { code: "NEVER", name: "Never Co", sp: "Dino", created: "2026-03-01", chain: "", type: "B", town: "Y", state: "Sabah" },
    { code: "FRESH", name: "Fresh Co", sp: "Dino", created: "2026-02-01", chain: "", type: "B", town: "Y", state: "Sabah" },
  ];
  const sales = [
    { sp: "Alan", year: 2025, customer: "GROW", months: mo({ 0: 100, 1: 100, 11: 999 }), total: 1199 },
    { sp: "Alan", year: 2026, customer: "GROW", months: mo({ 0: 150, 1: 150 }), total: 300 },
    { sp: "Alan", year: 2025, customer: "DROP", months: mo({ 0: 100, 1: 100 }), total: 200 },
    { sp: "Alan", year: 2026, customer: "DROP", months: mo({ 1: 50 }), total: 50 },
    { sp: "Dino", year: 2025, customer: "GONE", months: mo({ 2: 500 }), total: 500 },
    { sp: "Dino", year: 2026, customer: "FRESH", months: mo({ 1: 80 }), total: 80 },
    { sp: "Khen", year: 2026, customer: "STRAY", months: mo({ 0: 10 }), total: 10 },
  ];
  const { accounts, asOf } = buildAccounts({ master, sales, year: 2026, lapseMonths: 6 });
  const by = Object.fromEntries(accounts.map((a) => [a.code, a]));

  it("uses the last month with sales as the YTD point", () => expect(asOf).toBe(1));
  it("compares the same months last year", () => {
    expect(by.GROW.ytd).toBe(300);
    expect(by.GROW.ly).toBe(200);
    expect(by.GROW.status).toBe("growing");
    expect(by.DROP.status).toBe("declining");
  });
  it("flags inactive, never-ordered and new accounts", () => {
    expect(by.GONE.status).toBe("lapsed");
    expect(by.GONE.monthsSince).toBe(11);
    expect(by.NEVER.status).toBe("never");
    expect(by.FRESH.status).toBe("new");
  });
  it("keeps sales customers missing from the list", () => {
    expect(by.STRAY.type).toBe(NOT_LISTED);
    expect(by.STRAY.sp).toBe("Khen");
  });
  it("summarises and filters", () => {
    const s = summarize(accounts);
    expect(s.total.accounts).toBe(6);
    expect(s.total.ytd).toBe(300 + 50 + 80 + 10);
    expect(s.byType.at(-1).key).toBe(NOT_LISTED);
    expect(filterAccounts(accounts, { scope: "Dino" })).toHaveLength(3);
    expect(s.gainers[0].code).toBe("GROW");
    expect(s.losers[0].code).toBe("DROP"); // GONE only bought in Mar, outside Jan–Feb
  });
});

describe("matching", () => {
  it("never gives two accounts the same sales when codes differ only by spacing", () => {
    const master = [
      { code: "TRUE VISION BAHAU", name: "True Vision (Bahau)", sp: "Dino", created: "2021-01-01", chain: "", type: "A", town: "", state: "" },
      { code: "TRUEVISION BAHAU", name: "Truevision Sdn Bhd", sp: "Simon", created: "2016-01-01", chain: "", type: "A", town: "", state: "" },
    ];
    const sales = [
      { sp: "Dino", year: 2026, customer: "TRUE VISION BAHAU", months: mo({ 0: 100 }), total: 100 },
      { sp: "Simon", year: 2026, customer: "TRUEVISION BAHAU", months: mo({ 0: 7 }), total: 7 },
    ];
    const { accounts } = buildAccounts({ master, sales, year: 2026 });
    expect(accounts.map((a) => a.ytd)).toEqual([100, 7]);
    expect(new Set(accounts.map((a) => a.id)).size).toBe(2);
  });
});

describe("type typos", () => {
  it("folds SIO-OPTOM-MY into SIO-OPTM-MY, including already-stored rows", () => {
    const master = [{ code: "A", name: "A", sp: "Alan", created: null, chain: "", type: "SIO-OPTOM-MY", town: "", state: "" }];
    expect(buildAccounts({ master, sales: [], year: 2026 }).accounts[0].type).toBe("SIO-OPTM-MY");
    const rows = [["Customer ID", "Type"], ["A", "sio-optom-my"]];
    expect(parseMasterRows(rows)[0].type).toBe("SIO-OPTM-MY");
  });
});
