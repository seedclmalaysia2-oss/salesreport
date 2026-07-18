# Sales Dashboard — Supabase + Vercel Setup

Step-by-step. Once steps 1–4 are done, the dashboard runs against Supabase with per-salesperson login.

## 1. Create your `.env`

Copy the template and fill in values from **Supabase Studio → Settings → API**:

```
cp .env.example .env
```

You need:
- `VITE_SUPABASE_URL` — `https://fgqiwitiqwftvfhkchpt.supabase.co`
- `VITE_SUPABASE_ANON_KEY` — the **anon / publishable** key (safe to ship to browser)
- `SUPABASE_URL` — same URL (used by Python scripts)
- `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key (NEVER commit; bypasses RLS)

## 2. Apply the schema

Open Supabase Studio → SQL Editor → New query. Paste the contents of [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) and run it.

Creates: `sp_user_map`, `customers_data`, `brand_sales_data`, helper functions (`current_user_sp`, `current_user_is_admin`), and RLS policies.

Then run the rest in order: `0002` … `0004`, then **`0007_file_acl_and_admin.sql`**, then **`0008_viewer_permissions.sql`**.

> **Do not run `0005_disable_auth_temporary.sql`.** It turns RLS off, which makes every
> table readable *and writable* by anyone holding the anon key — and the anon key ships
> inside the browser bundle, so that means anyone at all. It exists only as a record of
> what `0007` undoes. `0006` is folded into `0007`; running `0007` alone is enough.

`0007` re-enables RLS everywhere, adds the `data_files` registry and the private
`data-files` storage bucket, adds the Users panel's `admin_list_users()` function,
and sets the admin roster. It is idempotent and ends with a check that exactly one
admin exists — if that check fails, the whole migration rolls back and nothing changes.

`0008` sets the real visibility model: **once signed in, a user sees every
salesperson's data by default.** An admin can restrict any individual to their own
data (the `can_view_all` flag). It also makes uploaded files strictly admin-only and
adds the `auth.uid() is not null` gate on the team targets. Applying `0008` alone
covers everything the earlier `0008_targets_require_login.sql` did, so ignore that
name if you see it referenced anywhere.

Verify both landed with `python scripts/verify_access.py` — it should print `PASSED`.

## 3. Create salesperson logins

Install the Python Supabase client (one-time):

```
pip install supabase
```

Edit the `USERS` list at the top of [scripts/seed_users.py](scripts/seed_users.py) to use the real email addresses for each rep. Then:

```
python scripts/seed_users.py
```

The script prints generated passwords once at the end. Save them somewhere safe and share over a secure channel. Each user is created with their `sp_user_map` row pointing to their salesperson name. The `admin` user gets cross-team visibility.

## 4. Upload data

```
python scripts/upload_to_supabase.py --replace
```

Pushes the contents of `src/data.json` into `customers_data` (~2,153 rows) and `brand_sales_data` (~21,644 rows). Use `--replace` to truncate first; omit it on first run.

Re-run this whenever you regenerate `data.json` from the xlsx files (`python scripts/build_data.py`).

## 5. Test locally

```
npm run dev
```

Open http://localhost:5175 — you should see the login screen. Sign in as one of the salespeople; the dashboard scopes to their data automatically (RLS enforces it server-side, so they physically cannot see other teams' rows).

## 6. Deploy to Vercel

Once the local flow works, push to git and connect to the Vercel `salesdashboard` project:

```
git init && git add . && git commit -m "initial commit"
# create a private repo on GitHub, then:
git remote add origin git@github.com:<you>/sales-dashboard.git
git push -u origin main
```

In the Vercel dashboard, link this repo to the existing `salesdashboard` project. In **Settings → Environment Variables**, add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These are the only two needed by the production build. The service_role key stays on your local machine for seeding; do **not** put it in Vercel.

## How access control works

The portal blocks the public; once you are in, it is open. Precisely:

- **Not signed in** → nothing. RLS returns zero rows to the anon key, and every write is refused.
- **Signed in (default)** → sees **every** salesperson's data. This is the intended behaviour: the login is the gate, not per-rep scoping.
- **Signed in but restricted** → an admin has set that user's `can_view_all = false`, so RLS narrows them to their own `sp` (plus any `managed_sps`).
- **Admin** (`is_admin = true`) → sees everything, plus the **Data** tab (uploaded files) and the **Users** tab. Uploaded files are admin-only and never returned to a regular user.

Each auth user has a row in `sp_user_map` with `sp`, `is_admin`, and `can_view_all`. The RLS policies call `current_user_can_view_all()` and `current_user_is_admin()` to decide what each query returns. None of this is enforced in React — the database decides. Editing the app to unhide a tab changes nothing, because the API still hands back only what the policies allow.

### Who is admin

`ac@seed-malaysia.com` (Seed Malaysia) is the sole admin. Admin grants the `Data ⤴`
tab (uploaded files), the `👤 Users` tab, and cross-team data (which everyone has by
default anyway).

Change it from the **Users** tab in the dashboard, not by hand. The roster in
[scripts/seed_users.py](scripts/seed_users.py) must be kept in step — it upserts with the
service_role key, which bypasses both RLS and the last-admin trigger, so a stale
`is_admin: True` there re-grants admin the next time anyone re-seeds.

A database trigger refuses to demote or delete the last remaining admin, so the
dashboard cannot be locked out of its own controls.

### Restricting a user to their own data

By default every signed-in user sees all teams. To narrow one person to just their
own rep's rows, open the **Users** tab and set their **Data access** to *Own only*
(this sets `can_view_all = false`). Their `sp` — and any `managed_sps` — defines what
"own" means. Admins are always unrestricted.

### Uploaded files

Workbooks uploaded from the `Data ⤴` tab go to the **private** `data-files` bucket
with a row in `data_files`. They are **admin-only**: regular users have no Data tab,
and RLS returns them nothing from `data_files` or the bucket even via a direct API
call. Downloads are short-lived signed URLs, never public links. Hiding the tab in the
UI is *not* what protects the files — the policies are.

## Troubleshooting

- **Login succeeds but dashboard says "Couldn't load data"** — your auth user exists but doesn't have an `sp_user_map` row. Run the seed script again, or insert manually:
  `insert into sp_user_map (user_id, sp, is_admin) values ('uuid…', 'Alan', false);`
- **"VITE_SUPABASE_URL is not defined"** — restart the dev server after editing `.env`. Vite only reads env at startup
- **Numbers look wrong after upload** — the upload script doesn't auto-truncate. Use `--replace` to clear first
