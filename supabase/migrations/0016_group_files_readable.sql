-- 0016_group_files_readable.sql
--
-- Let the sales team use the "View by Product Group" views, not just the admin.
--
-- The Product Group cross-tab lives as a data_files row with kind = 'group';
-- the Brand Performance / Customer×Group views read its parsed rows_json
-- straight from data_files (App.jsx). data_files is otherwise admin-only, so
-- non-admins received no group rows — which left the Group views empty AND hid
-- the "View by Brand / Product Group" toggle entirely (it only renders once
-- group data is present). So a rep was stuck on Brand with no way to switch.
--
-- Add a permissive SELECT policy so any signed-in user can read the group
-- cross-tab rows — the same shared-board model as public.weekly_sales. This is
-- additive: the existing admin-only policy still governs every other kind
-- (customer / brand / invoice), and the storage-bucket bytes stay admin-only
-- (storage.objects policy unchanged), so non-admins can read the parsed group
-- numbers but cannot download the workbook itself.
--
-- Note: the group cross-tab is a whole-company aggregate (customer × sp ×
-- group), so this makes it visible to every signed-in user regardless of their
-- can_view_all scope — intended, since the whole point is to share these views
-- with the team. To instead limit it to unrestricted viewers, replace the
-- `auth.uid() is not null` line with `public.current_user_can_view_all()`.

drop policy if exists data_files_group_read on public.data_files;
create policy data_files_group_read on public.data_files
  for select
  using (
    auth.uid() is not null
    and kind = 'group'
    and deleted_at is null
  );
