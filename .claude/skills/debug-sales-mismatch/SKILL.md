---
name: debug-sales-mismatch
description: Debug when the Sales Dashboard total (weekly board "SEED Malaysia Total", or the Targets tab "Monthly Achievement" ACTUAL) does NOT match the owner's Autocount "Sales Analysis by Customer" figure for a month. Use when the user says the dashboard is "mismatch", "not updating", cites an "actual RM …" number, or the headline total is off by a round amount (often RM 100–300).
---

# Debug a Sales Dashboard total mismatch

The dashboard surfaces the **same month** three ways, and they can disagree:

| View | Source table | Notes |
|---|---|---|
| Weekly board "SEED Malaysia (Total)" | `weekly_sales` (invoice / Stock-Detail) **reconciled** to `customers_data` | Current month ties to Sales Analysis when it's caught up (`WeeklySalesCard.jsx` `custAdjByRep`) |
| Targets tab "Monthly Achievement" ACTUAL | `customers_data` (Sales Analysis) | sums `data.summary` months |
| The owner's "actual" | Their Autocount **Sales Analysis by Customer** report | This is the source of truth they compare against |

`customers_data` = the **Sales Analysis** (customer report, the owner's truth). `weekly_sales` = the **invoice board** (Stock-Detail). The reconciliation makes the weekly board tie out to `customers_data`.

## The #1 cause: phantom salesman buckets double-counting a customer

When a customer's **Salesman cell is blank** in an export, the parser buckets it under a non-rep scope (`"All"` via the year-only file's `f.sp`, or `"Unassigned"`). When the owner later **fills in the salesman** and re-uploads, the customer moves to a real rep — **but the customer sync replaces data per `(sp, year)` and never clears the abandoned scope** (`src/lib/weekly.js` → `replace_customers_data`). The old ghost row lingers in `customers_data`, so the customer is counted **twice**: once under the real rep, once under the ghost bucket. Each ghost = a round over-count (e.g. RM 100).

