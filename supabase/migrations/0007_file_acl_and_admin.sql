-- Admin/user login controls + backend-enforced file access.
--
-- Supersedes 0005_disable_auth_temporary.sql, which left every table world-
-- readable AND world-writable via the public anon key. Apply this in
-- Supabase Studio -> SQL Editor. Idempotent: safe to re-run.
--
-- What this does:
--   1. Re-enables RLS on every data table (closes the anonymous hole).
--   2. Adds public.data_files: uploaded workbooks live in the backend, with
--      a per-file visibility flag the admin controls.
--   3. Creates the private 'data-files' storage bucket + policies that mirror
--      the data_files visibility rules, so a user cannot fetch the raw .xlsx
--      of a file they are not allowed to see.
--   4. Lets admins manage the user roster (sp, managed_sps, is_admin).
--   5. Sets seedclmalaysia2@gmail.com as the sole admin.

-- ============================================================
-- 1. Close the hole: RLS back on everywhere
-- ============================================================
alter table public.customers_data    enable row level security;
alter table public.brand_sales_data  enable row level security;
alter table public.sales_targets     enable row level security;
alter table public.weekly_sales      enable row level security;
alter table public.sp_user_map       enable row level security;

-- customers_data / brand_sales_data / sales_targets have SELECT policies only
-- (see 0001-0003). With RLS on and no INSERT/UPDATE/DELETE policy, writes are
-- denied for anon + authenticated; the seed scripts still work because the
-- service_role key bypasses RLS. That is intentional.

