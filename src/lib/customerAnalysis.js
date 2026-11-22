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

// Exact key: case and spacing only. Autocount codes can differ by a single
// space ("TRUE VISION BAHAU" vs "TRUEVISION BAHAU" are two different accounts),
// so matching tries this first and only falls back to the loose keyOf.
export const exactOf = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
// Old or variant customer codes in the sales files that belong to an account
// on the customer list (confirmed by the owner 2026-11-22). Sales booked under
// the left code count under the right one.
export const SALES_ALIASES = {
  "CHAN MAY MAY OPTOMET": "CHAN MAY MAY OPTOM", // code changed in 2025
  "OUR OPTOMETRIS": "OUR OPTOMETRIST", // code changed in 2025
  "POTT GLASSES SS2": "POTT GLASSES SS2 PJ",
  "POTT GLASSES SJ": "POTT GLASSES SS15 PJ", // Subang Jaya branch
  "PY OPTIC (PUC JAYA)": "PY OPTIC - MERAK", // Puchong Jaya until 2024, Merak from 2025
  // Registered company vs store signboard: Pro Eye Optique PLT trades as 1.0 Provision.
  "PRO EYE OPTIQUE PLT": "1.0 PROVISION",
  "PRO EYE OPTIQUE-ADV": "1.0 PROVISION",
  // Old codes that stopped the month the new list code opened (2026).
  // Take A Look pairing is a best guess (both Selangor, SIO-OPTC, Dino); swap if wrong.
  "TAKE A LOOK OPTICAL": "TAKE A LOOK - KEPONG",
  "TAKE A LOOK OPTOM": "TAKE A LOOK - KD",
  "FORSIGHT OPTOMETRIST": "FORSIGHT OPT",
  "I LOOK OPTIC": "I LOOK GALLERY",
};

// Known typos in the Autocount customer-type field, folded into the real code.
const TYPE_FIX = { "SIO-OPTOM-MY": "SIO-OPTM-MY" };
export const normType = (t) => {
  const u = String(t ?? "").trim().toUpperCase();
  return TYPE_FIX[u] || u || "UNTYPED";
};

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
      type: normType(at(row, col.type)),
      town: str(at(row, col.town)).toUpperCase(),
      state: str(at(row, col.state)),
    });
  }
  return out;
}

// ---------- Joining ----------

