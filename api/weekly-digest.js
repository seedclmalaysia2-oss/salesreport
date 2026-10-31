// Push the weekly board's month-to-date summary to every rep who enabled 🔔
// alerts — automatically, whenever an uploaded file changes the numbers.
// Same text as the board's 📋 Share modal (built by src/lib/weeklySummary.js),
// computed here from the live tables.
//
// Trigger: the browser calls POST after every weekly sync (upload, Update,
// Recalculate, Refresh — see notifyWeeklyUpdated in src/lib/weekly.js), with
// the admin's Supabase JWT. The server only sends when the figures differ from
// the last push (fingerprint kept in storage at data-files/digest/), so a
// re-sync that changes nothing stays silent.
//
//   POST /api/weekly-digest                 — admin JWT; push if changed
//   GET  /api/weekly-digest?dry=1           — CRON_SECRET bearer; return text only
//
// Env: CRON_SECRET (dry-run only), plus everything api/_push.js needs.

import { SUPABASE_URL, SERVICE_KEY, sb, callerCanUpload, pushEnvMissing, pushToAll } from "./_push.js";
import { monthToDateSummary, buildWeeklyShareText } from "../src/lib/weeklySummary.js";
import { applyCustCorrections } from "../src/lib/custCorrections.js";

const LAST_SENT = `${SUPABASE_URL}/storage/v1/object/data-files/digest/last-weekly.json`;
const storageHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// PostgREST caps a response at 1000 rows — page through with Range.
async function fetchAll(table, select, filter = "") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb(`${table}?select=${select}${filter}`, { headers: { Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`${table} ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// "Today" in Malaysia, so an in-progress month never shows a future end date.
const todayMY = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

async function buildSummary() {
  const [weekly, targets] = await Promise.all([
    fetchAll("weekly_sales", "period_start,period_end,sp,amount"),
    fetchAll("sales_targets", "year,month,sp,target_amt"),
  ]);
  const weeklySales = weekly.map((w) => ({ periodStart: w.period_start, periodEnd: w.period_end, sp: w.sp, amount: Number(w.amount) }));
  const latestYear = Math.max(0, ...weeklySales.map((w) => Number(w.periodStart?.slice(0, 4)) || 0));

  // Per-rep monthly totals from the customer file, with the recorded
  // corrections — the same custSummary the board reconciles against.
  const customers = latestYear > 0
    ? await fetchAll("customers_data", "sp,year,months", `&year=eq.${latestYear}`)
    : [];
  const bySp = new Map();
  for (const c of customers) {
    const s = bySp.get(c.sp) || { sp: c.sp, year: c.year, months: new Array(12).fill(0), total: 0 };
    for (let i = 0; i < 12; i++) s.months[i] += Number(c.months?.[i]) || 0;
    bySp.set(c.sp, s);
  }

  return monthToDateSummary({
    weeklySales,
    targets: targets.map((t) => ({ year: t.year, month: t.month, sp: t.sp, target: Number(t.target_amt) })),
    custSummary: applyCustCorrections([...bySp.values()]),
    todayIso: todayMY(),
  });
}

// The figures only — not the date label, which moves with "today" and would
// otherwise make every day look like a change.
const fingerprint = (s) =>
  JSON.stringify([s.monthKey, s.target, s.scopes.map((x) => x.rows.map((r) => [r.sp, Math.round(r.amount)]))]);

async function lastSentFingerprint() {
  const r = await fetch(LAST_SENT, { headers: storageHeaders });
  if (!r.ok) return null;
  return (await r.json().catch(() => null))?.fingerprint ?? null;
}

async function saveFingerprint(fp) {
  await fetch(LAST_SENT, {
    method: "POST",
    headers: { ...storageHeaders, "Content-Type": "application/json", "x-upsert": "true" },
    body: JSON.stringify({ fingerprint: fp, sentAt: new Date().toISOString() }),
  });
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const dry = req.method === "GET" && req.query?.dry === "1";

  if (dry) {
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  } else {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!(await callerCanUpload(token))) return res.status(403).json({ error: "Admins and uploaders only." });
    if (pushEnvMissing()) return res.status(500).json({ error: "Push is not configured (VAPID keys / service key missing)." });
  }

  try {
    const summary = await buildSummary();
    if (!summary) return res.status(200).json({ sent: 0, note: "No weekly data yet — nothing to send." });
    const text = buildWeeklyShareText(summary);
    if (dry) return res.status(200).json({ dry: true, text });

    const fp = fingerprint(summary);
    if (fp === (await lastSentFingerprint())) {
      return res.status(200).json({ sent: 0, unchanged: true, note: "Numbers unchanged since the last push." });
    }
    const result = await pushToAll({ title: `SEED Weekly Sales — ${summary.monthName}`, body: text, url: "/?share=weekly" });
    // Remember only once it reached someone, so reps who enable alerts later
    // still get the next update rather than it being marked as already sent.
    if (result.recipients > 0) await saveFingerprint(fp);
    return res.status(200).json({ ...result, month: summary.monthKey });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
