-- Viewer permissions: signed-in users see EVERYONE's sales data by default;
-- admins can restrict an individual user to their own data. Uploaded files stay
-- admin-controlled (unchanged from 0007). Anonymous access stays fully blocked.
--
-- This reverses the earlier default. 0001-0002 scoped every user to their own
-- salesperson; the portal is actually meant to be open to all data once you log
-- in, with restriction as the exception an admin applies per user.
--
--   Anonymous                       -> nothing
--   Signed in, can_view_all = true  -> every salesperson's data  (the default)
--   Signed in, can_view_all = false -> only their own sp (+ managed_sps)
--   Admin                           -> everything, always; also files + roster
--
-- Idempotent. Apply in Supabase Studio -> SQL Editor after 0007. (This replaces
-- the older 0008_targets_require_login.sql; its fix is folded in below.)

-- ============================================================
-- 1. Per-user "may see everyone" flag. Default true = open to all data.
-- ============================================================
alter table public.sp_user_map
  add column if not exists can_view_all boolean not null default true;

comment on column public.sp_user_map.can_view_all is
  'true (default): user sees every salesperson''s data. false: admin has restricted them to their own sp (+ managed_sps). Admins see all regardless of this flag.';

-- ============================================================
-- 2. Helper: does the current user get cross-team visibility?
-- ============================================================
-- Unmapped / anonymous -> false (fail closed). Admin -> always true.
create or replace function public.current_user_can_view_all()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select is_admin or can_view_all from public.sp_user_map where user_id = auth.uid()),
    false
  )
$$;

-- ============================================================
-- 3. Re-scope the data read policies around the flag
-- ============================================================
-- A restricted user still falls back to their own + managed SPs. For anon,
-- can_view_all() is false and visible_sps() is null, so both branches fail and
-- no rows come back.
drop policy if exists customers_data_scoped_read on public.customers_data;
create policy customers_data_scoped_read on public.customers_data
  for select using (
    public.current_user_can_view_all()
    or sp = any(public.current_user_visible_sps())
  );

drop policy if exists brand_sales_data_scoped_read on public.brand_sales_data;
create policy brand_sales_data_scoped_read on public.brand_sales_data
  for select using (
    public.current_user_can_view_all()
    or sp = any(public.current_user_visible_sps())
  );

-- sales_targets also gets the explicit login gate that the old 0008 added, so
-- the _TEAM totals are no longer world-readable.
drop policy if exists sales_targets_read_scoped on public.sales_targets;
create policy sales_targets_read_scoped on public.sales_targets
  for select using (
    auth.uid() is not null
    and (
      public.current_user_can_view_all()
      or sp = '_TEAM'
      or sp = any(public.current_user_visible_sps())
    )
  );

-- ============================================================
-- 4. Surface the flag to the Users panel
-- ============================================================
-- Return signature changes, so drop before recreating.
drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (
  user_id         uuid,
  email           text,
  sp              text,
  is_admin        boolean,
  can_view_all    boolean,
  managed_sps     text[],
  last_sign_in_at timestamptz
)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.sp, m.is_admin, m.can_view_all, m.managed_sps, u.last_sign_in_at
  from public.sp_user_map m
  join auth.users u on u.id = m.user_id
  where public.current_user_is_admin()
  order by m.is_admin desc, m.sp
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- ============================================================
-- 5. Uploaded files are admin-only (tightens 0007)
-- ============================================================
-- 0007 allowed per-file sharing (visibility = shared / sp). The portal's actual
-- rule is simpler: the upload database is for admins only, never shown to
-- regular users. Collapse the read policies to an admin check. The visibility /
-- allowed_sps columns are left in place (harmless, all rows stay 'private') in
-- case granular sharing is wanted later; today nothing reads them.
drop policy if exists data_files_read on public.data_files;
create policy data_files_read on public.data_files
  for select using (public.current_user_is_admin());

drop policy if exists data_files_objects_read on storage.objects;
create policy data_files_objects_read on storage.objects
  for select using (
    bucket_id = 'data-files' and public.current_user_is_admin()
  );