-- ============================================================
-- 2. Uploaded workbook registry
-- ============================================================
create table if not exists public.data_files (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  kind         text        not null check (kind in ('customer', 'brand')),
  sp           text,
  year         int,
  row_count    int         not null default 0,
  size_bytes   bigint      not null default 0,
  storage_path text        not null unique,
  visibility   text        not null default 'private'
                 check (visibility in ('private', 'sp', 'shared')),
  allowed_sps  text[]      not null default '{}',
  rows_json    jsonb,
  uploaded_by  uuid        references auth.users(id) on delete set null,
  uploaded_at  timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.data_files is
  'Workbooks uploaded through the dashboard Data tab. Stored server-side so the admin controls who may see each one.';
comment on column public.data_files.visibility is
  'private = admins only (default). sp = visible to the reps listed in allowed_sps. shared = every signed-in user.';
comment on column public.data_files.rows_json is
  'Parsed rows, so the dashboard can rebuild aggregates without downloading the xlsx. Gated by the same RLS as the file itself.';

create index if not exists data_files_visibility_idx on public.data_files (visibility);
create index if not exists data_files_deleted_at_idx on public.data_files (deleted_at);
create index if not exists data_files_allowed_sps_idx on public.data_files using gin (allowed_sps);

alter table public.data_files enable row level security;

-- Read: admins see everything (including trash). Everyone else sees only
-- live files that are explicitly shared, or scoped to an sp they can see.
-- An unmapped user gets NULL from current_user_visible_sps() -> no match ->
-- no rows. Fail closed.
drop policy if exists data_files_read on public.data_files;
create policy data_files_read on public.data_files
  for select using (
    public.current_user_is_admin()
    or (
      deleted_at is null
      and (
        visibility = 'shared'
        or (visibility = 'sp' and allowed_sps && public.current_user_visible_sps())
      )
    )
  );

-- Writes: admins only.
drop policy if exists data_files_admin_insert on public.data_files;
create policy data_files_admin_insert on public.data_files
  for insert with check (public.current_user_is_admin());

drop policy if exists data_files_admin_update on public.data_files;
create policy data_files_admin_update on public.data_files
  for update using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists data_files_admin_delete on public.data_files;
create policy data_files_admin_delete on public.data_files
  for delete using (public.current_user_is_admin());

-- ============================================================
-- 3. Private storage bucket for the raw .xlsx bytes
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'data-files',
  'data-files',
  false,
  52428800, -- 50 MB
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading an object requires a matching visible row in data_files, so the
-- bucket cannot be used to sidestep the table's rules.
drop policy if exists data_files_objects_read on storage.objects;
create policy data_files_objects_read on storage.objects
  for select using (
    bucket_id = 'data-files'
    and (
      public.current_user_is_admin()
      or exists (
        select 1 from public.data_files f
        where f.storage_path = storage.objects.name
          and f.deleted_at is null
          and (
            f.visibility = 'shared'
            or (f.visibility = 'sp' and f.allowed_sps && public.current_user_visible_sps())
          )
      )
    )
  );

drop policy if exists data_files_objects_admin_insert on storage.objects;
create policy data_files_objects_admin_insert on storage.objects
  for insert with check (
    bucket_id = 'data-files' and public.current_user_is_admin()
  );

drop policy if exists data_files_objects_admin_update on storage.objects;
create policy data_files_objects_admin_update on storage.objects
  for update using (bucket_id = 'data-files' and public.current_user_is_admin())
  with check (bucket_id = 'data-files' and public.current_user_is_admin());

drop policy if exists data_files_objects_admin_delete on storage.objects;
create policy data_files_objects_admin_delete on storage.objects
  for delete using (
    bucket_id = 'data-files' and public.current_user_is_admin()
  );

-- ============================================================
-- 4. Admin-managed user roster
-- ============================================================
-- 0001 created a SELECT policy (self-or-admin). Admins also need to write, so
-- the Users panel can change sp / managed_sps / is_admin.
drop policy if exists sp_user_map_admin_insert on public.sp_user_map;
create policy sp_user_map_admin_insert on public.sp_user_map
  for insert with check (public.current_user_is_admin());

drop policy if exists sp_user_map_admin_update on public.sp_user_map;
create policy sp_user_map_admin_update on public.sp_user_map
  for update using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists sp_user_map_admin_delete on public.sp_user_map;
create policy sp_user_map_admin_delete on public.sp_user_map
  for delete using (public.current_user_is_admin());

-- Guard: never let the last admin be demoted or deleted. Without this, one
-- careless toggle in the Users panel locks everybody out of the controls
-- permanently, recoverable only with the service_role key.
create or replace function public.guard_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  remaining int;
begin
  if tg_op = 'DELETE' then
    if not old.is_admin then return old; end if;
  else
    -- Only care when an admin is losing the flag.
    if not (old.is_admin and not new.is_admin) then return new; end if;
  end if;

  select count(*) into remaining
  from public.sp_user_map
  where is_admin and user_id <> old.user_id;

  if remaining = 0 then
    raise exception 'Refusing to remove the last admin (%). Promote another user first.', old.user_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sp_user_map_guard_last_admin on public.sp_user_map;
create trigger sp_user_map_guard_last_admin
  before update or delete on public.sp_user_map
  for each row execute function public.guard_last_admin();

-- auth.users is not reachable through PostgREST, so the Users panel needs a
-- definer function to put an email next to each mapping row. The admin check is
-- inside the function body: a non-admin caller gets zero rows, not an error, so
-- there is no way to enumerate the roster by calling it directly.
create or replace function public.admin_list_users()
returns table (
  user_id         uuid,
  email           text,
  sp              text,
  is_admin        boolean,
  managed_sps     text[],
  last_sign_in_at timestamptz
)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.sp, m.is_admin, m.managed_sps, u.last_sign_in_at
  from public.sp_user_map m
  join auth.users u on u.id = m.user_id
  where public.current_user_is_admin()
  order by m.is_admin desc, m.sp
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- ============================================================
-- 6. Admin roster: seedclmalaysia2@gmail.com is the sole admin
-- ============================================================
-- Promote first, then demote, so the guard above always sees a live admin.
update public.sp_user_map m
   set is_admin = true
  from auth.users u
 where u.id = m.user_id
   and lower(u.email) = 'seedclmalaysia2@gmail.com';

update public.sp_user_map m
   set is_admin = false
  from auth.users u
 where u.id = m.user_id
   and lower(u.email) <> 'seedclmalaysia2@gmail.com'
   and m.is_admin;

-- Sanity check: fail loudly rather than leaving the dashboard unadministrable.
do $$
declare
  n int;
begin
  select count(*) into n from public.sp_user_map where is_admin;
  if n <> 1 then
    raise exception 'Expected exactly 1 admin after migration, found %. Is seedclmalaysia2@gmail.com seeded in sp_user_map?', n;
  end if;
end $$;
