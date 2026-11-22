// Customer Analysis: joins the customer master list ("Customer Data <year>.xlsx",
// one row per account with its type, town, state, owner and open date) to the
// monthly sales in customers_data, then rolls the accounts up by type, area,
// salesperson and opening year.
//
// The sales exports name customers by their short Autocount code (the master's
// "Customer ID" column, e.g. "CAPITAL OPTICAL&CONT"), not the long legal name,
// so the join key is the normalised code with the full name as a fallback.
// Sales customers that are not in the master list are kept as their own
// accounts (type "Not in customer list") so every total still reconciles with
// the other tabs.

import { spInScope } from "./teamScope.js";

export const NOT_LISTED = "Not in customer list";
export const UNKNOWN_AREA = "Unknown";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const keyOf = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Owner names on the master list are full names ("ALAN LOH"); the dashboard
// uses short ones ("Alan").
const SP_NAMES = {
  "alan loh": "Alan", alan: "Alan",
  "dino lim": "Dino", dino: "Dino",
  "khen tan": "Khen", khen: "Khen",
  sakinah: "Sakinah", "nor sakinah": "Sakinah", "nor sakinah ardani": "Sakinah",
  wani: "Wani", nurzawani: "Wani",
  "simon low": "Simon", simon: "Simon",
  "seed malaysia": "Seed Malaysia", seed: "Seed Malaysia",
  "jerry wong": "Jerry", jerry: "Jerry",
  salim: "Salim",
};
export function canonSp(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const hit = SP_NAMES[s.toLowerCase().replace(/\s+/g, " ")];
  if (hit) return hit;
  const first = s.split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// ---------- Area ----------

const MY_STATES = {
  SELANGOR: "Selangor",
  "WILAYAH PERSEKUTUAN KUALA LUMPUR": "Kuala Lumpur",
  "KUALA LUMPUR": "Kuala Lumpur",
  "WILAYAH PERSEKUTUAN PUTRAJAYA": "Putrajaya",
  PUTRAJAYA: "Putrajaya",
  "WILAYAH PERSEKUTUAN LABUAN": "Labuan",
  LABUAN: "Labuan",
  JOHOR: "Johor",
  MELAKA: "Melaka",
  MALACCA: "Melaka",
  "NEGERI SEMBILAN": "Negeri Sembilan",
  "PULAU PINANG": "Pulau Pinang",
  PENANG: "Pulau Pinang",
  PERAK: "Perak",
  KEDAH: "Kedah",
  PERLIS: "Perlis",
  PAHANG: "Pahang",
  TERENGGANU: "Terengganu",
  KELANTAN: "Kelantan",
  SABAH: "Sabah",
  SARAWAK: "Sarawak",
};

export const REGION_OF = {
  Selangor: "Central",
  "Kuala Lumpur": "Central",
  Putrajaya: "Central",
  Johor: "Southern",
  Melaka: "Southern",
  "Negeri Sembilan": "Southern",
  "Pulau Pinang": "Northern",
  Perak: "Northern",
  Kedah: "Northern",
  Perlis: "Northern",
  Pahang: "East Coast",
  Terengganu: "East Coast",
  Kelantan: "East Coast",
  Sabah: "East Malaysia",
  Sarawak: "East Malaysia",
  Labuan: "East Malaysia",
};
export const REGIONS = ["Central", "Southern", "Northern", "East Coast", "East Malaysia", "Overseas", UNKNOWN_AREA];

const NOT_A_PLACE = new Set(["", "NOT APPLICABLE", "N/A", "NA", "-", "OBER"]);
const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

// { state, region }. Anything that is not a Malaysian state is an overseas
// country (the master uses the state column for the country on export accounts).
export function normaliseArea(rawState, type) {
  const s = String(rawState ?? "").trim().replace(/\s+/g, " ");
  const up = s.toUpperCase();
  const my = MY_STATES[up];
  if (my) return { state: my, region: REGION_OF[my] };
  if (NOT_A_PLACE.has(up)) {
    return type === "OVERSEA" ? { state: "Country not set", region: "Overseas" } : { state: UNKNOWN_AREA, region: UNKNOWN_AREA };
  }
  if (up === "OVERSEA" || up === "OVERSEAS") return { state: "Country not set", region: "Overseas" };
  if (up === "PHILIPINES") return { state: "Philippines", region: "Overseas" };
  return { state: titleCase(s), region: "Overseas" };
}

// ---------- Parsing the master workbook ----------

const excelDate = (v) => {
  if (typeof v === "number" && Number.isFinite(v) && v > 20000) {
    return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
};

// rows: array-of-arrays straight from the sheet. Finds the header row by its
// "Customer ID" and "Type" cells so a moved column or an extra title row does
// not break the import. Email addresses are deliberately not kept.
export function parseMasterRows(rows) {
  const find = (row, re) => row.findIndex((c) => typeof c === "string" && re.test(c.trim()));
  let h = -1, col = null;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] || [];
    const code = find(row, /^customer\s*(id|code)$/i);
    const type = find(row, /^(customer\s*)?type$/i);
    if (code >= 0 && type >= 0) {
      h = r;
      col = {
        code,
        type,
        name: find(row, /^(customer\s*)?name$/i),
        sp: find(row, /^salesman(\s*id)?$|^sales\s*person$|^agent$/i),
        created: find(row, /^create(d)?\s*date$|^date\s*opened$/i),
        chain: find(row, /^remark$|^chain$|^group$/i),
        town: find(row, /^town$|^city$|^area$/i),
        state: find(row, /^state$/i),
      };
      break;
    }
  }
  if (h < 0) return [];
  const at = (row, i) => (i >= 0 ? row[i] : null);
  const str = (v) => String(v ?? "").trim();
  const out = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const code = str(at(row, col.code));
    const name = str(at(row, col.name)) || code;
    if (!code && !name) continue;
    out.push({
      code: code || name,
      name,
      sp: canonSp(at(row, col.sp)),
      created: excelDate(at(row, col.created)),
      chain: str(at(row, col.chain)).toUpperCase(),
      type: str(at(row, col.type)).toUpperCase() || "UNTYPED",
      town: str(at(row, col.town)).toUpperCase(),
      state: str(at(row, col.state)),
    });
  }
  return out;
}

