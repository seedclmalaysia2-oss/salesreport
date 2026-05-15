-- TEMPORARY: disable RLS so the dashboard works without login during the
-- mid-update period. To restore, run 0006_reenable_auth.sql (re-enables RLS).
-- The policies themselves stay defined — only RLS enforcement is suspended.

alter table public.customers_data    disable row level security;
alter table public.brand_sales_data  disable row level security;
alter table public.sales_targets     disable row level security;
alter table public.weekly_sales      disable row level security;
alter table public.sp_user_map       disable row level security;
