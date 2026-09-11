// Tests for the Data-tab file store's OVERWRITE rule — the guarantee behind
// "the daily upload shows one file per year".
//
// The daily Stock-Detail export is date-stamped ("… Detail 10092026.xlsx",
// then "… 11092026.xlsx"), so its name changes every day. uploadFile() must
// therefore supersede invoice files by (kind='invoice', year) — newest upload
// wins, name-independent — so yesterday's copy is soft-deleted and exactly one
// live invoice file per year remains. Non-invoice files (stable, year-bearing
// names) keep the classic same-name replacement.
//
// Supabase is mocked, so this is pure offline logic. The mock records the
// UPDATE (supersede) builder's filter calls so we can assert what it targeted.
import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => ({
  state: {
    updates: [], // each supersede: { patch, filters: [["eq","kind","invoice"], …] }
    inserts: [],
    insertId: "new-id",
    insertError: null,
    updateError: null,
    uploadError: null,
    // Rows handed back by the mocked fetchAll, for the listFiles paging test.
    allRows: [],
  },
}));

vi.mock("./supabase.js", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: H.state.uploadError }),
        remove: () => Promise.resolve({ error: null }),
      }),
    },
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: "uid-1" } } } }),
    },
    from: () => ({
      insert: (row) => {
        H.state.inserts.push(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: H.state.insertError
                  ? null
                  : { id: H.state.insertId, ...row },
                error: H.state.insertError,
              }),
          }),
        };
      },
      update: (patch) => {
        const rec = { patch, filters: [] };
        H.state.updates.push(rec);
        const builder = {
          is: (c, v) => (rec.filters.push(["is", c, v]), builder),
          neq: (c, v) => (rec.filters.push(["neq", c, v]), builder),
          eq: (c, v) => (rec.filters.push(["eq", c, v]), builder),
          then: (resolve, reject) =>
            Promise.resolve({ error: H.state.updateError }).then(resolve, reject),
        };
        return builder;
      },
    }),
  },
  // listFiles() reads through fetchAll so it pages past PostgREST's 1000-row
  // cap. Without this export the module would fail to evaluate.
  fetchAll: async () => H.state.allRows,
  aggregate: () => ({}),
  parseFile: async () => ({ ok: false }),
}));

import { listFiles, uploadFile } from "./files.js";

beforeEach(() => {
  H.state.updates.length = 0;
  H.state.inserts.length = 0;
  H.state.insertId = "new-id";
  H.state.insertError = null;
  H.state.updateError = null;
  H.state.uploadError = null;
  H.state.allRows = [];
});

// The library used to do a single unbounded .select(), which silently stopped at
// PostgREST's 1000-row cap — past that, older uploads vanished from the list and
// from Trash. It now reads through the paginated fetchAll and sorts client-side,
// so the newest-first order has to be asserted here rather than trusted to the
// server's ORDER BY.
describe("listFiles", () => {
  it("returns newest-first regardless of the order the pages arrive in", async () => {
    H.state.allRows = [
      { id: "b", name: "mid.xlsx",    uploaded_at: "2026-05-02T00:00:00Z" },
      { id: "c", name: "oldest.xlsx", uploaded_at: "2026-01-09T00:00:00Z" },
      { id: "a", name: "newest.xlsx", uploaded_at: "2026-09-11T00:00:00Z" },
    ];
    const out = await listFiles();
    expect(out.map(e => e.id)).toEqual(["a", "b", "c"]);
  });

  it("does not drop rows that carry no uploaded_at", async () => {
    H.state.allRows = [
      { id: "dated",   name: "d.xlsx", uploaded_at: "2026-03-01T00:00:00Z" },
      { id: "undated", name: "u.xlsx", uploaded_at: null },
    ];
    const out = await listFiles();
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("dated");
    expect(out[1].uploadedAt).toBeNull();
  });
});

const fakeFile = (name) => ({ name, size: 123 });

// Helper: the single supersede UPDATE issued after the insert.
const supersede = () => {
  expect(H.state.updates.length).toBe(1);
  return H.state.updates[0];
};
const hasFilter = (rec, op, col, val) =>
  rec.filters.some(([o, c, v]) => o === op && c === col && v === val);

