// Tests for the Weekly-board data pipeline — the code behind the Data-tab
// "Update" button and the Weekly card's "Refresh" button. The guarantee under
// test: after a file is Updated (a newer upload of the same scope), a recalc
// rebuilds the fact tables from the NEWEST files, with no double-counting, and
// the numbers converge no matter how many times it runs.
//
// Supabase is mocked, so this is pure offline logic: no network, no auth, no DB.
// The mock records every upsert/rpc so we can assert the recalc fires the right
// writes with the right payloads.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared recorder. vi.hoisted so the vi.mock factory (also hoisted) can see it.
const H = vi.hoisted(() => ({
  state: { upserts: [], rpcs: [], upsertError: null, rpcError: null },
}));

vi.mock("./supabase.js", () => ({
  supabase: {
    from: (table) => ({
      upsert: (payload, opts) => {
        H.state.upserts.push({ table, payload, opts });
        return Promise.resolve({ error: H.state.upsertError });
      },
    }),
    rpc: (name, args) => {
      H.state.rpcs.push({ name, args });
      return Promise.resolve({
        data: H.state.rpcError ? null : [{ inserted: (args?.p_rows || []).length }],
        error: H.state.rpcError,
      });
    },
  },
  fetchAll: async () => [],
}));

import {
  weekBounds,
  invoiceRowsToWeekly,
  invoiceFilesFrom,
  dedupeInvoiceUnits,
  syncWeeklyFromFiles,
  syncCustomersFromFiles,
  recalcAllFacts,
} from "./weekly.js";

beforeEach(() => {
  H.state.upserts.length = 0;
  H.state.rpcs.length = 0;
  H.state.upsertError = null;
  H.state.rpcError = null;
});

// ---- Fixtures ---------------------------------------------------------------
// Two invoice files for the same weeks. The "new" one is a later upload of the
// same period — this is exactly what pressing "Update" on the Data tab produces.
// INV-1 is corrected upward (100 -> 150); INV-3 is brand new; INV-4 arrives as
// two lines that must sum within the file before competing across files.
const oldInvoiceFile = {
  id: "old", kind: "invoice", deletedAt: null, uploadedAt: 1000,
  rows: [
    { invoice: "INV-1", date: "2026-07-03", sp: "Alan", amount: 100 },
    { invoice: "INV-2", date: "2026-07-10", sp: "Dino", amount: 200 },
  ],
};
const newInvoiceFile = {
  id: "new", kind: "invoice", deletedAt: null, uploadedAt: 2000,
  rows: [
    { invoice: "INV-1", date: "2026-07-03", sp: "Alan",  amount: 150 },
    { invoice: "INV-2", date: "2026-07-10", sp: "Dino",  amount: 200 },
    { invoice: "INV-3", date: "2026-07-12", sp: "Khen",  amount: 75 },
    { invoice: "INV-4", date: "2026-07-05", sp: "Simon", amount: 30 },
    { invoice: "INV-4", date: "2026-07-05", sp: "Simon", amount: 20 },
  ],
};
const trashedInvoiceFile = {
  id: "trashed", kind: "invoice", deletedAt: 1500, uploadedAt: 1500,
  rows: [{ invoice: "INV-9", date: "2026-07-04", sp: "Alan", amount: 9999 }],
};

// The weekly board after recalc: newest figures, deduped, bucketed into
// calendar weeks, sorted by (period_start, sp).
const EXPECTED_BOARD = [
  { period_start: "2026-07-01", period_end: "2026-07-07", sp: "Alan",  amount: 150 },
  { period_start: "2026-07-01", period_end: "2026-07-07", sp: "Simon", amount: 50 },
  { period_start: "2026-07-08", period_end: "2026-07-14", sp: "Dino",  amount: 200 },
  { period_start: "2026-07-08", period_end: "2026-07-14", sp: "Khen",  amount: 75 },
];

const months12 = (julyValue) => {
  const m = new Array(12).fill(0);
  m[6] = julyValue;
  return m;
};

