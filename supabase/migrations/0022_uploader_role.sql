-- 0022: "uploader" permission — upload / update data files without being admin.
--
-- warehouse@ and cs@seed-malaysia.com need the Data ⤴ tab (upload, replace,
-- delete workbooks and rebuild the fact tables from them), but NOT admin: no
-- Users panel, no HQ Report, no push / rep contacts. A new sp_user_map flag,
-- can_upload, drives a helper current_user_can_upload() (admin OR can_upload),
-- and every file / fact-table write rule that used current_user_is_admin() is
-- rewritten to use it. User management stays admin-only.
--
-- Paste into Supabase Studio → SQL editor → Run. Safe to re-run.

-- 1. The flag. Only admins can change sp_user_map rows (existing policies), so
--    nobody can grant it to themselves.
alter table public.sp_user_map
  add column if not exists can_upload boolean not null default false;

-- 2. Helper. Unknown / unmapped user → false (fail closed).
create or replace function public.current_user_can_upload()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin or can_upload from public.sp_user_map where user_id = auth.uid()),
    false
  );
$$;
revoke all on function public.current_user_can_upload() from public, anon;
grant execute on function public.current_user_can_upload() to authenticated;

-- 3. Row-level rules: data_files, the data-files storage bucket and the fact
--    tables the upload sync writes. Each policy that checks admin is recreated
--    with the same command / roles / expressions, admin check swapped.
do $$
declare
  p record;
  q text;
  c text;
  stmt text;
begin
  for p in
    select * from pg_policies
    where (
        (schemaname = 'public' and tablename in
          ('data_files', 'customers_data', 'brand_sales_data', 'weekly_sales', 'product_monthly_sales'))
        or (schemaname = 'storage' and tablename = 'objects' and policyname like 'data\_files\_objects%')
      )
      and (coalesce(qual, '') like '%current_user_is_admin()%'
           or coalesce(with_check, '') like '%current_user_is_admin()%')
  loop
    q := replace(p.qual, 'current_user_is_admin()', 'current_user_can_upload()');
    c := replace(p.with_check, 'current_user_is_admin()', 'current_user_can_upload()');
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    stmt := format('create policy %I on %I.%I as %s for %s to %s',
      p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd,
      array_to_string(array(select quote_ident(r) from unnest(p.roles) r), ', '));
    if q is not null then stmt := stmt || format(' using (%s)', q); end if;
    if c is not null then stmt := stmt || format(' with check (%s)', c); end if;
    execute stmt;
    raise notice 'policy % on %.% → uploaders', p.policyname, p.schemaname, p.tablename;
  end loop;
end $$;

-- 4. The "replace facts" functions the sync calls check admin inside their
--    body. Rewrite just that check, keeping each function's current body.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('replace_customers_data', 'replace_brand_sales_data', 'replace_product_monthly_sales')
  loop
    def := pg_get_functiondef(f.oid);
    if position('current_user_is_admin()' in def) > 0 then
      execute replace(def, 'current_user_is_admin()', 'current_user_can_upload()');
      raise notice 'function % → uploaders', f.proname;
    end if;
  end loop;
end $$;

-- 5. Grant the two accounts. If one isn't listed in the notices, create it in
--    the Users tab first (any salesperson, not admin), then run just this block.
update public.sp_user_map m
   set can_upload = true
  from auth.users u
 where u.id = m.user_id
   and lower(u.email) in ('warehouse@seed-malaysia.com', 'cs@seed-malaysia.com');

select u.email, m.sp, m.is_admin, m.can_upload
  from public.sp_user_map m join auth.users u on u.id = m.user_id
 where m.is_admin or m.can_upload
 order by m.is_admin desc, u.email;
