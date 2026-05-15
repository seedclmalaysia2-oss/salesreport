-- Re-enable RLS on the data tables. Run this when you're done with the
-- mid-update period and want login + per-rep scoping back on.

alter table public.customers_data    enable row level security;
alter table public.brand_sales_data  enable row level security;
alter table public.sales_targets     enable row level security;
alter table public.weekly_sales      enable row level security;
alter table public.sp_user_map       enable row level security;
