// Admin-only: the reps' WhatsApp numbers for the weekly summary's per-rep
// "Send to <rep>" buttons (wa.me click-to-chat). Kept in the REP_WHATSAPP env
// var rather than the repo because the repo is public.
//
//   GET /api/rep-contacts   (Authorization: Bearer <admin or uploader Supabase JWT>)
//   → { contacts: { "Khen": "60163224370", ... } }
//
// Env: REP_WHATSAPP — JSON object, rep name → E.164 digits (no "+").

import { callerCanUpload } from "./_push.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!(await callerCanUpload(token))) return res.status(403).json({ error: "Admins and uploaders only." });

  let contacts = {};
  try { contacts = JSON.parse(process.env.REP_WHATSAPP || "{}"); } catch { /* malformed → none */ }
  res.setHeader("cache-control", "no-store");
  return res.status(200).json({ contacts });
}
