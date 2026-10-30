// Weekly-board summary, shared by the browser (Share modal) and the scheduled
// sender (api/weekly-digest.js). Pure — no Supabase, no DOM — so the cron path
// reproduces the board's month-to-date numbers without a browser open.
//
// The month-to-date math mirrors WeeklySalesCard: sum every calendar week of the
// month per rep, reconcile to the "Sales Analysis by customer" total via the
// per-rep Cust Adj (only once that file has caught up), then split into the
// retail trio and the whole company, both against the company _TEAM target.

export const RETAIL_TEAM = ["Alan", "Dino", "Khen"];

export const fmtRM = (v) => `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtDay = (iso) => {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

const monthNameOf = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// Plain text, deliberately no monospace alignment: WhatsApp only renders the
// ``` block in a fixed font on some clients, so padded columns break more often
// than they help. Bold headers (*…*) and bullets read well everywhere.
export function buildWeeklyShareText(summary) {
  const { monthName, periodLabel, isMonthView, target, scopes } = summary;
  const pctLine = (total) =>
    target > 0 ? ` (${Math.round((total / target) * 100)}% of ${fmtRM(target)})` : "";
  const lines = [];
  lines.push(`📊 SEED Weekly Sales — ${monthName}`);
  lines.push(`${periodLabel}${isMonthView ? " · month to date" : ""}`);
  for (const s of scopes) {
    lines.push("");
    lines.push(`*${s.title}*${s.subtitle ? ` (${s.subtitle})` : ""}`);
    for (const r of s.rows) lines.push(`• ${r.sp} — ${fmtRM(r.amount)}`);
    lines.push(`Total: ${fmtRM(s.total)}${pctLine(s.total)}`);
  }
  if (target > 0) {
    lines.push("");
    lines.push(`_Both teams measured against the company target of ${fmtRM(target)}._`);
  }
  return lines.join("\n");
}

// Month-to-date summary for the latest month on the weekly board.
//   weeklySales: [{ periodStart, periodEnd, sp, amount }]
//   targets:     [{ year, month, sp, target }]      (_TEAM row is the company target)
//   custSummary: [{ sp, year, months[12] }]         (corrections already applied)
//   todayIso:    "YYYY-MM-DD" — caps an in-progress month's end date at today
// Returns null when there is no weekly data.
export function monthToDateSummary({ weeklySales, targets = [], custSummary = [], todayIso }) {
  const weeks = (weeklySales || []).filter((w) => w.periodStart && w.periodEnd);
  if (!weeks.length) return null;
  const monthKey = weeks.map((w) => w.periodStart.slice(0, 7)).sort().pop();
  const [year, month] = monthKey.split("-").map(Number);

  const board = new Map();
  let firstStart = null, lastEnd = null;
  for (const w of weeks) {
    if (w.periodStart.slice(0, 7) !== monthKey) continue;
    if (!firstStart || w.periodStart < firstStart) firstStart = w.periodStart;
    if (!lastEnd || w.periodEnd > lastEnd) lastEnd = w.periodEnd;
    board.set(w.sp, (board.get(w.sp) || 0) + (Number(w.amount) || 0));
  }

  // Cust Adj — same "caught up" guard as the card: a lagging customer file must
  // never drag the month down.
  const sa = new Map();
  for (const s of custSummary) {
    if (s.year !== year || String(s.sp).trim().toLowerCase() === "all") continue;
    const v = Number(s.months?.[month - 1]) || 0;
    if (v) sa.set(s.sp, (sa.get(s.sp) || 0) + v);
  }
  const saTotal = [...sa.values()].reduce((a, b) => a + b, 0);
  const boardTotal = [...board.values()].reduce((a, b) => a + b, 0);
  const caughtUp = sa.size > 0 && (boardTotal <= 0 || saTotal >= boardTotal * 0.5);
  const byRep = new Map(board);
  if (caughtUp) {
    for (const rep of new Set([...sa.keys(), ...board.keys()])) {
      const adj = Math.round(((sa.get(rep) || 0) - (board.get(rep) || 0)) * 100) / 100;
      if (Math.abs(adj) >= 0.005) byRep.set(rep, (byRep.get(rep) || 0) + adj);
    }
  }

  const rows = [...byRep.entries()].map(([sp, amount]) => ({ sp, amount }));
  const teamRows = rows.filter((r) => RETAIL_TEAM.includes(r.sp) && r.amount > 0).sort((a, b) => b.amount - a.amount);
  const allRows = rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const sum = (rs) => rs.reduce((a, b) => a + b.amount, 0);

  const team = targets.find((t) => t.year === year && t.month === month && t.sp === "_TEAM");
  const target = team ? Number(team.target) || 0 : 0;

  const end = todayIso && lastEnd > todayIso && firstStart <= todayIso ? todayIso : lastEnd;
  return {
    monthKey,
    monthName: monthNameOf(end),
    periodLabel: `${fmtDay(firstStart)} – ${fmtDay(end)}`,
    isMonthView: true,
    target,
    scopes: [
      { key: "retail", title: "Retail Sales Team", subtitle: "Alan + Dino + Khen", total: sum(teamRows), rows: teamRows },
      { key: "all", title: "Seed Malaysia — Whole Team", subtitle: "all teams incl. overseas", total: sum(allRows), rows: allRows },
    ],
  };
}
