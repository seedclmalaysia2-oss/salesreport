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

- Each rep's auth user has a row in `sp_user_map` linking them to a salesperson name (Alan, Dino, etc.) plus an `is_admin` flag
- RLS policies on `customers_data` and `brand_sales_data` use `auth.uid()` to look up that mapping
- A non-admin user sending `select * from customers_data` only gets back rows where `sp = (their sp)`
- Admin users see everything
- The dashboard UI doesn't enforce any of this — the database does. Even if someone modified the React app to ignore filters, they'd still only get their scoped slice from the API

## Troubleshooting

- **Login succeeds but dashboard says "Couldn't load data"** — your auth user exists but doesn't have an `sp_user_map` row. Run the seed script again, or insert manually:
  `insert into sp_user_map (user_id, sp, is_admin) values ('uuid…', 'Alan', false);`
- **"VITE_SUPABASE_URL is not defined"** — restart the dev server after editing `.env`. Vite only reads env at startup
- **Numbers look wrong after upload** — the upload script doesn't auto-truncate. Use `--replace` to clear first
