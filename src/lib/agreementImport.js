// Bringing the company's existing signed agreements (the SEED ECP AGREEMENT
// folder) into the Contracts list.
//
// Pure pieces, so they can be tested without a browser:
//   pickAgreementFiles   which files to read: one per agreement, Word over PDF
//   parseAgreement       customer, year, dates, sponsorship tiers, product incentives
//   planImport           newest agreement per customer, active if dated 2026 or later
//   draftFromAgreement   the saved-contract draft for one of them

import { clausesFromParagraphs } from "./contractTemplate.js";
import { REP_NAMES, DRAFT_DEFAULTS, SUPPLIER_DEFAULT } from "./contractDraft.js";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Words in a file name that mean it is not a signed agreement.
const NOT_AGREEMENT = /proposal|template|summary|calculation|draft|amendment/i;

const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || "") || [, ""])[1].toLowerCase();
const stemOf = (name) => String(name || "").replace(/\.[a-z0-9]+$/i, "");
const dirOf = (path) => String(path || "").replace(/\\/g, "/").replace(/\/[^/]*$/, "");

// A file's identity for "same agreement": folder + name without copy markers.
function agreementKey(path) {
  const name = stemOf(String(path || "").replace(/\\/g, "/").split("/").pop());
  const base = name.toLowerCase().replace(/\s*\(\d+\)$|-\d+$|\s+v\d+$|\s+copy$/g, "").replace(/[\s_]+/g, " ").trim();
  return `${dirOf(path).toLowerCase()}|${base}`;
}

