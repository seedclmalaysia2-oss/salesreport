-- 0018_restore_missing_admin_rpcs.sql
--
-- Found while applying 0017: two of the four RPCs that 0015 defines are not
-- present in the database at all.
--
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname like 'admin_%';
--     -> admin_create_user, admin_list_users        (present)
--     -> admin_update_user_email, admin_delete_user (MISSING)
--
-- src/AdminUsers.jsx calls both of the missing ones (lines 173 and 202), so
-- "Edit email" and "Delete user" in the Users panel fail today with a 404 from
-- PostgREST. 0015 was evidently applied by hand and truncated partway through.
--
-- The two bodies below are 0015's, byte-for-byte. The grants are 0017's
-- narrower form: authenticated only, never anon.
--
-- Run this AFTER 0017.

-- ---------------------------------------------------------------------------
-- Update a user's email (auth.users + auth.identities.identity_data.email)
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_user_email(
  p_user_id uuid,
  p_email   text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if not public.current_user_is_admin() then
    raise exception 'admin_update_user_email: caller is not an admin';
  end if;
  if v_email = '' or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'admin_update_user_email: invalid email address';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'admin_update_user_email: user not found';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id <> p_user_id) then
    raise exception 'admin_update_user_email: email % already belongs to another account', v_email;
  end if;

  update auth.users
     set email              = v_email,
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at         = now()
   where id = p_user_id;

  update auth.identities
     set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_email), true),
         updated_at    = now()
   where user_id = p_user_id and provider = 'email';
end;
$$;

grant execute on function public.admin_update_user_email(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Delete a user (cascades to sp_user_map via FK; the last-admin guard on
-- sp_user_map already blocks deleting the sole admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'admin_delete_user: caller is not an admin';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'admin_delete_user: cannot delete your own account';
  end if;
  -- Delete auth.users; sp_user_map has ON DELETE CASCADE (see 0001_init.sql).
  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function public.admin_delete_user(uuid) to authenticated;

-- Match 0017: no anon, ever.
revoke all on function public.admin_update_user_email(uuid, text) from public, anon;
revoke all on function public.admin_delete_user(uuid)             from public, anon;
grant execute on function public.admin_update_user_email(uuid, text) to authenticated;
grant execute on function public.admin_delete_user(uuid)             to authenticated;
