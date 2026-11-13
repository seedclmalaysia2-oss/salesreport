// The running build label shown in the dashboard header, e.g. "202611 build 00184".
// Vercel builds without the git history, so the number can't be counted from
// commits at build time. Instead each live (production) deployment takes the
// next number the first time anyone opens the dashboard, kept in the shared
// table public.app_build (app, sha, n, went_live) so every later view and every
// function instance agrees. Preview deployments and `vite dev` get no number
// (label null), and the header then says "test build".
//
//   GET /api/build  → { label: "202611 build 00184" } | { label: null }
//
// public.app_build has RLS on with no policies, so only the service role reads
// or writes it; the browser's anon key never sees it. The label itself is not
// sensitive, so this route needs no sign-in.
//
// Env: SUPABASE_URL (falls back to VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

const APP = "salesreport";

/** Builds before this scheme started: the 183 commits on main on 13 Nov 2026. The first live build is 184. */
const BEFORE = 183;

const SHA = process.env.VERCEL_GIT_COMMIT_SHA || "";
const LIVE = process.env.VERCEL_ENV === "production";

// One lookup per function instance; a failure is not cached, so the next call retries.
let cached = null;

async function readRow() {
  const r = await sb(`app_build?app=eq.${APP}&sha=eq.${encodeURIComponent(SHA)}&select=n,went_live`);
  if (!r.ok) throw new Error(`app_build read ${r.status}`);
  return (await r.json())[0] || null;
}

async function assign() {
  let row = await readRow();
  if (!row) {
    const r = await sb(`app_build?app=eq.${APP}&select=n&order=n.desc&limit=1`);
    if (!r.ok) throw new Error(`app_build max ${r.status}`);
    const max = (await r.json())[0]?.n;
    const n = (Number.isFinite(max) ? max : BEFORE) + 1;
    // Two first views at the same moment: the second insert is ignored and both read the same row.
    const ins = await sb("app_build?on_conflict=app,sha", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ app: APP, sha: SHA, n }),
    });
    if (!ins.ok) throw new Error(`app_build insert ${ins.status}`);
    row = await readRow();
  }
  const n = Number(row?.n);
  if (!row || !Number.isFinite(n)) return null;
  // The month the build went live, in Malaysia time (UTC+8).
  const month = new Date(new Date(row.went_live).getTime() + 8 * 3600_000).toISOString().slice(0, 7).replace("-", "");
  return `${month} build ${String(n).padStart(5, "0")}`;
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!LIVE || !SHA || !SUPABASE_URL || !SERVICE_KEY) return res.status(200).json({ label: null });
  cached ??= assign().catch(() => { cached = null; return null; });
  return res.status(200).json({ label: await cached });
}