describe("uploadFile overwrite rule → one file per year", () => {
  it("invoice (Stock-Detail): supersedes by (kind, year), never by name", async () => {
    const parsed = {
      file: "Stock Sales Analysis - Detail 10092026.xlsx",
      kind: "invoice",
      sp: null,
      year: 2026,
      rowCount: 2,
      rows: [{ date: "2026-09-01", invoice: "INV-1", amount: 10, sp: "Alan" }],
    };
    await uploadFile(fakeFile(parsed.file), parsed);

    const s = supersede();
    // Scope the soft-delete to every OTHER live invoice row for the SAME year.
    expect(hasFilter(s, "eq", "kind", "invoice")).toBe(true);
    expect(hasFilter(s, "eq", "year", 2026)).toBe(true);
    expect(hasFilter(s, "is", "deleted_at", null)).toBe(true);
    expect(hasFilter(s, "neq", "id", "new-id")).toBe(true);
    // Crucially NOT keyed on the (daily-changing) filename.
    expect(s.filters.some(([o, c]) => o === "eq" && c === "name")).toBe(false);
    expect(s.patch.deleted_at).toBeTruthy();
  });

  it("a differently-named next-day invoice upload still supersedes the same year", async () => {
    // Yesterday's copy would carry a different name; the (kind, year) match is
    // what catches it. Assert the filter set is name-independent and year-scoped.
    const parsed = {
      file: "Stock Sales Analysis - Detail 11092026.xlsx", // new name, same year
      kind: "invoice",
      sp: null,
      year: 2026,
      rowCount: 1,
      rows: [{ date: "2026-09-11", invoice: "INV-9", amount: 5, sp: "Dino" }],
    };
    await uploadFile(fakeFile(parsed.file), parsed);
    const s = supersede();
    expect(hasFilter(s, "eq", "year", 2026)).toBe(true);
    expect(hasFilter(s, "eq", "kind", "invoice")).toBe(true);
    expect(s.filters.some(([o, c]) => o === "eq" && c === "name")).toBe(false);
  });

  it("invoice files of DIFFERENT years don't supersede each other", async () => {
    const p2025 = {
      file: "Stock Sales Analysis - Detail 31122025.xlsx",
      kind: "invoice", sp: null, year: 2025, rowCount: 1,
      rows: [{ date: "2025-12-31", invoice: "INV-Y", amount: 7, sp: "Khen" }],
    };
    await uploadFile(fakeFile(p2025.file), p2025);
    const s = supersede();
    // 2025 upload scopes to year 2025 only — a live 2026 file is untouched.
    expect(hasFilter(s, "eq", "year", 2025)).toBe(true);
    expect(hasFilter(s, "eq", "year", 2026)).toBe(false);
  });

  it("customer file: keeps the classic same-name replacement", async () => {
    const parsed = {
      file: "Sales Analysis 2026.xlsx",
      kind: "customer",
      sp: "All",
      year: 2026,
      rowCount: 1,
      rows: [{ sp: "Alan", year: 2026, customer: "ACME", months: Array(12).fill(0), total: 0 }],
    };
    await uploadFile(fakeFile(parsed.file), parsed);
    const s = supersede();
    expect(hasFilter(s, "eq", "name", "Sales Analysis 2026.xlsx")).toBe(true);
    // Not scoped by kind/year for non-invoice files.
    expect(s.filters.some(([o, c]) => o === "eq" && (c === "kind" || c === "year"))).toBe(false);
  });

  it("invoice with no parseable year falls back to same-name replacement", async () => {
    const parsed = {
      file: "Customer Invoice Listing misc.xlsx",
      kind: "invoice",
      sp: null,
      year: null, // no year derivable → can't scope by year
      rowCount: 1,
      rows: [{ date: null, invoice: "INV-Z", amount: 3, sp: "Simon" }],
    };
    await uploadFile(fakeFile(parsed.file), parsed);
    const s = supersede();
    expect(hasFilter(s, "eq", "name", "Customer Invoice Listing misc.xlsx")).toBe(true);
    expect(s.filters.some(([o, c]) => o === "eq" && c === "kind")).toBe(false);
  });
});
