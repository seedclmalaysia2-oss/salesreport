-- Web Push subscriptions — one row per browser/device a user has enabled
-- weekly-sales alerts on. The serverless sender (api/send-push.js) reads these
-- with the service_role key and pushes to each endpoint.
--
-- Apply in Supabase Studio -> SQL Editor. Idempotent.

create table if not exists public.push_subscriptions (
  id           bigint generated always as identity primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  endpoint     text        not null unique,
  subscription jsonb       not null,   -- the full PushSubscription.toJSON() (keys, endpoint)
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- A user manages only their own device subscriptions.
drop policy if exists push_own_select on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_own_insert on public.push_subscriptions;
create policy push_own_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists push_own_update on public.push_subscriptions;
create policy push_own_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_delete on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- Admins may read the roster of subscriptions (e.g. "who has alerts on"). The
-- SENDER does not rely on this — it uses the service_role key, which bypasses
-- RLS — but it lets the admin UI show a subscriber count.
drop policy if exists push_admin_select on public.push_subscriptions;
create policy push_admin_select on public.push_subscriptions
  for select using (public.current_user_is_admin());
