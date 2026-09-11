-- 0017_tighten_function_grants_and_passwords.sql
--
-- Two follow-ups to 0014 and 0015, plus one optional policy change left
-- commented out at the bottom because it is a product decision, not a defect.
--
-- ---------------------------------------------------------------------------
-- 1. Take EXECUTE away from `anon` on every function in public.
-- ---------------------------------------------------------------------------
-- 0014 granted EXECUTE on every function in `public` to BOTH `authenticated`
-- and `anon`, in a loop over pg_proc — so it also covered the four
-- auth.users-mutating RPCs that 0015 added afterwards: admin_create_user,
-- admin_update_user_email, admin_reset_user_password, admin_delete_user.
--
-- Nothing is exploitable today. Each of those starts with
--   if not public.current_user_is_admin() then raise exception ...
-- and current_user_is_admin() is false for `anon` (no auth.uid()), so an
-- unauthenticated POST to /rest/v1/rpc/admin_delete_user raises rather than
-- deletes. What 0014 removed is the second line of defence: the grant layer.
-- Any SECURITY DEFINER function added to `public` from now on is exposed to
-- anon by default unless its author remembers the guard, and an auditor
-- reading grants alone sees "anon may call admin_delete_user".
--
-- Nothing in this app calls an RPC before sign-in — RLS policies invoke the
-- helpers as the calling role, which for every real user is `authenticated`.
-- So `anon` needs EXECUTE on nothing.
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon',
                   fn.nspname, fn.proname, fn.args);
    execute format('grant execute on function %I.%I(%s) to authenticated',
                   fn.nspname, fn.proname, fn.args);
  end loop;
end $$;

-- Make the default for functions created from here on match, so the next
-- migration does not have to remember.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant  execute on functions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. One password floor: 8 characters everywhere.
-- ---------------------------------------------------------------------------
-- LoginScreen's self-service reset requires 8 (src/LoginScreen.jsx:58), but
-- admin_create_user and admin_reset_user_password accept 6 — so an
-- admin-created account can be weaker than one the user sets for themselves.
-- The database function is the real gate (the client-side check is bypassable
-- by calling the RPC directly with the anon key), so it is raised here as well
-- as in the UI.
--
-- These two definitions are 0015's, byte-for-byte, with only the `< 6` check
-- and its message changed. Nothing else about the functions moves.

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
  if p_password is null or length(p_password) < 8 then
    raise exception 'admin_create_user: password must be at least 8 characters';
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
  if p_password is null or length(p_password) < 8 then
    raise exception 'admin_reset_user_password: password must be at least 8 characters';
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

-- Re-assert the narrowed grants for the two functions just replaced (CREATE OR
-- REPLACE resets them to the default privileges set above).
revoke all on function public.admin_create_user(text, text, text, boolean, boolean) from public, anon;
grant execute on function public.admin_create_user(text, text, text, boolean, boolean) to authenticated;
revoke all on function public.admin_reset_user_password(uuid, text) from public, anon;
grant execute on function public.admin_reset_user_password(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. OPTIONAL — decide before running this part.
-- ---------------------------------------------------------------------------
-- 0016 deliberately makes kind='group' rows readable by every signed-in user so
-- the whole team gets the Product-Group views. The side effect is that the Users
-- panel's "Own only" setting does not cover those views: a rep restricted to
-- their own rows can still read every rep's customer-level revenue by stock
-- group — more revealing than the weekly-totals board 0016 compares itself to.
--
-- The Users-panel copy has been corrected to say so, so the promise and the
-- behaviour now match. If you would rather the restriction actually hold, and
-- accept that restricted users lose the Group views entirely, uncomment this:
--
-- drop policy if exists data_files_group_read on public.data_files;
-- create policy data_files_group_read on public.data_files
--   for select
--   using (
--     public.current_user_can_view_all()
--     and kind = 'group'
--     and deleted_at is null
--   );
