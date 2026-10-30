// Shared Web Push fan-out for api/send-push.js (admin "Send now") and
// api/weekly-digest.js (scheduled). The leading underscore keeps Vercel from
// exposing this file as its own route.

import webpush from "web-push";

export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:ac@seed-malaysia.com";

export function pushEnvMissing() {
  return !SUPABASE_URL || !SERVICE_KEY || !VAPID_PUBLIC || !VAPID_PRIVATE;
}

export async function sb(path, init = {}) {
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

// Confirm a Supabase JWT belongs to an admin. Returns true/false.
export async function callerIsAdmin(token) {
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

// Push { title, body, url } to every subscribed device; prunes dead endpoints.
export async function pushToAll({ title, body, url = "/" }) {
  const payload = JSON.stringify({
    title: title || "SEED Weekly Sales",
    body: (body || "").slice(0, 3500),
    url,
    tag: "seed-weekly-sales",
  });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const subRes = await sb("push_subscriptions?select=id,endpoint,subscription");
  if (!subRes.ok) throw new Error(`Couldn't load subscriptions: ${await subRes.text()}`);
  const subs = await subRes.json();
  if (!subs.length) return { sent: 0, failed: 0, pruned: 0, recipients: 0, note: "No one has enabled alerts yet." };

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

  return { sent, failed, pruned: stale.length, recipients: subs.length };
}
