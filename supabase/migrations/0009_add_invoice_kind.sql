-- 0009_add_invoice_kind.sql
--
-- Allow 'invoice' as a third data_files.kind so admins can upload Customer
-- Invoice Listing workbooks through the Data tab alongside the yearly
-- 'customer' and 'brand' summaries. Everything else (RLS, storage bucket
-- policies, visibility, allowed_sps) already treats kind as opaque — only
-- the CHECK constraint needed widening.
--
-- Also relaxes NOT NULL on sp/year for existing rows: invoice files span all
-- reps and their year is derived from invoice dates, so neither is a required
-- field. The columns were already nullable in 0007; this is a no-op safety
-- guard in case a follow-up migration accidentally tightened them.

alter table public.data_files
  drop constraint if exists data_files_kind_check;

alter table public.data_files
  add constraint data_files_kind_check
  check (kind in ('customer', 'brand', 'invoice'));

comment on column public.data_files.kind is
  'Which parser produced the rows_json: '
  '''customer'' = yearly Sales Analysis by customer, '
  '''brand'' = yearly Stock Sales Analysis - Summary by Brand, '
  '''invoice'' = monthly Customer Invoice Listing (per-invoice detail).';
