-- 0024_sales_contracts.sql
--
-- Storage for the Contracts tab: saved contracts / next-year proposals, and the
-- one contract wording template (clauses) the team edits.
--
-- Contracts hold customer terms (targets and rebate rates), so access matches the
-- Data tab: admins and uploaders only, via current_user_can_upload() (0022).
-- Everyone else, including anon, gets nothing - there are no other policies.
--
-- Paste into Supabase Studio -> SQL editor -> Run. Safe to run twice.

create table if not exists public.sales_contracts (
  id            uuid        primary key default gen_random_uuid(),
  title         text        not null,                                   -- customer or group name
  kind          text        not null check (kind in ('ecp', 'group', 'prospect')),
  base_year     int         not null,                                   -- year the achievement is read from
  contract_year int         not null,                                   -- year the contract covers
  status        text        not null default 'draft' check (status in ('draft', 'final')),
  payload       jsonb       not null,                                   -- everything the editor holds
  created_by    uuid        default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists sales_contracts_updated_idx on public.sales_contracts (updated_at desc);

create table if not exists public.contract_templates (
  key         text        primary key default 'default',
  source_file text,                                                      -- name of the uploaded file, if any
  clauses     jsonb       not null,                                      -- [{ id, title, body }]
  updated_by  uuid        default auth.uid(),
  updated_at  timestamptz not null default now()
);

alter table public.sales_contracts enable row level security;
alter table public.contract_templates enable row level security;

drop policy if exists sales_contracts_uploaders on public.sales_contracts;
create policy sales_contracts_uploaders on public.sales_contracts
  for all to authenticated
  using (public.current_user_can_upload())
  with check (public.current_user_can_upload());

drop policy if exists contract_templates_uploaders on public.contract_templates;
create policy contract_templates_uploaders on public.contract_templates
  for all to authenticated
  using (public.current_user_can_upload())
  with check (public.current_user_can_upload());

revoke all on public.sales_contracts from public, anon;
revoke all on public.contract_templates from public, anon;
grant select, insert, update, delete on public.sales_contracts to authenticated;
grant select, insert, update, delete on public.contract_templates to authenticated;
