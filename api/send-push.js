// Vercel serverless function — send a Web Push notification to every subscribed
// device. Called by the admin "Send now" button (auth: the admin's Supabase
// JWT) and, later, by a scheduled Vercel Cron (auth: CRON_SECRET header).
//
// Env (set in Vercel → Settings → Environment Variables):
//   VITE_VAPID_PUBLIC_KEY   — VAPID public key (same one the browser uses)
//   VAPID_PRIVATE_KEY       — VAPID private key (SECRET)
//   VAPID_SUBJECT           — mailto: or https: contact for the push service
//   SUPABASE_URL            — project URL   (falls back to VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY — service role key (SECRET; bypasses RLS)
//   CRON_SECRET             — optional shared secret for the scheduled path

import webpush from "web-push";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:ac@seed-malaysia.com";

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return res;
}

// Confirm the bearer token belongs to an admin. Returns true/false.
async function callerIsAdmin(token) {
  if (!token) return false;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!u.ok) return false;
  const user = await u.json();
  if (!user?.id) return false;
  const r = await sb(`sp_user_map?select=is_admin&user_id=eq.${user.id}`);
  if (!r.ok) return false;
  const rows = await r.json();
  return rows?.[0]?.is_admin === true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!SUPABASE_URL || !SERVICE_KEY || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(500).json({
      error: "Push is not configured. Set VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT and the Supabase service key in Vercel.",
    });
  }

  // --- authorize: admin JWT, or the cron secret for the scheduled path ---
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const cronOk = process.env.CRON_SECRET && req.headers["x-cron-secret"] === process.env.CRON_SECRET;
  if (!cronOk) {
    const ok = await callerIsAdmin(token);
    if (!ok) return res.status(403).json({ error: "Admins only." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const payload = JSON.stringify({
    title: body.title || "SEED Weekly Sales",
    body: (body.body || "").slice(0, 3500),
    url: body.url || "/",
    tag: "seed-weekly-sales",
  });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const subRes = await sb("push_subscriptions?select=id,endpoint,subscription");
  if (!subRes.ok) {
    return res.status(500).json({ error: `Couldn't load subscriptions: ${await subRes.text()}` });
  }
  const subs = await subRes.json();
  if (!subs.length) return res.status(200).json({ sent: 0, failed: 0, pruned: 0, note: "No one has enabled alerts yet." });

  let sent = 0, failed = 0;
  const stale = [];
  await Promise.all(
    subs.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent += 1;
      } catch (err) {
        // 404/410 mean the subscription is gone — drop it so it isn't retried.
        if (err?.statusCode === 404 || err?.statusCode === 410) stale.push(row.endpoint);
        else failed += 1;
      }
    })
  );

  if (stale.length) {
    const inList = stale.map((e) => `"${e.replace(/"/g, '""')}"`).join(",");
    await sb(`push_subscriptions?endpoint=in.(${encodeURIComponent(inList)})`, { method: "DELETE" }).catch(() => {});
  }

  return res.status(200).json({ sent, failed, pruned: stale.length, recipients: subs.length });
}