// files: [{ path, name, modified? }]. Returns
//   chosen:    Word files to read, one per agreement (the newest when copies exist)
//   pdfOnly:   PDFs with no Word version (cannot be read)
//   skipped:   { pdfTwins, copies, proposals, other }
export function pickAgreementFiles(files) {
  const skipped = { pdfTwins: 0, copies: 0, proposals: 0, other: 0 };
  const groups = new Map();
  for (const f of files || []) {
    const name = f.name || String(f.path).split(/[\\/]/).pop();
    if (/^~\$/.test(name)) continue;
    // Proposals, templates, drafts and working sheets are not signed agreements.
    if (/proposal\s*\(\s*not confirm/i.test(f.path || "") || NOT_AGREEMENT.test(name)) { skipped.proposals += 1; continue; }
    const ext = extOf(name);
    if (ext !== "docx" && ext !== "pdf") { skipped.other += 1; continue; }
    const k = agreementKey(f.path || name);
    const g = groups.get(k) || { docx: [], pdf: [] };
    g[ext].push({ ...f, name });
    groups.set(k, g);
  }
  const chosen = [];
  const pdfOnly = [];
  for (const g of groups.values()) {
    if (g.docx.length) {
      g.docx.sort((a, b) => (b.modified || 0) - (a.modified || 0));
      chosen.push(g.docx[0]);
      skipped.copies += g.docx.length - 1;
      skipped.pdfTwins += g.pdf.length;
    } else {
      pdfOnly.push(g.pdf[0]);
    }
  }
  return { chosen, pdfOnly, skipped };
}

export const repFromPath = (path) => {
  const m = /SALES CONTRACT\s*-\s*([A-Za-z]+)/i.exec(String(path || ""));
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "";
};

// "SVC OPTICAL GROUP SDN BHD (RASAH JAYA)" and "svc optical group" should meet.
export function customerKey(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/\b(SDN\.?|BHD\.?|BERHAD|\(M\)|ENTERPRISE|PLT)\b/g, " ")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const toIso = (d, monthName, y) => {
  const m = MONTHS.indexOf(String(monthName).toLowerCase());
  return m < 0 ? null : `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

function cleanCustomerFromFile(name) {
  return stemOf(name)
    .replace(/\b20[12]\d\b/g, " ")
    .replace(/sales contract|\bsales\b|sponsorship|incentive|target|product|agreement|mou|rebate|campaign|loyalty|appreciation|draft|proposal|new|update|anniversary|\bv\d\b|\(\d\)|-\d$/gi, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// paragraphs: [{ text }] from the document, name: the file name, modified: ms.
export function parseAgreement(paragraphs, name = "", modified = 0) {
  const lines = (paragraphs || []).map((p) => String(p.text || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = lines.join("\n");

  const cust = /Customer\W{0,3}s Name\s*:\s*(.+)/i.exec(text);
  // A blank "Customer's Name : ______" must not win over the file name.
  const named = cust ? cust[1].replace(/\s+/g, " ").trim() : "";
  const customer = named.replace(/[^A-Za-z]/g, "").length >= 3 ? named : cleanCustomerFromFile(name);

  const title = /LOYALTY APPRECIATION CAMPAIGN\s*(20\d\d)|CAMPAIGN\s*(20\d\d)/i.exec(text);
  const fileYear = /\b(20[12]\d)\b/.exec(name);
  const year = Number(title?.[1] || title?.[2] || fileYear?.[1] || (modified ? new Date(modified).getFullYear() : 0)) || null;

  let start = null;
  let end = null;
  const range = /(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(20\d\d)\s*(?:~|-|–|to)\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(20\d\d)/i.exec(text);
  if (range) { start = toIso(range[1], range[2], range[3]); end = toIso(range[4], range[5], range[6]); }

  // Sponsorship bands: "16,000 & Above" / "13,000 ~ 15,999" followed by "4%".
  const tiers = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const band = /^([\d,]{3,})\s*(?:&\s*above|and above|above|~|-|–|to)?/i.exec(lines[i]);
    const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(lines[i + 1]);
    if (band && pct && /^[\d,]+(\s*(&\s*above|and above|above|~|-|–|to).*)?$/i.test(lines[i])) {
      const from = Number(band[1].replace(/,/g, ""));
      if (from >= 100) tiers.push({ from, pct: Number(pct[1]) });
    }
  }
  tiers.sort((a, b) => a.from - b.from);

  // Product incentives: "<product>" then "RM5/box", or "RM2/box (product)".
  const incentives = [];
  const rate = /^RM\s?\d+(?:\.\d+)?\s*\/\s*[A-Za-z]+/i;
  for (let i = 0; i < lines.length; i++) {
    const inline = /^(RM\s?\d+(?:\.\d+)?\s*\/\s*[A-Za-z]+)\s*\((.+)\)$/i.exec(lines[i]);
    if (inline) { incentives.push({ item: inline[2].trim(), value: inline[1].replace(/\s+/g, "") }); continue; }
    if (rate.test(lines[i]) && i > 0 && !/^\d+\.?$/.test(lines[i - 1]) && !rate.test(lines[i - 1])) {
      incentives.push({ item: lines[i - 1], value: lines[i].replace(/\s+/g, "") });
    }
  }

  const promo = /Special Promotion\s*\n(.+)/i.exec(text);
  const terms = clausesFromParagraphs(lines.map((t) => ({ text: t })));

  return {
    customer,
    year,
    start,
    end,
    tiers,
    incentives,
    promoNote: promo ? promo[1].trim() : "",
    isMou: /MEMORANDUM OF UNDERSTANDING/i.test(text),
    detail: tiers.length || incentives.length ? "full" : "basic",
    terms,
  };
}

// items: [{ file: { path, name }, parsed }]. One agreement per customer: the
// newest. It is active when it runs in `activeFrom` or later; every other
// customer's agreement is a past one, so it comes in inactive.
export function planImport(items, { activeFrom = 2026, existing = [] } = {}) {
  const have = new Set((existing || []).map((r) => `${customerKey(r.title)}|${r.contractYear}`));
  const best = new Map();
  let older = 0;
  for (const it of items) {
    const p = it.parsed;
    if (!p?.customer || !p.year) continue;
    const k = customerKey(p.customer);
    const cur = best.get(k);
    const yearEnd = p.end ? Number(p.end.slice(0, 4)) : p.year;
    const rank = p.year * 10000 + (p.end ? Number(p.end.slice(5, 7)) * 100 + Number(p.end.slice(8, 10)) : 0);
    if (!cur || rank > cur.rank) {
      if (cur) older += 1;
      best.set(k, { ...it, rank, yearEnd });
    } else older += 1;
  }
  const rows = [...best.values()]
    .map((b) => ({
      file: b.file,
      parsed: b.parsed,
      rep: repFromPath(b.file.path),
      active: Math.max(b.parsed.year, b.yearEnd) >= activeFrom,
      alreadySaved: have.has(`${customerKey(b.parsed.customer)}|${b.parsed.year}`),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.parsed.customer.localeCompare(b.parsed.customer));
  return { rows, older, unreadable: items.filter((i) => !i.parsed?.customer || !i.parsed.year).length };
}

// `match` is the dashboard customer name this agreement belongs to, if one was found.
export function draftFromAgreement(row, { clauses = [], match = null } = {}) {
  const p = row.parsed;
  const floor = p.tiers[0]?.from || 0;
  const rep = row.rep;
  return {
    ...DRAFT_DEFAULTS,
    kind: "ecp",
    title: p.customer,
    baseYear: p.year - 1,
    contractYear: p.year,
    status: "final",
    customerNames: match ? [match] : [],
    groupChains: [],
    customerLegal: "",
    supplier: SUPPLIER_DEFAULT,
    supplierSignatory: "SIMON LOW",
    customerSignatory: "",
    startDate: p.start || `${p.year}-01-01`,
    endDate: p.end || `${p.year}-12-31`,
    issued: new Date().toISOString().slice(0, 10),
    growth: null,
    target: floor,
    quarters: null,
    tiers: floor ? p.tiers.map((t) => ({ at: Math.round((t.from / floor) * 1000) / 1000, pct: t.pct })) : [],
    clauses: clauses.map((c, i) => ({ ...c, id: c.id || `i${i}` })),
    docs: { proposal: false, contract: true },
    notes: "",
    touched: true,
    active: row.active,
    inactiveNote: row.active ? "" : `Last agreement ${p.year}`,
    salesperson: REP_NAMES[rep] || (rep ? rep.toUpperCase() : ""),
    incentives: p.incentives,
    promoNote: p.promoNote,
    importedFrom: row.file.path,
  };
}

// The dashboard customer an agreement's name refers to, or null. Matches when the
// cleaned names are equal, or one contains the other (at least 6 characters, so
// "NEW" never matches half the list).
export function matchCustomer(name, dashboardNames) {
  const k = customerKey(name);
  if (!k) return null;
  const keyed = (dashboardNames || []).map((n) => [n, customerKey(n)]);
  const exact = keyed.find(([, kk]) => kk === k);
  if (exact) return exact[0];
  const near = keyed.find(([, kk]) => kk.length >= 6 && k.length >= 6 && (kk.includes(k) || k.includes(kk)));
  return near ? near[0] : null;
}
