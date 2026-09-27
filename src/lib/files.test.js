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

describe("uploadFile overwrite rule → same-name re-uploads only", () => {
  it("invoice (Stock-Detail): supersedes only a same-name re-upload", async () => {
    const parsed = {
      file: "Stock Sales Analysis - Detail 31082026.xlsx",
      kind: "invoice",
      sp: null,
      year: 2026,
      rowCount: 2,
      rows: [{ date: "2026-08-01", invoice: "INV-1", amount: 10, sp: "Alan" }],
    };
    await uploadFile(fakeFile(parsed.file), parsed);
    const s = supersede();
    expect(hasFilter(s, "eq", "name", "Stock Sales Analysis - Detail 31082026.xlsx")).toBe(true);
    expect(hasFilter(s, "is", "deleted_at", null)).toBe(true);
    expect(hasFilter(s, "neq", "id", "new-id")).toBe(true);
    expect(s.patch.deleted_at).toBeTruthy();
  });

  it("a split-period invoice file does NOT wipe the earlier period's file", async () => {
    // "… 27092026.xlsx" may hold only September; the 31082026 file (Jan–Aug)
    // must stay live. Consumers merge month by month (periods.js) instead.
    const parsed = {
      file: "Stock Sales Analysis - Detail 27092026.xlsx",
      kind: "invoice", sp: null, year: 2026, rowCount: 1,
      rows: [{ date: "2026-09-11", invoice: "INV-9", amount: 5, sp: "Dino" }],
    };
    await uploadFile(fakeFile(parsed.file), parsed);
    const s = supersede();
    expect(s.filters.some(([o, c]) => o === "eq" && (c === "kind" || c === "year"))).toBe(false);
    expect(hasFilter(s, "eq", "name", "Stock Sales Analysis - Detail 31082026.xlsx")).toBe(false);
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
