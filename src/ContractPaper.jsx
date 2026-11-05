// The printed side of the Contracts tab: a proposal page and a contract, set as
// A4 sheets in fixed ink-on-white. The same component renders the live preview
// and the copy that goes to the printer.

import { renderText } from "./lib/contractTemplate.js";
import { rollupByChain, tierCosts } from "./lib/contractPlan.js";
import { chainOf } from "./lib/chains.js";

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const rmFull = (v) => `RM ${Math.round(Number(v) || 0).toLocaleString("en-MY")}`;
const signed = (r) => (r == null ? "" : `${r >= 0 ? "+" : "−"}${Math.round(Math.abs(r) * 1000) / 10}%`);
const pct = (v) => `${Math.round((Number(v) || 0) * 10) / 10}%`;

export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  return `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

// Everything the clause placeholders can say, for one draft.
export function clauseVars(draft, calc) {
  const tiers = tierCosts(draft.target, draft.tiers);
  return {
    customer: draft.title || "the Customer",
    supplier: draft.supplier || "the Supplier",
    year: draft.contractYear,
    start: fmtDate(draft.startDate),
    end: fmtDate(draft.endDate),
    target: rmFull(draft.target),
    scope: draft.kind === "group" ? "all participating outlets, counted together as one total" : "all of its outlets",
    rebate_table: tiers
      .map((t) => `At ${pct(t.at * 100)} of target (${rmFull(t.sales)}): ${pct(t.pct)} additional sponsorship`)
      .join("\n"),
  };
}

export const usesRebateTable = (clauses) => (clauses || []).some((c) => /\{\{\s*rebate_table\s*\}\}/i.test(c.body || ""));

// ---------- small pieces ----------

function Mark({ on, children }) {
  return <span className={on ? "ct-mark rounded-sm bg-sheet-mark" : ""}>{children}</span>;
}

function SheetHeading({ children }) {
  return <h3 className="mb-2 mt-6 border-b border-sheet-rule pb-1 font-sheet text-[11pt] font-bold text-sheet-ink">{children}</h3>;
}

// Twelve months, last year behind this year's.
export function MonthBars({ months, prev, reported, w = 520, h = 74 }) {
  const max = Math.max(1, ...months, ...prev);
  const slot = w / 12;
  const bar = slot * 0.34;
  const y = (v) => h - 12 - (Math.max(0, v) / max) * (h - 18);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Monthly sales, this year against last year" className="block w-full">
      {months.map((v, i) => {
        const x = i * slot + slot / 2;
        return (
          <g key={i}>
            <rect x={x - bar - 0.5} y={y(prev[i])} width={bar} height={Math.max(0, h - 12 - y(prev[i]))} fill="#cdd3da" />
            {i < reported && <rect x={x + 0.5} y={y(v)} width={bar} height={Math.max(0, h - 12 - y(v))} fill="#1b2026" />}
            <text x={x} y={h - 2} textAnchor="middle" fontSize="8" fill="#566170" fontFamily="inherit">{MONTH_NAMES[i][0]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ baseYear }) {
  return (
    <p className="mt-1 flex gap-4 font-sheet text-[8.5pt] text-sheet-mute">
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-sheet-rule" />{baseYear - 1}</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-sheet-ink" />{baseYear}</span>
    </p>
  );
}

function Th({ children, right }) {
  return <th className={`border-b border-sheet-ink py-1 pr-3 text-[9pt] font-bold text-sheet-ink ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, right, bold }) {
  return <td className={`border-b border-sheet-rule py-1 pr-3 ${right ? "text-right" : ""} ${bold ? "font-bold" : ""}`}>{children}</td>;
}

