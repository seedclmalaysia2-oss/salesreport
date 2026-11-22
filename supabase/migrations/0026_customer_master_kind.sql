-- 0026_customer_master_kind.sql
--
-- Allow 'master' as a data_files.kind so admins can upload the customer master
-- list ("Customer Data <year>.xlsx": one row per account with its type, town,
-- state, salesman and create date) through the Data tab. It feeds the Customer
-- Analysis tab only. Like 'invoice' and 'group', everything else (RLS, storage
-- policies, visibility, allowed_sps) treats kind as opaque, so only the CHECK
-- constraint needs widening.
--
-- Visibility follows the usual rule: a new upload is Private (admins only).
-- Set it to "Everyone" on the Data tab for reps to see the Customer Analysis tab.

alter table public.data_files
  drop constraint if exists data_files_kind_check;

alter table public.data_files
  add constraint data_files_kind_check
  check (kind in ('customer', 'brand', 'invoice', 'group', 'master'));

comment on column public.data_files.kind is
  'Which parser produced the rows_json: '
  '''customer'' = yearly Sales Analysis by customer, '
  '''brand'' = yearly Stock Sales Analysis - Summary by Brand, '
  '''invoice'' = monthly Customer Invoice Listing (per-invoice detail), '
  '''group'' = yearly Stock Sales Analysis - Summary (customer × Stock-Group), '
  '''master'' = Customer Data list (account type, area, salesman, create date).';
