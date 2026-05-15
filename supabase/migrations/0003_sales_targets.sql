-- Per-(year, month, sp) sales targets. sp = '_TEAM' for the team total target,
-- or any salesperson name for an individual target.

create table if not exists public.sales_targets (
  id          bigserial primary key,
  year        int     not null,
  month       int     not null check (month between 1 and 12),
  sp          text    not null,
  target_amt  numeric not null check (target_amt >= 0),
  unique (year, month, sp)
);

create index if not exists sales_targets_year_idx on public.sales_targets (year);
create index if not exists sales_targets_sp_idx   on public.sales_targets (sp);

alter table public.sales_targets enable row level security;

drop policy if exists sales_targets_read_scoped on public.sales_targets;
create policy sales_targets_read_scoped on public.sales_targets
  for select using (
    public.current_user_is_admin()
    or sp = '_TEAM'
    or sp = any(public.current_user_visible_sps())
  );