export function RebateTable({ draft, hl }) {
  const rows = tierCosts(draft.target, draft.tiers);
  if (!rows.length) return <p className="text-sheet-mute">No sponsorship tiers set.</p>;
  return (
    <table className="ct-avoid w-full">
      <thead>
        <tr><Th>Reach this share of target</Th><Th right>Net sales of</Th><Th right>Additional sponsorship</Th><Th right>Sponsorship value</Th></tr>
      </thead>
      <tbody>
        {rows.map((t, i) => (
          <tr key={i}>
            <Td><Mark on={hl}>{pct(t.at * 100)}</Mark></Td>
            <Td right>{rmFull(t.sales)}</Td>
            <Td right><Mark on={hl}>{pct(t.pct)}</Mark></Td>
            <Td right bold>{rmFull(t.cost)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TargetTable({ draft, calc, hl }) {
  const q = calc.quarters;
  return (
    <table className="ct-avoid w-full">
      <thead>
        <tr><Th>Period</Th>{["Q1", "Q2", "Q3", "Q4"].map((l) => <Th key={l} right>{l}</Th>)}<Th right>{draft.contractYear} total</Th></tr>
      </thead>
      <tbody>
        <tr>
          <Td>Net purchases target</Td>
          {q.map((v, i) => <Td key={i} right><Mark on={hl.quarters}>{rmFull(v)}</Mark></Td>)}
          <Td right bold><Mark on={hl.target}>{rmFull(draft.target)}</Mark></Td>
        </tr>
      </tbody>
    </table>
  );
}

function Outlets({ draft, calc }) {
  const byChain = new Map();
  for (const n of draft.customerNames) {
    const c = chainOf(n) || chainOf(n, { loose: true });
    const k = c ? c.label : "Other outlets";
    byChain.set(k, [...(byChain.get(k) || []), n]);
  }
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[9.5pt]">
      {[...byChain].map(([label, list]) => (
        <div key={label} className="ct-avoid">
          <p className="font-bold">{label} <span className="font-normal text-sheet-mute">({list.length} outlet{list.length === 1 ? "" : "s"})</span></p>
          <p className="text-sheet-mute">{list.map((n) => n.replace(/^[^-–]*[-–]\s*/, "") || n).join(", ")}</p>
        </div>
      ))}
    </div>
  );
}

// Product incentives (RM per box) and a special promotion line, as on the signed MOUs.
function Incentives({ draft }) {
  const list = (draft.incentives || []).filter((x) => (x.item || x.value));
  if (!list.length && !draft.promoNote) return null;
  return (
    <div className="ct-avoid">
      {draft.promoNote && (
        <>
          <SheetHeading>Special promotion</SheetHeading>
          <p className="whitespace-pre-line text-[10pt]">{draft.promoNote}</p>
        </>
      )}
      {list.length > 0 && (
        <>
          <SheetHeading>Product incentive</SheetHeading>
          <table className="w-full">
            <thead><tr><Th>Product</Th><Th right>Incentive</Th></tr></thead>
            <tbody>{list.map((x, i) => <tr key={i}><Td>{x.item}</Td><Td right bold>{x.value}</Td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ---------- proposal ----------

function Stat({ label, value, note }) {
  return (
    <div>
      <p className="text-[9pt] text-sheet-mute">{label}</p>
      <p className="text-[18pt] font-bold leading-tight tracking-tight">{value}</p>
      {note && <p className="text-[8.5pt] text-sheet-mute">{note}</p>}
    </div>
  );
}

function ProposalSheet({ draft, calc, hl }) {
  const a = calc.analysis;
  const m = a?.monthsReported || 0;
  const prevMonths = calc.prevMonths;
  const chains = draft.kind === "group" && a ? rollupByChain(a.branches.filter((b) => draft.customerNames.includes(b.name))) : [];
  const through = m > 0 && m < 12 ? `${MONTH_NAMES[m - 1]} ` : "";
  return (
    <section className="ct-sheet" aria-label="Proposal">
      <header className="flex items-start justify-between border-b-2 border-sheet-ink pb-3">
        <p className="text-[13pt] font-bold tracking-tight">{draft.supplier || "Supplier"}</p>
        <p className="text-right text-[9pt] text-sheet-mute">Sales proposal<br />{fmtDate(draft.issued)}</p>
      </header>

      <h1 className="mt-6 text-[26pt] font-bold leading-[1.08] tracking-tight"><Mark on={hl.customer}>{draft.title || "Customer name"}</Mark></h1>
      <p className="mt-1 text-[12pt] text-sheet-mute">Proposal for {draft.contractYear}</p>

      {a && a.hasHistory && (
        <>
          <SheetHeading>Where {draft.baseYear} stands</SheetHeading>
          <div className="grid grid-cols-3 gap-6">
            <Stat label={`${draft.baseYear - 1} full year`} value={rmFull(a.lastYear)} />
            <Stat label={`${draft.baseYear}, ${m === 12 ? "full year" : `${m} month${m === 1 ? "" : "s"} to ${MONTH_NAMES[Math.max(0, m - 1)]}`}`} value={rmFull(a.ytd)} note={a.yoyYtd == null ? "" : `${signed(a.yoyYtd)} on the same months of ${draft.baseYear - 1}`} />
            <Stat label={m === 12 ? `${draft.baseYear} result` : `${draft.baseYear} estimated full year`} value={rmFull(a.projected)} note={m === 12 ? "" : "Projected from the months so far"} />
          </div>
          <div className="mt-3 ct-avoid">
            <MonthBars months={a.months} prev={prevMonths} reported={m} />
            <Legend baseYear={draft.baseYear} />
          </div>
          {chains.length > 0 && (
            <table className="ct-avoid mt-3 w-full">
              <thead><tr><Th>Chain</Th><Th right>Outlets</Th><Th right>{draft.baseYear - 1}</Th><Th right>{draft.baseYear} to date</Th></tr></thead>
              <tbody>
                {chains.map((c) => (
                  <tr key={c.chain.key}><Td>{c.chain.label}</Td><Td right>{c.branches}</Td><Td right>{rmFull(c.lastYear)}</Td><Td right>{rmFull(c.ytd)}</Td></tr>
                ))}
                <tr>
                  <Td bold>Group total</Td>
                  <Td right bold>{chains.reduce((s, c) => s + c.branches, 0)}</Td>
                  <Td right bold>{rmFull(chains.reduce((s, c) => s + c.lastYear, 0))}</Td>
                  <Td right bold>{rmFull(chains.reduce((s, c) => s + c.ytd, 0))}</Td>
                </tr>
              </tbody>
            </table>
          )}
        </>
      )}

      <SheetHeading>Proposed target for {draft.contractYear}</SheetHeading>
      <div className="flex items-end gap-6 ct-avoid">
        <p className="text-[26pt] font-bold leading-none tracking-tight"><Mark on={hl.target}>{rmFull(draft.target)}</Mark></p>
        {draft.growth != null && calc.base > 0 && (
          <p className="pb-1 text-[10pt] text-sheet-mute"><Mark on={hl.growth}>{signed(draft.growth)}</Mark> on {draft.baseYear} {a?.method === "actual" ? "result" : "estimate"} of {rmFull(calc.base)}</p>
        )}
      </div>
      <div className="mt-3"><TargetTable draft={draft} calc={calc} hl={hl} /></div>
      {draft.kind === "group" && <p className="mt-2 text-[9pt] text-sheet-mute">One total for {draft.customerNames.length} outlet{draft.customerNames.length === 1 ? "" : "s"} across the group. Outlets count together towards it.</p>}

      <SheetHeading>The additional sponsorship you can earn</SheetHeading>
      <RebateTable draft={draft} hl={hl.tiers} />
      <p className="mt-2 text-[9pt] text-sheet-mute">The rate for the highest tier reached applies to all net sales for {draft.contractYear}.</p>
      <Incentives draft={draft} />

      {draft.notes && <p className="mt-5 whitespace-pre-line text-[10pt]">{draft.notes}</p>}
      {a && a.hasHistory && m < 12 && (
        <p className="mt-6 border-t border-sheet-rule pt-2 text-[8.5pt] text-sheet-mute">
          {draft.baseYear} figures run to {through}{draft.baseYear} and are projected to the year end from {a.method === "own" ? "this account's own seasonal pattern" : a.method === "company" ? "the company's seasonal pattern" : "a straight-line run-rate"}. They are estimates, not commitments.
        </p>
      )}
    </section>
  );
}

// ---------- contract ----------

function ClauseBody({ text, draft, vars }) {
  return text.split("\n").map((line, i) =>
    /^\s*\{\{\s*rebate_table\s*\}\}\s*$/i.test(line)
      ? <div key={i} className="my-2"><RebateTable draft={draft} /></div>
      : <p key={i} className="mt-1 first:mt-0">{renderText(line, vars)}</p>,
  );
}

function ContractSheet({ draft, calc, hl }) {
  const vars = clauseVars(draft, calc);
  const rebateInClauses = usesRebateTable(draft.clauses);
  return (
    <section className="ct-sheet" aria-label="Contract">
      <header className="border-b-2 border-sheet-ink pb-3">
        <p className="text-[9pt] text-sheet-mute">Memorandum of understanding</p>
        <h1 className="mt-1 text-[22pt] font-bold leading-tight tracking-tight">{draft.docTitle || "Sales agreement"} {draft.contractYear}</h1>
      </header>

      <table className="mt-5 w-full text-[10pt]">
        <tbody>
          <tr className="align-top"><td className="w-28 py-1 pr-4 text-sheet-mute">Supplier</td><td className="py-1 font-bold">{draft.supplier || "—"}</td></tr>
          <tr className="align-top">
            <td className="py-1 pr-4 text-sheet-mute">Customer</td>
            <td className="py-1"><span className="font-bold"><Mark on={hl.customer}>{draft.title || "—"}</Mark></span>{draft.customerLegal && <span className="block whitespace-pre-line text-sheet-mute">{draft.customerLegal}</span>}</td>
          </tr>
          <tr className="align-top"><td className="py-1 pr-4 text-sheet-mute">Period</td><td className="py-1"><Mark on={hl.dates}>{fmtDate(draft.startDate)} to {fmtDate(draft.endDate)}</Mark></td></tr>
        </tbody>
      </table>

      <SheetHeading>Sales target</SheetHeading>
      <TargetTable draft={draft} calc={calc} hl={hl} />

      {!rebateInClauses && (
        <>
          <SheetHeading>Additional sponsorship</SheetHeading>
          <RebateTable draft={draft} hl={hl.tiers} />
        </>
      )}
      <Incentives draft={draft} />

      {draft.kind === "group" && draft.customerNames.length > 0 && (
        <>
          <SheetHeading>Participating outlets</SheetHeading>
          <Outlets draft={draft} calc={calc} />
        </>
      )}

      {draft.clauses.length > 0 && (
        <>
          <SheetHeading>Terms</SheetHeading>
          <ol>
            {draft.clauses.map((c, i) => (
              <li key={c.id} className="ct-avoid mb-3 flex gap-3">
                <span className="w-5 shrink-0 text-sheet-mute">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  {c.title && <p className="font-bold">{c.title}</p>}
                  <div className={`text-[10pt] ${hl.clauses ? "ct-mark rounded-sm bg-sheet-mark" : ""}`}><ClauseBody text={c.body || ""} draft={draft} vars={vars} /></div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="ct-avoid mt-10 grid grid-cols-3 gap-8 text-[10pt]">
        {[
          ["Authorizer's signature", draft.supplierSignatory, draft.supplierPosition, "Name"],
          ["Salesperson's signature", draft.salesperson, draft.salespersonPosition, "Name"],
          ["Business partner's signature", draft.customerSignatory, draft.customerPosition, "Person in charge"],
        ].map(([label, who, position, blank]) => (
          <div key={label}>
            <p className="text-sheet-mute">{label}</p>
            <div className="mt-12 border-t border-sheet-ink pt-1">
              <p className="font-bold">{who || blank}</p>
              <p>{position || "Position"}</p>
              <p className="mt-3 text-sheet-mute">Date</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// `focusKey` highlights, on the paper, whatever the editor field being used feeds.
export default function ContractPaper({ draft, calc, focusKey }) {
  const hl = {
    customer: focusKey === "customer",
    target: focusKey === "target",
    growth: focusKey === "growth",
    quarters: focusKey === "quarters",
    tiers: focusKey === "tiers",
    clauses: focusKey === "clauses",
    dates: focusKey === "dates",
  };
  const any = draft.docs.proposal || draft.docs.contract;
  return (
    <div className="ct-paper">
      {draft.docs.proposal && <ProposalSheet draft={draft} calc={calc} hl={hl} />}
      {draft.docs.contract && <ContractSheet draft={draft} calc={calc} hl={hl} />}
      {!any && <p className="p-6 text-center text-sm text-faint">Choose Proposal, Contract or both above to preview the pages.</p>}
    </div>
  );
}
