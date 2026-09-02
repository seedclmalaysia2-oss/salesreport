-- 0015_admin_user_management.sql
--
-- SECURITY DEFINER RPCs so admins can add/edit/delete users from the Users
-- tab without exposing the service_role key to the browser. Each function
-- checks current_user_is_admin() first — a non-admin gets a raised exception,
-- not a silent 403. Every write hits auth.users directly (SECURITY DEFINER
-- runs as the function owner, so the auth.* grants held by postgres apply).
--
-- Idempotent — CREATE OR REPLACE means re-running is safe.

-- ------------------------------------------------------------
-- 1. Create a new user (auth.users + auth.identities + sp_user_map)
-- ------------------------------------------------------------
create or replace function public.admin_create_user(
  p_email        text,
  p_password     text,
  p_sp           text,
  p_is_admin     boolean default false,
  p_can_view_all boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid;
  v_email   text := lower(trim(p_email));
begin
  if not public.current_user_is_admin() then
    raise exception 'admin_create_user: caller is not an admin';
  end if;
  if v_email = '' or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'admin_create_user: invalid email address';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'admin_create_user: password must be at least 6 characters';
  end if;
  if p_sp is null or trim(p_sp) = '' then
    raise exception 'admin_create_user: sp is required';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'admin_create_user: an account with email % already exists', v_email;
  end if;

  v_user_id := gen_random_uuid();

  -- Minimum viable auth.users row for a Supabase email/password user.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    crypt(p_password, gen_salt('bf')),
    now(), -- auto-confirm — admin-added accounts don't need email verification
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now(),
    '', '', '', ''
  );

  -- Matching identity row so Supabase auth recognises the email provider.
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    'email',
    now(), now(), now()
  );

  -- App-level mapping.
  insert into public.sp_user_map (user_id, sp, is_admin, can_view_all, managed_sps)
  values (v_user_id, trim(p_sp), coalesce(p_is_admin, false), coalesce(p_can_view_all, true), '{}'::text[]);

  return v_user_id;
end;
$$;

grant execute on function public.admin_create_user(text, text, text, boolean, boolean) to authenticated;

-- ------------------------------------------------------------
-- 2. Update a user's email (auth.users + auth.identities.identity_data.email)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 3. Reset a user's password
-- ------------------------------------------------------------
create or replace function public.admin_reset_user_password(
  p_user_id  uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'admin_reset_user_password: caller is not an admin';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'admin_reset_user_password: password must be at least 6 characters';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'admin_reset_user_password: user not found';
  end if;

  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         updated_at         = now()
   where id = p_user_id;
end;
$$;

grant execute on function public.admin_reset_user_password(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 4. Delete a user (cascades to sp_user_map via FK; last-admin guard
--    on sp_user_map already blocks deleting the sole admin)
-- ------------------------------------------------------------
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