// ---- Pure bucketing ---------------------------------------------------------
describe("weekBounds — calendar weeks (1-7, 8-14, 15-21, 22-28, 29-end)", () => {
  it("buckets each date into its own month's week, never crossing a boundary", () => {
    expect(weekBounds("2026-07-01")).toEqual({ start: "2026-07-01", end: "2026-07-07" });
    expect(weekBounds("2026-07-08")).toEqual({ start: "2026-07-08", end: "2026-07-14" });
    expect(weekBounds("2026-07-15")).toEqual({ start: "2026-07-15", end: "2026-07-21" });
    expect(weekBounds("2026-07-29")).toEqual({ start: "2026-07-29", end: "2026-07-31" }); // short
    expect(weekBounds("2026-02-28")).toEqual({ start: "2026-02-22", end: "2026-02-28" }); // no wk5
  });
});

describe("invoiceRowsToWeekly", () => {
  it("sums per (week, rep) and drops rows with no date, no rep, or a zero net", () => {
    expect(invoiceRowsToWeekly([
      { date: "2026-07-03", sp: "Alan", amount: 100 },
      { date: "2026-07-05", sp: "Alan", amount: 50 },
      { date: "2026-07-10", sp: "Dino", amount: 200 },
      { date: null,         sp: "Khen", amount: 999 },
      { date: "2026-07-10", sp: null,   amount: 999 },
      { date: "2026-07-03", sp: "Simon", amount: 40 },
      { date: "2026-07-03", sp: "Simon", amount: -40 }, // nets to zero -> dropped
    ])).toEqual([
      { period_start: "2026-07-01", period_end: "2026-07-07", sp: "Alan", amount: 150 },
      { period_start: "2026-07-08", period_end: "2026-07-14", sp: "Dino", amount: 200 },
    ]);
  });
});

describe("invoiceFilesFrom", () => {
  it("keeps only live invoice files that have parsed rows", () => {
    const files = [oldInvoiceFile, newInvoiceFile, trashedInvoiceFile,
      { id: "cust", kind: "customer", deletedAt: null, uploadedAt: 1, rows: [] }];
    expect(invoiceFilesFrom(files).map(f => f.id)).toEqual(["old", "new"]);
  });
});

// ---- The Update-then-Refresh guarantee -------------------------------------
describe("dedupeInvoiceUnits — newest file wins per invoice, no double-count", () => {
  const files = [oldInvoiceFile, newInvoiceFile, trashedInvoiceFile];

  it("produces the corrected board from the newest figures", () => {
    expect(invoiceRowsToWeekly(dedupeInvoiceUnits(files))).toEqual(EXPECTED_BOARD);
  });

  it("uses INV-1's corrected 150, not the stale 100 nor a double-counted 250", () => {
    const board = invoiceRowsToWeekly(dedupeInvoiceUnits(files));
    expect(board.find(r => r.sp === "Alan").amount).toBe(150);
  });

  it("ignores trashed files entirely", () => {
    const board = invoiceRowsToWeekly(dedupeInvoiceUnits(files));
    expect(board.some(r => r.amount === 9999)).toBe(false);
  });

  it("is idempotent — running the recalc again yields the identical board", () => {
    const once = invoiceRowsToWeekly(dedupeInvoiceUnits(files));
    const twice = invoiceRowsToWeekly(dedupeInvoiceUnits(files));
    expect(twice).toEqual(once);
  });
});

// ---- Fact-table sync (Supabase mocked) -------------------------------------
describe("syncWeeklyFromFiles", () => {
  it("upserts the deduped weekly board into weekly_sales on the (period, rep) key", async () => {
    const res = await syncWeeklyFromFiles([oldInvoiceFile, newInvoiceFile]);
    expect(H.state.upserts).toHaveLength(1);
    expect(H.state.upserts[0].table).toBe("weekly_sales");
    expect(H.state.upserts[0].opts).toEqual({ onConflict: "period_start,period_end,sp" });
    expect(H.state.upserts[0].payload).toEqual(EXPECTED_BOARD);
    expect(res).toMatchObject({ rows: 4, weeks: 2 });
  });
});