`isAggScope` (`src/App.jsx`) strips only `sp="All"` from the main summary; a concurrent approach (`custUnassigned`, commits `05af8c4`/`f48d33e`) then re-adds those as an "Unassigned" line so the month ties to the *full* Sales Analysis total — i.e. the code treats unassigned sales as REAL and counts them. That is right for a genuinely blank-salesman customer, but it also counts a GHOST (a customer that's really assigned to a rep but has a stale non-rep row), which is the bug here. The reliable fix is to delete the ghost rows (below). A customer that moved between two REAL reps across uploads double-counts the same way and isn't caught by any scope filter — same root cause, same cleanup.

## How to debug (query the source tables directly)

Open the deployed dashboard in a browser signed in as an admin, then run this in the page console (`javascript_tool`). It captures the app's own Supabase auth and **computes totals in-page** — never return the apikey/token to your context (the tool blocks credential-looking output; aggregate first):

```js
// 1) capture the app's apikey from a live request, then query. The publishable
//    key alone is rejected; you need apikey + the session Bearer the app uses.
window.__cap=window.__cap||{};const of=window.fetch;window.fetch=function(u,o){try{const url=typeof u==='string'?u:u.url;if(url&&url.includes('supabase.co/rest')){const h=(o&&o.headers)||{};const g=k=>h.get?h.get(k):h[k];window.__cap.apikey=g('apikey')||window.__cap.apikey;window.__cap.auth=g('Authorization')||g('authorization')||window.__cap.auth;}}catch(e){}return of.apply(this,arguments)};'patched — now trigger a read (switch a Year pill) then run the aggregate'
```

```js
// 2) aggregate November(=month index 10) per rep from BOTH tables. Returns NUMBERS only.
const C=window.__cap, base="https://fgqiwitiqwftvfhkchpt.supabase.co/rest/v1", H={apikey:C.apikey,Authorization:C.auth};
async function all(p){let o=[],k=0;for(;;){const r=await fetch(`${base}/${p}&offset=${k}&limit=1000`,{headers:H});if(!r.ok)return{err:r.status};const j=await r.json();o.push(...j);if(j.length<1000)break;k+=1000;}return o;}
const M=10; // November; Jan=0
const cust=await all("customers_data?select=sp,customer,months&year=eq.2026");
const rd=n=>Math.round(n*100)/100, saBySp={}; let saG=0;
for(const r of cust){const sp=r.sp||'(blank)',v=Array.isArray(r.months)?+r.months[M]||0:0;if(v){saBySp[sp]=rd((saBySp[sp]||0)+v);saG+=v;}}
const wk=await all("weekly_sales?select=sp,amount&period_start=gte.2026-11-01&period_start=lte.2026-11-30");
const wkBySp={}; let wkG=0; for(const r of wk){const sp=r.sp||'(blank)';wkBySp[sp]=rd((wkBySp[sp]||0)+ +r.amount);wkG+=+r.amount;}
return JSON.stringify({SA_grand:rd(saG),SA_bySp:saBySp,board_grand:rd(wkG),board_bySp:wkBySp},null,1)
```

Then interpret:
- **Named-rep total** (exclude `All`/`Unassigned`/`NA`/blank) should equal the owner's "actual".
- Any `All`/`Unassigned`/blank bucket = a **phantom**; note the amount.
- Find the double-counted customer: `customers_data?select=sp,customer,months&year=eq.2026&sp=in.(All,Unassigned)` — the same `customer` name appearing under a phantom AND a real rep is the ghost.
- Confirm which files carry which attribution: query `data_files?select=name,uploaded_at,rows_json&kind=eq.customer&year=eq.2026&deleted_at=is.null` and scan `rows_json` for that customer's `sp`. The newest file usually has the corrected salesman; older overlapping files carry the stale one.

To find the anon/publishable key if needed: it's baked into the index JS bundle as `sb_publishable_…` (fetch the `script[src]` that contains `index` and regex for it).

## Fixes

1. **Immediate data cleanup (owner runs in Supabase Studio — RLS blocks client deletes).** Delete only a non-rep row whose customer ALSO exists under a real rep that year (= a true ghost duplicate), so genuinely-unassigned sales are preserved:
   ```sql
   -- preview first
   select d.sp, d.customer, d.year from customers_data d
   where lower(trim(coalesce(d.sp,''))) in ('all','unassigned','na','n/a','')
     and exists (select 1 from customers_data r
       where r.year=d.year and r.customer=d.customer
         and lower(trim(coalesce(r.sp,''))) not in ('all','unassigned','na','n/a',''));
   -- then swap "select …" for "delete" (same WHERE) to remove them.
   ```
   Then the headline matches the named-rep total. A plain "Recalculate" does NOT clear ghosts — the per-(sp,year) replace only touches scopes present in the current file.

2. **Permanent fix — DONE (commit `01ee984`, needs its migration applied once):** `syncCustomersFromFiles` (`src/lib/weekly.js`) now groups customer files **by year** and calls `replace_customers_year(p_year, p_rows)` (migration `supabase/migrations/0025_replace_customers_year.sql`), which DELETEs the whole year then re-inserts the merged rows (each keeping its own sp). Because the year file is authoritative for the whole year's attribution, a salesman change can't leave a ghost — so after the migration is applied and a Recalculate runs, this stops recurring and the one-time cleanup SQL is no longer needed. The migration is MANUAL: paste `0025` into Supabase Studio (see [[project_supabase_migrations_manual]]). Empty-payload guard keeps a zero-row sync from wiping a year; blank sp coalesces to "Unassigned" so no sale is dropped. Still compatible with the `custUnassigned` reconciliation (blank-salesman customers remain under "Unassigned").

## Tidying the customer file library (and why restores churn)

The owner uploads a customer export most days, so `data_files` accumulates dozens of superseded `… Sales Analysis by customer DDMMYYYY.xlsx` copies. With the year-replace sync this is NOT a correctness problem (the newest-per-month merge ignores the extras), but it clutters the library, and a bulk "restore all from trash" resurrects the whole pile. The exports are a MIX of coverage: some are cumulative (`31082026` = Jan–Aug), some single-month (`30092026` = Sep only, `31102026` = Oct only, the daily Nov files = Nov only) — so you can NOT just keep the newest file; you must keep the newest file that WINS each month.

**Never trash by name/date alone — compute the keep-set from each file's actual month coverage** (`rows_json`), mirroring `mergeMonthlyRowsByMonth`: per year, sort live files newest-first by `uploaded_at`; for each month 0–11 the winner is the first (newest) file with a non-zero value in that month; keep = the union of winners. In-page (after capturing the apikey as above):

```js
const files=await fetch(`${base}/data_files?select=id,name,year,uploaded_at,deleted_at,rows_json&kind=eq.customer&order=uploaded_at.asc`,{headers:H}).then(r=>r.json());
const info=files.map(f=>{const rows=f.rows_json||[];const mh=new Array(12).fill(false);for(const r of rows){const m=r.months||[];for(let i=0;i<12;i++)if(Number(m[i]))mh[i]=true;}return {id:f.id,year:f.year,up:f.uploaded_at,live:!f.deleted_at,cov:mh.flatMap((v,i)=>v?[i]:[])};});
const keep=new Set();
for(const y of [...new Set(info.filter(f=>f.live).map(f=>f.year))]){const live=info.filter(f=>f.live&&f.year===y).sort((a,b)=>new Date(b.up)-new Date(a.up));for(let m=0;m<12;m++){const w=live.find(f=>f.cov.includes(m));if(w)keep.add(w.id);}}
// VERIFY per year that the union of kept files' cov includes every month that has data, THEN build the purge list.
```

Verify the union covers every month before deleting. Then permanently delete every customer file not in the keep-set, plus all trash (so a future restore can't bring the pile back) — owner runs in Studio:

```sql
delete from data_files
where id not in ( '<keep-id-1>', … )   -- the computed winners (customer files)
  and (kind = 'customer' or deleted_at is not null);
```

No recalc is needed afterward — `customers_data` is already built; the kept files reproduce it exactly on the next recalc. Hard-delete leaves orphaned `.xlsx` blobs in the `data-files` bucket (harmless; the app's own purge removes storage, SQL does not). The real long-term fix is to export the customer report as ONE cumulative full-year file (`01/01 → today`) each time, so a year needs a single authoritative file.

## Reconciliation guard (related, for "number stopped moving")
`WeeklySalesCard.jsx` reconciles the **current** month to `customers_data` only when the Sales Analysis has caught up (`saTotal >= boardTotal * 0.999`); otherwise it shows the live invoice board. Closed months use a ≥50% band. See [[project_weekly_board_dataflow]].