// ---------- Joining ----------

// The last month of `year` that has any sales — the "as of" point for YTD.
// A past year with data in December is a full year.
export function asOfMonth(sales, year) {
  let last = -1;
  for (const r of sales) {
    if (r.year !== year || !Array.isArray(r.months)) continue;
    for (let m = 11; m > last; m--) if (r.months[m]) { last = m; break; }
  }
  return last;
}

const sumTo = (months, m) => {
  let t = 0;
  if (!months) return 0;
  for (let i = 0; i <= m; i++) t += months[i] || 0;
  return t;
};

const GROW = 0.1; // ±10% vs the same months last year counts as steady

export const STATUSES = [
  { key: "new", label: "New this year" },
  { key: "growing", label: "Growing" },
  { key: "steady", label: "Steady" },
  { key: "declining", label: "Declining" },
  { key: "lapsed", label: "Inactive" },
  { key: "never", label: "Never ordered" },
];

// Build one record per account. `sales` is customers_data rows
// ({sp, year, customer, months[12], total}).
export function buildAccounts({ master = [], sales = [], year, lapseMonths = 6 }) {
  const asOf = asOfMonth(sales, year);
  const M = asOf < 0 ? 11 : asOf;
  const now = year * 12 + M;

  // Sales per customer key: year -> months, plus who booked them.
  const byKey = new Map();
  for (const r of sales) {
    if (!r || !Array.isArray(r.months)) continue;
    const k = keyOf(r.customer);
    if (!k) continue;
    let e = byKey.get(k);
    if (!e) byKey.set(k, (e = { name: r.customer, years: new Map(), sp: new Map() }));
    let ms = e.years.get(r.year);
    if (!ms) e.years.set(r.year, (ms = new Array(12).fill(0)));
    for (let i = 0; i < 12; i++) ms[i] += r.months[i] || 0;
    e.sp.set(r.sp, (e.sp.get(r.sp) || 0) + (r.total || 0));
  }

  const used = new Set();
  const accounts = [];

  const finish = (base, e) => {
    const cur = e?.years.get(year);
    const prev = e?.years.get(year - 1);
    const ytd = sumTo(cur, M);
    const ly = sumTo(prev, M);
    const lyFull = sumTo(prev, 11);
    let last = -1, first = Infinity, lifetime = 0;
    if (e) {
      for (const [y, ms] of e.years) {
        if (y > year) continue;
        for (let m = 0; m < 12; m++) {
          const idx = y * 12 + m;
          if (idx > now || !ms[m]) continue;
          lifetime += ms[m];
          if (ms[m] > 0) {
            if (idx > last) last = idx;
            if (idx < first) first = idx;
          }
        }
      }
    }
    const createdYear = base.created ? Number(base.created.slice(0, 4)) : null;
    const firstYear = Number.isFinite(first) ? Math.floor(first / 12) : null;
    let status;
    if (last < 0) status = "never";
    else if (now - last >= lapseMonths) status = "lapsed";
    else if (createdYear === year || (firstYear === year && ly <= 0)) status = "new";
    else if (ly <= 0) status = ytd > 0 ? "growing" : "steady";
    else if (ytd >= ly * (1 + GROW)) status = "growing";
    else if (ytd <= ly * (1 - GROW)) status = "declining";
    else status = "steady";
    // Created after the as-of point (e.g. a 2026 account when looking at 2024)
    // did not exist yet: leave it out of that year's picture.
    if (createdYear && createdYear > year) return null;
    return {
      ...base,
      createdYear,
      ytd,
      ly,
      lyFull,
      lifetime,
      lastOrder: last < 0 ? null : { year: Math.floor(last / 12), month: last % 12 },
      monthsSince: last < 0 ? null : now - last,
      active: ytd > 0,
      status,
    };
  };

  for (const m of master) {
    const k = keyOf(m.code);
    let e = byKey.get(k);
    let hitKey = e ? k : null;
    if (!e) {
      const k2 = keyOf(m.name);
      e = byKey.get(k2);
      if (e) hitKey = k2;
    }
    if (hitKey) used.add(hitKey);
    const area = normaliseArea(m.state, m.type);
    const topSp = e ? [...e.sp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : null;
    const acc = finish(
      {
        id: `m:${k || keyOf(m.name)}`,
        name: m.name,
        code: m.code,
        sp: m.sp || topSp || "Unassigned",
        type: m.type || "UNTYPED",
        chain: m.chain || "",
        town: m.town || "",
        state: area.state,
        region: area.region,
        created: m.created || null,
        listed: true,
      },
      e
    );
    if (acc) accounts.push(acc);
  }

  // Customers with sales but no master row.
  for (const [k, e] of byKey) {
    if (used.has(k)) continue;
    let any = false;
    for (const [y, ms] of e.years) if (y <= year && y >= year - 1 && ms.some((v) => v)) any = true;
    if (!any) continue;
    const topSp = [...e.sp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Unassigned";
    const acc = finish(
      {
        id: `s:${k}`,
        name: e.name,
        code: e.name,
        sp: topSp,
        type: NOT_LISTED,
        chain: "",
        town: "",
        state: UNKNOWN_AREA,
        region: UNKNOWN_AREA,
        created: null,
        listed: false,
      },
      e
    );
    if (acc) accounts.push(acc);
  }

  return { accounts, asOf: M, hasData: asOf >= 0 };
}

export const filterAccounts = (accounts, { scope = "All", type = null, region = null, state = null } = {}) =>
  accounts.filter(
    (a) =>
      spInScope(a.sp, scope) &&
      (!type || a.type === type) &&
      (!region || a.region === region) &&
      (!state || a.state === state)
  );

export const growth = (cur, prev) => (prev > 0 ? (cur - prev) / prev : cur > 0 ? null : 0);

function blank(key) {
  const counts = {};
  for (const s of STATUSES) counts[s.key] = 0;
  return { key, accounts: 0, active: 0, ytd: 0, ly: 0, counts };
}
function add(g, a) {
  g.accounts += 1;
  if (a.active) g.active += 1;
  g.ytd += a.ytd;
  g.ly += a.ly;
  g.counts[a.status] += 1;
}
function finalize(list) {
  return list.map((g) => ({ ...g, growth: growth(g.ytd, g.ly), activeRate: g.accounts ? g.active / g.accounts : 0 }));
}
function groupBy(accounts, keyFn) {
  const m = new Map();
  for (const a of accounts) {
    const k = keyFn(a);
    if (!m.has(k)) m.set(k, blank(k));
    add(m.get(k), a);
  }
  return finalize([...m.values()]);
}

export function summarize(accounts) {
  const total = blank("total");
  for (const a of accounts) add(total, a);
  const [t] = finalize([total]);

  const byType = groupBy(accounts, (a) => a.type).sort(
    (a, b) => (a.key === NOT_LISTED) - (b.key === NOT_LISTED) || b.ytd - a.ytd || b.accounts - a.accounts
  );

  const byRegion = groupBy(accounts, (a) => a.region).sort((a, b) => REGIONS.indexOf(a.key) - REGIONS.indexOf(b.key));
  const states = groupBy(accounts, (a) => a.state);
  const towns = new Map();
  for (const a of accounts) {
    if (!towns.has(a.state)) towns.set(a.state, []);
    towns.get(a.state).push(a);
  }
  const byState = states
    .map((s) => ({
      ...s,
      region: accounts.find((a) => a.state === s.key)?.region || UNKNOWN_AREA,
      towns: groupBy(towns.get(s.key) || [], (a) => a.town || "—").sort((a, b) => b.ytd - a.ytd || b.accounts - a.accounts),
    }))
    .sort((a, b) => b.ytd - a.ytd || b.accounts - a.accounts);

  const bySp = groupBy(accounts, (a) => a.sp).sort((a, b) => b.ytd - a.ytd);

  const byCohort = groupBy(accounts.filter((a) => a.createdYear), (a) => a.createdYear).sort((a, b) => a.key - b.key);

  const byChain = groupBy(accounts.filter((a) => a.chain), (a) => a.chain).sort((a, b) => b.ytd - a.ytd);

  // Salesperson x type: how each rep's book is made up.
  const matrix = new Map();
  for (const a of accounts) {
    const k = `${a.sp}|${a.type}`;
    if (!matrix.has(k)) matrix.set(k, blank(k));
    add(matrix.get(k), a);
  }

  const moving = accounts.filter((a) => a.ytd > 0 || a.ly > 0).map((a) => ({ ...a, delta: a.ytd - a.ly }));
  const gainers = moving.filter((a) => a.delta > 0).sort((a, b) => b.delta - a.delta);
  const losers = moving.filter((a) => a.delta < 0).sort((a, b) => a.delta - b.delta);

  return { total: t, byType, byRegion, byState, bySp, byCohort, byChain, matrix, gainers, losers };
}
