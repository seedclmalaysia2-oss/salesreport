// Vercel Cron — push the weekly board's month-to-date summary to every rep who
// enabled 🔔 alerts. Same text as the board's 📋 Share modal (built by
// src/lib/weeklySummary.js), computed here from the live tables so nobody has
// to open the dashboard and press Send.
//
// Schedule: vercel.json → crons (Monday 01:00 UTC = 9am Malaysia).
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
//   GET /api/weekly-digest           — build + push
//   GET /api/weekly-digest?dry=1     — build only, return the text (no push)
//
// Env: CRON_SECRET, plus everything api/_push.js needs.

import { sb, pushEnvMissing, pushToAll } from "./_push.js";
import { monthToDateSummary, buildWeeklyShareText } from "../src/lib/weeklySummary.js";
import { applyCustCorrections } from "../src/lib/custCorrections.js";

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

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const dry = req.query?.dry === "1";
  if (!dry && pushEnvMissing()) {
    return res.status(500).json({ error: "Push is not configured (VAPID keys / service key missing)." });
  }

  try {
    const [weekly, targets] = await Promise.all([
      fetchAll("weekly_sales", "period_start,period_end,sp,amount"),
      fetchAll("sales_targets", "year,month,sp,target_amt"),
    ]);
    const weeklySales = weekly.map((w) => ({ periodStart: w.period_start, periodEnd: w.period_end, sp: w.sp, amount: Number(w.amount) }));
    const latestYear = Math.max(...weeklySales.map((w) => Number(w.periodStart?.slice(0, 4)) || 0));

    // Per-rep monthly totals from the customer file, with the recorded
    // corrections — the same custSummary the board reconciles against.
    const customers = Number.isFinite(latestYear) && latestYear > 0
      ? await fetchAll("customers_data", "sp,year,months", `&year=eq.${latestYear}`)
      : [];
    const bySp = new Map();
    for (const c of customers) {
      const s = bySp.get(c.sp) || { sp: c.sp, year: c.year, months: new Array(12).fill(0), total: 0 };
      for (let i = 0; i < 12; i++) s.months[i] += Number(c.months?.[i]) || 0;
      bySp.set(c.sp, s);
    }
    const custSummary = applyCustCorrections([...bySp.values()]);

    const summary = monthToDateSummary({
      weeklySales,
      targets: targets.map((t) => ({ year: t.year, month: t.month, sp: t.sp, target: Number(t.target_amt) })),
      custSummary,
      todayIso: todayMY(),
    });
    if (!summary) return res.status(200).json({ sent: 0, note: "No weekly data yet — nothing to send." });

    const text = buildWeeklyShareText(summary);
    if (dry) return res.status(200).json({ dry: true, text });

    const result = await pushToAll({ title: `SEED Weekly Sales — ${summary.monthName}`, body: text, url: "/" });
    return res.status(200).json({ ...result, month: summary.monthKey });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