describe("syncCustomersFromFiles", () => {
  it("replaces only the newest file per (sp, year) and skips empty files", async () => {
    const custFiles = [
      { id: "c1", kind: "customer", sp: "Alan", year: 2026, deletedAt: null, uploadedAt: 1000,
        rows: [{ customer: "A", months: months12(100), total: 100 }] },
      // Newer upload of the same scope — the "Update" case. This one must win.
      { id: "c2", kind: "customer", sp: "Alan", year: 2026, deletedAt: null, uploadedAt: 2000,
        rows: [
          { customer: "A", months: months12(150), total: 150 },
          { customer: "B", months: months12(50),  total: 50 },
        ] },
      { id: "c3", kind: "customer", sp: "Dino", year: 2026, deletedAt: null, uploadedAt: 1500,
        rows: [] }, // empty -> skipped, never wipes the scope
    ];
    const res = await syncCustomersFromFiles(custFiles);

    expect(H.state.rpcs).toHaveLength(1);
    expect(H.state.rpcs[0].name).toBe("replace_customers_data");
    expect(H.state.rpcs[0].args.p_sp).toBe("Alan");
    expect(H.state.rpcs[0].args.p_year).toBe(2026);
    expect(H.state.rpcs[0].args.p_rows).toHaveLength(2); // c2 (newest) won
    expect(res.skipped).toEqual(["Dino 2026 (0 rows)"]);
  });

  it("splits a year-only file by its per-row salesperson (the Salesman column)", async () => {
    // "2026 Sales Analysis by customer.xlsx" is sp="All" at the file level but
    // carries a Salesman column per row. It must fan out into one scope per rep,
    // never a single "All" bucket — the bug that made the per-salesperson
    // customer analysis silently disappear.
    const yearFile = [{
      id: "y1", kind: "customer", sp: "All", year: 2026, deletedAt: null, uploadedAt: 3000,
      rows: [
        { sp: "Alan", customer: "A", months: months12(95), total: 95 },
        { sp: "Dino", customer: "B", months: months12(80), total: 80 },
        { sp: "Alan", customer: "C", months: months12(5),  total: 5 },
        { sp: "Khen", customer: "D", months: months12(72), total: 72 },
      ],
    }];
    const res = await syncCustomersFromFiles(yearFile);
    const bySp = Object.fromEntries(H.state.rpcs.map(c => [c.args.p_sp, c.args.p_rows.length]));
    expect(bySp).toEqual({ Alan: 2, Dino: 1, Khen: 1 });
    expect(H.state.rpcs.every(c => c.args.p_year === 2026)).toBe(true);
    expect(H.state.rpcs.some(c => c.args.p_sp === "All")).toBe(false);
    expect(res.scopes).toBe(3);
  });

  it("surfaces an RPC error instead of silently losing data", async () => {
    H.state.rpcError = { message: "permission denied" };
    await expect(syncCustomersFromFiles([
      { id: "c1", kind: "customer", sp: "Alan", year: 2026, deletedAt: null, uploadedAt: 1,
        rows: [{ customer: "A", months: months12(1), total: 1 }] },
    ])).rejects.toThrow(/permission denied/);
  });
});

describe("recalcAllFacts — one press rebuilds every fact table from the newest files", () => {
  it("fires the customer + brand replace RPCs and the weekly upsert", async () => {
    const files = [
      { id: "cust", kind: "customer", sp: "Alan", year: 2026, deletedAt: null, uploadedAt: 10,
        rows: [{ customer: "A", months: months12(150), total: 150 }] },
      { id: "brand", kind: "brand", sp: "Alan", year: 2026, deletedAt: null, uploadedAt: 10,
        rows: [{ customer: "A", brand: "BrandX", amt: 500, qty: 5 }] },
      oldInvoiceFile,
      newInvoiceFile,
    ];
    const res = await recalcAllFacts(files);

    // Customers first, then brands (recalcAllFacts order).
    expect(H.state.rpcs.map(r => r.name)).toEqual([
      "replace_customers_data",
      "replace_brand_sales_data",
    ]);
    // Weekly board upserted from the deduped invoice files.
    expect(H.state.upserts).toHaveLength(1);
    expect(H.state.upserts[0].payload).toEqual(EXPECTED_BOARD);

    expect(res.customers.scopes).toBe(1);
    expect(res.brands.scopes).toBe(1);
    expect(res.weekly).toMatchObject({ rows: 4, weeks: 2 });
  });

  it("does no weekly upsert when there are no invoice files", async () => {
    await recalcAllFacts([
      { id: "cust", kind: "customer", sp: "Alan", year: 2026, deletedAt: null, uploadedAt: 10,
        rows: [{ customer: "A", months: months12(150), total: 150 }] },
    ]);
    expect(H.state.upserts).toHaveLength(0);
  });
});