// Salespeople with any sales in `year`, so the picker hides reps who weren't
// selling then (left, or not yet joined).
export function activeReps(sales, year) {
  const out = new Set();
  for (const r of sales || []) {
    if (Number(r.year) !== Number(year)) continue;
    if (!(r.months || []).some((v) => Number(v) !== 0) && !Number(r.total)) continue;
    const sp = canonSp(r.sp);
    if (sp) out.add(sp);
  }
  return out;
}

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

  // Sales per customer (exact key): year -> months, plus who booked them.
  const byKey = new Map();
  const loose = new Map(); // keyOf -> [exact keys]
  for (const r of sales) {
    if (!r || !Array.isArray(r.months)) continue;
    const raw = exactOf(r.customer);
    const k = SALES_ALIASES[raw] || raw;
    if (!k) continue;
    if (!byKey.has(k)) {
      const lk = keyOf(k);
      if (!loose.has(lk)) loose.set(lk, []);
      loose.get(lk).push(k);
    }
    let e = byKey.get(k);
    if (!e) byKey.set(k, (e = { name: r.customer, years: new Map(), sp: new Map() }));
    let ms = e.years.get(r.year);
    if (!ms) e.years.set(r.year, (ms = new Array(12).fill(0)));
    for (let i = 0; i < 12; i++) ms[i] += r.months[i] || 0;
    e.sp.set(r.sp, (e.sp.get(r.sp) || 0) + (r.total || 0));
    if (r.months.some((v) => v) && !(e.lastYear >= r.year)) { e.lastYear = r.year; e.lastSp = r.sp; }
  }

  // The customer list sometimes carries one account twice: the same Customer ID
  // under two owners ("TRUE VISION [BAHAU]" for Dino and Simon) or the code
  // with and without a space ("EYE PRO EYEWEAR" / "EYEPRO EYEWEAR"). Codes that
  // are equal once spaces and punctuation are ignored are one account; keep the
  // row owned by whoever booked its latest sales, then the row whose code is
  // spelt as in the uploaded sales files, then the newest row.
  const salesFor = (code) => byKey.get(exactOf(code)) || (loose.get(keyOf(code)) || []).map((k) => byKey.get(k))[0] || null;
  const groups = new Map();
  master.forEach((m) => {
    const k = keyOf(m.code) || `#${groups.size}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  });
  const list = [];
  const merged = [];
  for (const rows of groups.values()) {
    if (rows.length === 1) { list.push(rows[0]); continue; }
    const e = salesFor(rows[0].code);
    const score = (m) => [
      e && e.lastSp && canonSp(m.sp) === e.lastSp ? 1 : 0,
      byKey.has(exactOf(m.code)) ? 1 : 0,
      m.created || "",
    ];
    const best = [...rows].sort((a, b) => {
      const x = score(a), y = score(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? -1 : 1;
      return 0;
    })[0];
    list.push(best);
    merged.push({ kept: best, dropped: rows.filter((r) => r !== best) });
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
    // New = first order this year (an account re-coded from an older one keeps
    // its history, so it is not new).
    else if (firstYear === year) status = "new";
    else if (ly <= 0) status = ytd > 0 ? "growing" : "steady";
    else if (ytd >= ly * (1 + GROW)) status = "growing";
    else if (ytd <= ly * (1 - GROW)) status = "declining";
    else status = "steady";
    // Created after the as-of point (e.g. a 2026 account when looking at 2024)
    // did not exist yet: leave it out of that year's picture, unless sales
    // already reached it then (an old code merged into a newer account).
    if (createdYear && createdYear > year && last < 0) return null;
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

  // Each sales customer is claimed by at most one account: exact code/name
  // matches first (for every account), then the loose fallback for the rest.
  const hit = new Array(list.length).fill(null);
  list.forEach((m, i) => {
    for (const k of [exactOf(m.code), exactOf(m.name)]) {
      if (k && byKey.has(k) && !used.has(k)) { hit[i] = k; used.add(k); break; }
    }
  });
  list.forEach((m, i) => {
    if (hit[i]) return;
    for (const lk of [keyOf(m.code), keyOf(m.name)]) {
      const k = (loose.get(lk) || []).find((x) => !used.has(x));
      if (k) { hit[i] = k; used.add(k); break; }
    }
  });

  // Spelling variants of the matched code in the sales files ("EYE PRO
  // EYEWEAR" vs "EYEPRO EYEWEAR") are the same account: fold them in too.
  const mergeEntries = (keys) => {
    if (keys.length === 1) return byKey.get(keys[0]);
    const out = { name: byKey.get(keys[0]).name, years: new Map(), sp: new Map() };
    for (const k of keys) {
      const e = byKey.get(k);
      for (const [y, ms] of e.years) {
        const t = out.years.get(y) || new Array(12).fill(0);
        for (let i = 0; i < 12; i++) t[i] += ms[i];
        out.years.set(y, t);
      }
      for (const [sp, v] of e.sp) out.sp.set(sp, (out.sp.get(sp) || 0) + v);
    }
    return out;
  };

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    let e = null;
    if (hit[i]) {
      const keys = [hit[i], ...(loose.get(keyOf(hit[i])) || []).filter((k) => k !== hit[i] && !used.has(k))];
      keys.forEach((k) => used.add(k));
      e = mergeEntries(keys);
    }
    const area = normaliseArea(m.state, m.type);
    const topSp = e ? [...e.sp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : null;
    const acc = finish(
      {
        id: `m:${i}`,
        name: m.name,
        code: m.code,
        sp: m.sp || topSp || "Unassigned",
        type: normType(m.type),
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
        id: `s:${keyOf(k)}:${k}`,
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

  return { accounts, asOf: M, hasData: asOf >= 0, merged };
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
