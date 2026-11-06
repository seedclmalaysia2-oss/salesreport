// ECP consignment stock, as read from the warehouse snapshot (sales_consignment()).
// Pure helpers, no I/O: "today" is always passed in so every render agrees.
//
// The workbook has no expiry date, only the CSG date, so a CSG's age (today minus
// its date) stands in for how long the stock has sat on a shelf. The bands and
// the key-account list mirror the Warehouse dashboard so both sites say the same.

export const BANDS = [
  { key: "fresh", label: "Under 6 months", maxDays: 183 },
  { key: "mid", label: "6 to 12 months", maxDays: 365 },
  { key: "old", label: "1 to 2 years", maxDays: 730 },
  { key: "stale", label: "Over 2 years", maxDays: Infinity },
];
export const UNDATED_LABEL = "No CSG date";
/** Index of the first band counted as "over a year". */
export const OVER_YEAR_FROM = 2;
export const STALE_BAND = 3;

// Key accounts handled under Alan: listed beneath him, never added into his own total.
export const ACCOUNT_PARENT = "Alan";
export const ACCOUNTS_UNDER_PARENT = ["Dr Specs", "Jac's Optometry", "Mag Eyewear", "Max Vision", "Optics 81", "Specs House"];
export const isSubAccount = (name) => ACCOUNTS_UNDER_PARENT.includes(name);

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function bandOf(days) {
  if (days === null || days === undefined) return BANDS.length;
  const i = BANDS.findIndex(b => days <= b.maxDays);
  return i === -1 ? BANDS.length - 1 : i;
}

/** "5 days", "8 mo", "2 yr 3 mo". */
export function ageText(days) {
  if (days === null || days === undefined) return "No date";
  if (days < 0) return "Future date";
  if (days < 45) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30.4375);
  if (months < 24) return `${months} mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y} yr ${m} mo` : `${y} yr`;
}

/** Today as YYYY-MM-DD in the viewer's own calendar (the team is in Malaysia). */
export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Rows from sales_consignment() -> lines with their age. */
export function toLines(rows, today) {
  return (rows || []).map(r => {
    const csgDate = r.csg_date || null;
    const days = csgDate ? daysBetween(csgDate, today) : null;
    return {
      outlet: r.outlet, owner: r.owner || "Unknown", state: r.state || "", town: r.town || "",
      product: r.product, family: r.family, csgNo: r.csg_no || null, csgDate,
      qty: Number(r.qty) || 0, needsRefresh: !!r.needs_refresh, tag: r.tag || null,
      days, band: bandOf(days),
    };
  });
}

export const sumQty = (lines) => lines.reduce((s, l) => s + l.qty, 0);

/** Headline figures for a set of lines. */
export function totals(lines) {
  const bands = new Array(BANDS.length + 1).fill(0);
  const outlets = new Set();
  let refreshLines = 0, refreshUnits = 0;
  for (const l of lines) {
    bands[l.band] += l.qty;
    outlets.add(l.outlet);
    if (l.needsRefresh) { refreshLines++; refreshUnits += l.qty; }
  }
  const units = bands.reduce((s, n) => s + n, 0);
  const overYearUnits = bands.slice(OVER_YEAR_FROM, BANDS.length).reduce((s, n) => s + n, 0);
  return { units, outlets: outlets.size, bands, overYearUnits, refreshLines, refreshUnits };
}

/** Who is in view, with how much each needs refreshing. Key accounts are kept apart. */
export function people(lines) {
  const map = new Map();
  for (const l of lines) {
    const w = map.get(l.owner) || { name: l.owner, marked: 0, old: 0, units: 0 };
    w.units += l.qty;
    if (l.needsRefresh) w.marked++;
    else if (l.band === STALE_BAND) w.old++;
    map.set(l.owner, w);
  }
  const order = (a, b) => b.marked - a.marked || b.old - a.old || a.name.localeCompare(b.name);
  const all = [...map.values()];
  return { main: all.filter(w => !isSubAccount(w.name)).sort(order), subs: all.filter(w => isSubAccount(w.name)).sort(order) };
}

/** Does this workbook owner name belong to this sales rep? ("Khen Tan" / "Khen", "Sakina" / "Sakinah".) */
export function ownerIsRep(owner, rep) {
  const o = String(owner || "").trim().toLowerCase();
  const r = String(rep || "").trim().toLowerCase();
  return !!o && !!r && (o.startsWith(r) || r.startsWith(o));
}

const byAge = (a, b) => (b.days ?? -1) - (a.days ?? -1) || b.qty - a.qty;

/** The two lists to act on: marked red in the workbook, then old stock nobody has marked. */
export function attention(lines) {
  return {
    flagged: lines.filter(l => l.needsRefresh).sort(byAge),
    unflagged: lines.filter(l => !l.needsRefresh && l.band === STALE_BAND).sort(byAge),
  };
}

/** One entry per outlet: its CSGs (oldest first), units and what needs attention. */
export function outletRows(lines) {
  const outlets = new Map();
  for (const l of lines) {
    let o = outlets.get(l.outlet);
    if (!o) outlets.set(l.outlet, (o = { name: l.outlet, owner: l.owner, state: l.state, town: l.town, units: 0, csgs: new Map(), refresh: 0, oldest: null }));
    o.units += l.qty;
    if (l.needsRefresh) o.refresh++;
    if (l.days !== null && (o.oldest === null || l.days > o.oldest)) o.oldest = l.days;
    const id = l.csgNo || `none|${l.csgDate}|${l.product}`;
    let g = o.csgs.get(id);
    if (!g) o.csgs.set(id, (g = { id, csgNo: l.csgNo, csgDate: l.csgDate, days: l.days, band: l.band, units: 0, needsRefresh: false, tags: [], products: [] }));
    g.units += l.qty;
    g.needsRefresh ||= l.needsRefresh;
    if (l.tag && !g.tags.includes(l.tag)) g.tags.push(l.tag);
    const p = g.products.find(x => x.product === l.product);
    if (p) p.qty += l.qty; else g.products.push({ product: l.product, qty: l.qty });
  }
  return [...outlets.values()].map(o => ({ ...o, csgs: [...o.csgs.values()].sort(byAge) }));
}

/** "just now", "12 min ago", "3 h ago", or the date once it is more than a day old. */
export function agoText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(t).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}
