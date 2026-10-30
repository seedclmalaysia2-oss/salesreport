// Vercel serverless function — send a Web Push notification to every subscribed
// device. Called by the admin "Send now" button (auth: the admin's Supabase
// JWT). The automatic send-on-update lives in api/weekly-digest.js.
//
// Env (set in Vercel → Settings → Environment Variables):
//   VITE_VAPID_PUBLIC_KEY   — VAPID public key (same one the browser uses)
//   VAPID_PRIVATE_KEY       — VAPID private key (SECRET)
//   VAPID_SUBJECT           — mailto: or https: contact for the push service
//   SUPABASE_URL            — project URL   (falls back to VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY — service role key (SECRET; bypasses RLS)

import { callerIsAdmin, pushEnvMissing, pushToAll } from "./_push.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (pushEnvMissing()) {
    return res.status(500).json({
      error: "Push is not configured. Set VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT and the Supabase service key in Vercel.",
    });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!(await callerIsAdmin(token))) return res.status(403).json({ error: "Admins only." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  try {
    return res.status(200).json(await pushToAll(body));
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
