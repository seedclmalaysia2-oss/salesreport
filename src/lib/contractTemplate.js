// Contract wording: the default clauses, {{placeholders}}, and turning an
// uploaded Word template (.docx) or plain-text file into editable clauses.
//
// A clause is { id, title, body }. The paper numbers them itself, so a title is
// stored without its "1." prefix. Bodies may use these placeholders:
//   {{customer}} {{supplier}} {{year}} {{start}} {{end}} {{target}} {{scope}} {{rebate_table}}
// Unknown placeholders are left visible so a typo is noticed rather than hidden.

export const PLACEHOLDERS = [
  { key: "customer", hint: "Customer or group name" },
  { key: "supplier", hint: "Your company name" },
  { key: "year", hint: "Contract year" },
  { key: "start", hint: "Start date" },
  { key: "end", hint: "End date" },
  { key: "target", hint: "Annual target in RM" },
  { key: "scope", hint: "What the target covers" },
  { key: "rebate_table", hint: "The rebate ladder, one line per tier" },
];

// Starting wording. Plain and short on purpose: it is a draft to be replaced by
// the company's own template, not legal advice.
export const DEFAULT_CLAUSES = [
  { title: "Term", body: "This agreement covers {{start}} to {{end}}." },
  {
    title: "Sales target",
    body: "{{customer}} will aim to reach net purchases of {{target}} from {{supplier}} in {{year}}, covering {{scope}}, phased by quarter as set out in this agreement.",
  },
  {
    title: "Rebate",
    body: "If net purchases for {{year}} reach a tier below, a rebate at that tier's rate is earned on all net purchases for the year:\n{{rebate_table}}\nThe rebate is settled after the year-end reconciliation and does not apply to purchases that remain unpaid.",
  },
  {
    title: "Net purchases",
    body: "Net purchases means goods invoiced to {{customer}} in {{year}}, less returns and credit notes. Free-of-charge and sample items do not count towards the target.",
  },
  {
    title: "Prices and payment",
    body: "Prices and payment terms follow {{supplier}}'s prevailing price list and credit terms unless both parties agree otherwise in writing.",
  },
  {
    title: "Review",
    body: "Either party may ask to review the target during the year if supply or market conditions change materially. Any change must be agreed in writing.",
  },
  {
    title: "General",
    body: "This agreement is the whole understanding between the parties on its subject. It may be changed only in writing signed by both parties and is governed by the laws of Malaysia.",
  },
];

let uid = 0;
export const newClauseId = () => `c${Date.now().toString(36)}${(uid++).toString(36)}`;
export const defaultClauses = () => DEFAULT_CLAUSES.map((c) => ({ ...c, id: newClauseId() }));

export function renderText(text, vars) {
  return String(text ?? "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key) => {
    const v = vars?.[key.toLowerCase()];
    return v == null ? whole : String(v);
  });
}

// ----- reading a template -----

const TITLE_PREFIX = /^(?:\d+(?:\.\d+)*[.)]?|clause\s+\d+[.:)]?|article\s+\d+[.:)]?|[A-Z][.)])\s+/i;

// Word templates often hold the placeholders as [Customer Name] or <<Year>>.
export function mapTemplateVariables(text) {
  return String(text)
    .replace(/[[<]{1,2}\s*(?:customer(?: name)?|company name|buyer|client)\s*[\]>]{1,2}/gi, "{{customer}}")
    .replace(/[[<]{1,2}\s*(?:contract )?year\s*[\]>]{1,2}/gi, "{{year}}")
    .replace(/[[<]{1,2}\s*(?:annual |sales )?target\s*[\]>]{1,2}/gi, "{{target}}");
}

function looksLikeTitle(p) {
  const t = p.text;
  if (!t || t.length > 90) return false;
  if (p.heading) return true;
  if (p.bold && t.length <= 90) return true;
  if (TITLE_PREFIX.test(t) && t.length <= 80 && !/[.;,]$/.test(t) && t.split(/\s+/).length <= 10) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && t.length <= 60 && t === t.toUpperCase();
}

// paragraphs: [{ text, heading?, bold? }] -> clauses. A title starts a clause; the
// paragraphs under it become its body. Titles with no body are dropped (a
// document heading such as "SALES AGREEMENT" would otherwise become an empty clause).
export function clausesFromParagraphs(paragraphs) {
  const out = [];
  let cur = null;
  for (const p of paragraphs || []) {
    const text = mapTemplateVariables(String(p.text || "").replace(/\s+/g, " ").trim());
    if (!text) continue;
    if (looksLikeTitle({ ...p, text })) {
      cur = { title: text.replace(TITLE_PREFIX, "").replace(/[:.]$/, "").trim() || text, lines: [] };
      out.push(cur);
    } else {
      if (!cur) { cur = { title: "", lines: [] }; out.push(cur); }
      cur.lines.push(text);
    }
  }
  return out
    .filter((c) => c.lines.length)
    .map((c) => ({ id: newClauseId(), title: c.title, body: c.lines.join("\n") }));
}

const decodeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

// The paragraphs of a .docx's main document, with heading and bold hints.
export async function readDocxParagraphs(data) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("This doesn't look like a Word (.docx) file.");
  const xml = await file.async("string");
  const out = [];
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const runs = [...p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((r) => r[0]);
    let text = "";
    let bold = runs.length > 0;
    for (const r of runs) {
      const t = [...r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
        .map((x) => (x[1] != null ? decodeXml(x[1]) : " "))
        .join("");
      if (!t.trim()) continue;
      text += t;
      if (!/<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(r)) bold = false;
    }
    out.push({ text, bold: bold && !!text.trim(), heading: /<w:pStyle w:val="(?:Heading|Title)/i.test(p) });
  }
  return out;
}

// Plain text: blank-line separated blocks, one paragraph per line.
export function textParagraphs(text) {
  return String(text || "").split(/\r?\n/).map((line) => ({ text: line }));
}

// Entry point for an uploaded file. Returns
//   { kind: "clauses", clauses, source }   Word or text, read into clauses
//   { kind: "attachment", source }         PDF: kept by name only
export async function readTemplateFile(file) {
  const name = file?.name || "template";
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) {
    const clauses = clausesFromParagraphs(await readDocxParagraphs(await file.arrayBuffer()));
    if (!clauses.length) throw new Error("No clauses found in that document. Check it has text, or paste the wording in by hand.");
    return { kind: "clauses", clauses, source: name };
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    const clauses = clausesFromParagraphs(textParagraphs(await file.text()));
    if (!clauses.length) throw new Error("No clauses found in that text file.");
    return { kind: "clauses", clauses, source: name };
  }
  if (lower.endsWith(".pdf")) return { kind: "attachment", source: name };
  throw new Error("Upload a Word (.docx), text (.txt) or PDF file.");
}
