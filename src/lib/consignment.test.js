import { describe, it, expect } from "vitest";
import { toLines, totals, people, attention, outletRows, ownerIsRep, bandOf, ageText, agoText } from "./consignment.js";

const TODAY = "2026-11-06";
const row = (o = {}) => ({
  outlet: "HIYORI", owner: "Dino", state: "Johor", town: "JB", product: "Eye Coffret BM", family: "EC",
  csg_no: "CSG1", csg_date: "2026-10-01", qty: 10, needs_refresh: false, tag: null, ...o,
});

describe("age", () => {
  it("bands by days since the CSG date", () => {
    expect(bandOf(10)).toBe(0);
    expect(bandOf(183)).toBe(0);
    expect(bandOf(184)).toBe(1);
    expect(bandOf(366)).toBe(2);
    expect(bandOf(800)).toBe(3);
    expect(bandOf(null)).toBe(4);
  });
  it("words an age", () => {
    expect(ageText(1)).toBe("1 day");
    expect(ageText(100)).toBe("3 mo");
    expect(ageText(800)).toBe("2 yr 2 mo");
    expect(ageText(null)).toBe("No date");
  });
  it("lines carry their age and band", () => {
    const [l] = toLines([row({ csg_date: "2024-11-06" })], TODAY);
    expect(l.days).toBe(730);
    expect(l.band).toBe(2);
    expect(toLines([row({ csg_date: null })], TODAY)[0].band).toBe(4);
  });
});

describe("totals", () => {
  it("adds units, outlets, refresh marks and the over-a-year share", () => {
    const lines = toLines([
      row({ qty: 10 }),
      row({ qty: 5, csg_date: "2025-01-01", needs_refresh: true }),                 // over a year
      row({ qty: 7, outlet: "SKY EYE", csg_date: "2023-01-01" }),                  // over 2 years
    ], TODAY);
    const t = totals(lines);
    expect(t.units).toBe(22);
    expect(t.outlets).toBe(2);
    expect(t.refreshLines).toBe(1);
    expect(t.refreshUnits).toBe(5);
    expect(t.overYearUnits).toBe(12);
  });
});

describe("people and attention", () => {
  const lines = toLines([
    row({ owner: "Dino", needs_refresh: true }),
    row({ owner: "Dino", csg_no: "CSG2", csg_date: "2022-01-01" }),
    row({ owner: "Dr Specs", csg_no: "CSG3", needs_refresh: true }),
  ], TODAY);
  it("keeps key accounts apart from the salesmen", () => {
    const p = people(lines);
    expect(p.main.map(w => w.name)).toEqual(["Dino"]);
    expect(p.subs.map(w => w.name)).toEqual(["Dr Specs"]);
    expect(p.main[0]).toMatchObject({ marked: 1, old: 1 });
  });
  it("lists marked stock, then unmarked stock over 2 years", () => {
    const a = attention(lines);
    expect(a.flagged).toHaveLength(2);
    expect(a.unflagged.map(l => l.csgNo)).toEqual(["CSG2"]);
  });
});

describe("outlets", () => {
  it("groups lines into one CSG each, oldest first, with their products", () => {
    const lines = toLines([
      row({ csg_no: "NEW", csg_date: "2026-10-01", qty: 2 }),
      row({ csg_no: "OLD", csg_date: "2025-01-01", qty: 3, product: "A" }),
      row({ csg_no: "OLD", csg_date: "2025-01-01", qty: 4, product: "B" }),
    ], TODAY);
    const [o] = outletRows(lines);
    expect(o.units).toBe(9);
    expect(o.csgs.map(c => c.csgNo)).toEqual(["OLD", "NEW"]);
    expect(o.csgs[0].products).toEqual([{ product: "A", qty: 3 }, { product: "B", qty: 4 }]);
    expect(o.oldest).toBe(o.csgs[0].days);
  });
});

describe("names and times", () => {
  it("matches workbook owners to sales reps despite spelling", () => {
    expect(ownerIsRep("Khen Tan", "Khen")).toBe(true);
    expect(ownerIsRep("Sakina", "Sakinah")).toBe(true);
    expect(ownerIsRep("Dino", "Alan")).toBe(false);
    expect(ownerIsRep("", "Alan")).toBe(false);
  });
  it("words how long ago", () => {
    const now = Date.parse("2026-11-06T10:00:00Z");
    expect(agoText("2026-11-06T09:59:40Z", now)).toBe("just now");
    expect(agoText("2026-11-06T09:30:00Z", now)).toBe("30 min ago");
    expect(agoText("2026-11-06T07:00:00Z", now)).toBe("3 h ago");
  });
});
