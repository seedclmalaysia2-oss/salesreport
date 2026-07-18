-- Close a leftover hole: the team sales targets were world-readable.
--
-- 0003 wrote the sales_targets read policy as
--     current_user_is_admin() or sp = '_TEAM' or sp = any(visible_sps())
-- The middle branch has no auth check, so `sp = '_TEAM'` is true for an
-- anonymous caller too — anyone could read all 48 team-total target rows
-- without logging in. Every other table already requires a session; this one
-- slipped through because '_TEAM' is meant to be shared, but "shared" should
-- mean "shared with signed-in users", not "public".
--
-- Same visibility as before for real users: admins see everything, everyone
-- signed in sees the _TEAM totals, and reps see their own (and managed) SPs.
-- The only change is the `auth.uid() is not null` gate out front.
--
-- Idempotent. Apply in Supabase Studio -> SQL Editor after 0007.

drop policy if exists sales_targets_read_scoped on public.sales_targets;
create policy sales_targets_read_scoped on public.sales_targets
  for select using (
    auth.uid() is not null
    and (
      public.current_user_is_admin()
      or sp = '_TEAM'
      or sp = any(public.current_user_visible_sps())
    )
  );
