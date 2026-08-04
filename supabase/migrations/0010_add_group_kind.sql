-- 0010_add_group_kind.sql
--
-- Allow 'group' as a fourth data_files.kind so admins can upload the
-- "Stock Sales Analysis - Summary <year>.xlsx" customer × Stock-Group cross-tab
-- through the Data tab, feeding the Product Group Performance and Customer ×
-- Group views. Like 'invoice', everything else (RLS, storage policies,
-- visibility, allowed_sps) treats kind as opaque — only the CHECK constraint
-- needs widening.

alter table public.data_files
  drop constraint if exists data_files_kind_check;

alter table public.data_files
  add constraint data_files_kind_check
  check (kind in ('customer', 'brand', 'invoice', 'group'));

comment on column public.data_files.kind is
  'Which parser produced the rows_json: '
  '''customer'' = yearly Sales Analysis by customer, '
  '''brand'' = yearly Stock Sales Analysis - Summary by Brand, '
  '''invoice'' = monthly Customer Invoice Listing (per-invoice detail), '
  '''group'' = yearly Stock Sales Analysis - Summary (customer × Stock-Group).';
