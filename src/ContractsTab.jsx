import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ContractPaper, { rmFull, MONTH_NAMES } from "./ContractPaper.jsx";
import { supabaseStore } from "./lib/contractStore.js";
import { CHAINS, chainBranches } from "./lib/chains.js";
import { rmShort, pctText, niceRound } from "./lib/contractPlan.js";
import {
  newDraft, computeCalc, rebase, setGrowth, setTarget, activeCustomers, recordFromDraft, draftFromRecord,
} from "./lib/contractDraft.js";
import { defaultClauses, readTemplateFile, readDocxParagraphs, PLACEHOLDERS, newClauseId } from "./lib/contractTemplate.js";
import { pickAgreementFiles, parseAgreement, planImport, draftFromAgreement, matchCustomer } from "./lib/agreementImport.js";
import "./contracts.css";

const inputCls =
  "w-full rounded-md border border-line bg-wash px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
const btnCls =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
const primaryCls =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const KIND_LABEL = { ecp: "Single ECP", group: "Chain group", prospect: "Prospect" };
const isActive = (r) => r.payload?.active !== false;
// A salesperson by first name ("DINO LIM" and "Dino" are the same person).
const repKey = (name) => String(name || "").trim().split(/\s+/)[0].toUpperCase();
const repLabel = (key) => (key ? key[0] + key.slice(1).toLowerCase() : "Not set");
const parseNum = (s) => {
  const t = String(s ?? "").replace(/[^0-9.\-]/g, "");
  if (t === "" || t === "-" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const whenText = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
};

// ---------- form pieces ----------

function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">{label}</label>
      {children}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

// A number box that lets you type freely and tidies up when you leave it.
function NumField({ id, value, onCommit, onFocus, prefix, suffix, decimals = 0, ariaLabel, className = "" }) {
  const fmt = (v) => (v == null || Number.isNaN(v) ? "" : Number(v).toLocaleString("en-MY", { maximumFractionDigits: decimals }));
  const [text, setText] = useState(fmt(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(fmt(value)); }, [value, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`flex w-full min-w-0 items-center rounded-md border border-line bg-wash focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent ${className}`}>
      {prefix && <span className="pl-2.5 text-xs text-faint">{prefix}</span>}
      <input
        id={id}
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        onFocus={() => { setEditing(true); onFocus?.(); }}
        onBlur={() => { setEditing(false); setText(fmt(value)); }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNum(e.target.value);
          if (n != null) onCommit(n);
        }}
        className="w-full min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-right font-metric text-sm text-ink outline-none"
      />
      {suffix && <span className="pr-2.5 text-xs text-faint">{suffix}</span>}
    </div>
  );
}

function Section({ id, title, summary, open, onToggle, children }) {
  return (
    <section className="border-t border-line first:border-t-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`ct-sec-${id}`}
          onClick={onToggle}
          className="flex w-full items-baseline gap-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="text-sm font-semibold text-ink">{title}</span>
          <span className="min-w-0 flex-1 truncate text-right font-metric text-xs text-muted">{!open && summary}</span>
          <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 self-center text-faint transition-transform ${open ? "rotate-180" : ""}`}><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </h3>
      {open && <div id={`ct-sec-${id}`} className="grid gap-4 pb-5">{children}</div>}
    </section>
  );
}

// A suggestion sits beside the thing it changes, with its reason.
function Suggestion({ label, reason, applied, onUse }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-line px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{reason}</p>
      </div>
      {applied
        ? <span className="whitespace-nowrap pt-0.5 text-xs font-semibold text-ok">In use</span>
        : <button type="button" onClick={onUse} className="whitespace-nowrap rounded-md border border-accent px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">Use this</button>}
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-metric text-base font-bold text-ink">{value}</dd>
      {note && <dd className="text-xs text-faint">{note}</dd>}
    </div>
  );
}

// ---------- finding a customer ----------

function CustomerPicker({ customers, onPick, placeholder = "Find a customer", autoFocus = false, id }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers.filter((c) => !s || c.name.toLowerCase().includes(s)).slice(0, 8);
  }, [customers, q]);
  const pick = (c) => { setQ(""); setOpen(false); onPick(c); };
  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open && matches[hi]) { e.preventDefault(); pick(matches[hi]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className={inputCls}
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line py-1 shadow-lg" style={{ background: "var(--bg)" }}>
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-faint">No customer matches “{q}”.</li>}
          {matches.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === hi}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(c); }}
                onMouseEnter={() => setHi(i)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm ${i === hi ? "bg-accent/15" : ""}`}
              >
                <span className="min-w-0 truncate text-ink">{c.name}</span>
                <span className="shrink-0 font-metric text-xs text-muted">{rmShort(c.cur || c.prev)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- the paper, scaled to fit ----------

function PaperViewport({ children }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => setScale(Math.min(1, el.clientWidth / 793.7));
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="overflow-x-hidden">
      <div style={{ zoom: scale, width: "210mm", margin: "0 auto" }}>{children}</div>
    </div>
  );
}

// ---------- the editor ----------

function Editor({ draft, setDraft, rows, customers, template, onBack, onSave, saving, dirty, canSave, notice, setNotice, setupMessage }) {
  const calc = useMemo(() => computeCalc(draft, rows), [draft, rows]);
  const a = calc.analysis;
  const [open, setOpen] = useState({ who: true, year: true, target: true, rebate: true, incentives: false, terms: false, details: false });
  const [focusKey, setFocusKey] = useState(null);
  const [pane, setPane] = useState("edit");
  const [changing, setChanging] = useState(false);
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const focus = (k) => () => setFocusKey(k);
  const m = a?.monthsReported || 0;

  const activeMap = useMemo(() => activeCustomers(rows, draft.baseYear), [rows, draft.baseYear]);
  const reps = useMemo(() => {
    const s = new Set();
    for (const n of draft.customerNames) for (const r of activeMap.get(n)?.reps || []) s.add(r);
    return [...s];
  }, [activeMap, draft.customerNames]);

  // ----- who -----
  const pickCustomer = (c) => {
    setChanging(false);
    setDraft((d) => rebase({ ...d, customerNames: [c.name], title: d.title && d.title !== d.customerNames[0] ? d.title : c.name }, rows));
  };
  const setBaseYear = (y) => setDraft((d) => {
    const cy = y + 1;
    const keep = (iso, def) => (iso === `${d.contractYear}-${def}` ? `${cy}-${def}` : iso);
    return rebase({ ...d, baseYear: y, contractYear: cy, startDate: keep(d.startDate, "01-01"), endDate: keep(d.endDate, "12-31"), quarters: null }, rows);
  });
  const branchPool = useMemo(
    () => chainBranches([...activeMap.keys()], draft.groupChains),
    [activeMap, draft.groupChains],
  );
  const setBranches = (names) => setDraft((d) => rebase({ ...d, customerNames: names }, rows));
  const toggleChain = (key) => {
    setDraft((d) => {
      const on = d.groupChains.includes(key);
      const groupChains = on ? d.groupChains.filter((k) => k !== key) : [...d.groupChains, key];
      const inChain = new Set(chainBranches([...activeMap.keys()], [key]).map((b) => b.name));
      const sure = chainBranches([...activeMap.keys()], [key]).filter((b) => b.sure).map((b) => b.name);
      const customerNames = on ? d.customerNames.filter((n) => !inChain.has(n)) : [...new Set([...d.customerNames, ...sure])];
      return rebase({ ...d, groupChains, customerNames }, rows);
    });
  };

  // ----- target -----
  const gs = calc.growthSuggestion;
  const usingGrowth = gs && draft.target === niceRound(calc.base * (1 + gs.growth), calc.base);
  const bm = calc.benchmark;
  const usingBench = bm && draft.target === bm.median;

  // ----- rebate -----
  const setTier = (i, p) => setDraft((d) => ({ ...d, touched: true, tiers: d.tiers.map((t, j) => (j === i ? { ...t, ...p } : t)) }));
  const usingTiers = JSON.stringify(draft.tiers) === JSON.stringify(calc.tierSuggestion.tiers);
  const costs = useMemo(() => draft.tiers.map((t) => ({ ...t, sales: draft.target * t.at, cost: (draft.target * t.at * t.pct) / 100 })), [draft.tiers, draft.target]);

  // ----- clauses -----
  const setClause = (i, p) => setDraft((d) => ({ ...d, clauses: d.clauses.map((c, j) => (j === i ? { ...c, ...p } : c)) }));
  const moveClause = (i, dir) => setDraft((d) => {
    const j = i + dir;
    if (j < 0 || j >= d.clauses.length) return d;
    const next = [...d.clauses];
    [next[i], next[j]] = [next[j], next[i]];
    return { ...d, clauses: next };
  });

  const summaries = {
    who: draft.title || "Not named yet",
    year: a?.hasHistory ? `${rmShort(a.ytd)} so far, ${rmShort(a.projected)} projected` : "No history",
    target: draft.target ? `${rmFull(draft.target)}${draft.growth != null ? ` (${pctText(draft.growth)})` : ""}` : "Not set",
    rebate: draft.tiers.length ? `${draft.tiers.length} tiers, up to ${Math.max(...draft.tiers.map((t) => t.pct))}%` : "None",
    terms: `${draft.clauses.length} clauses`,
    details: "Address, signatories, dates",
  };

  const editor = (
    <div className="min-w-0">
      {/* ----- who ----- */}
      <Section id="who" title="Who it's for" summary={summaries.who} open={open.who} onToggle={() => toggle("who")}>
        <Field label={draft.kind === "group" ? "Group name on the contract" : "Name on the contract"} htmlFor="ct-title">
          <input id="ct-title" className={inputCls} value={draft.title} onFocus={focus("customer")} onChange={(e) => patch({ title: e.target.value })} placeholder="Customer or group name" />
        </Field>

        {draft.kind === "ecp" && (
          <div className="grid gap-1.5">
            <p className="text-xs text-muted">
              Sales taken from <strong className="font-semibold text-ink">{draft.customerNames[0] || "—"}</strong>
              {reps.length > 0 && <> · {reps.join(", ")}</>}
            </p>
            {changing
              ? <CustomerPicker id="ct-change" customers={customers} onPick={pickCustomer} autoFocus placeholder="Find another customer" />
              : <button type="button" onClick={() => setChanging(true)} className="w-fit text-xs font-semibold text-accent underline underline-offset-2">Use a different customer's sales</button>}
          </div>
        )}

        {draft.kind === "prospect" && (
          <p className="rounded-md border border-line px-3 py-2 text-xs leading-relaxed text-muted">
            A prospect has no sales in the dashboard, so the target below starts from what new ECPs that settle in typically spend in their second year. Type the real expected volume over it when you know it.
          </p>
        )}

        {draft.kind === "group" && (
          <div className="grid gap-3">
            <p className="text-xs leading-relaxed text-muted">One total target covers every outlet ticked below. Outlets count together towards it.</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chains in the group">
              {CHAINS.map((c) => {
                const on = draft.groupChains.includes(c.key);
                const n = chainBranches([...activeMap.keys()], [c.key]).length;
                return (
                  <button key={c.key} type="button" aria-pressed={on} onClick={() => toggleChain(c.key)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:bg-wash"}`}>
                    {c.label} <span className="font-metric font-normal">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid max-h-72 grid-cols-[minmax(0,1fr)] gap-1 overflow-auto rounded-md border border-line p-2">
              {branchPool.length === 0 && <p className="p-2 text-xs text-faint">No outlets for the chosen chains had sales in {draft.baseYear - 1} or {draft.baseYear}.</p>}
              {branchPool.map((b) => {
                const checked = draft.customerNames.includes(b.name);
                const e = activeMap.get(b.name);
                return (
                  <label key={b.name} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-wash">
                    <input type="checkbox" checked={checked} onChange={() => setBranches(checked ? draft.customerNames.filter((n) => n !== b.name) : [...draft.customerNames, b.name])} className="h-4 w-4 accent-[var(--st-accent)]" />
                    <span className="min-w-0 flex-1 truncate text-ink">{b.name}{!b.sure && <span className="ml-2 text-xs text-watch">check: may not belong to {b.chain.label}</span>}</span>
                    <span className="whitespace-nowrap font-metric text-xs text-muted">{e?.cur > 0 ? rmShort(e.cur) : `${rmShort(e?.prev || 0)} in ${draft.baseYear - 1}`}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-faint">{draft.customerNames.length} outlet{draft.customerNames.length === 1 ? "" : "s"} selected.</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Results year" htmlFor="ct-base">
            <select id="ct-base" className={inputCls} value={draft.baseYear} onChange={(e) => setBaseYear(Number(e.target.value))}>
              {[...new Set([...rows.map((r) => r.year)])].sort((x, y) => y - x).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Contract year" htmlFor="ct-year">
            <input id="ct-year" className={`${inputCls} text-muted`} value={draft.contractYear} readOnly />
          </Field>
        </div>
      </Section>

      {/* ----- this year ----- */}
      <Section id="year" title={draft.kind === "prospect" ? "Track record" : `How ${draft.baseYear} is going`} summary={summaries.year} open={open.year} onToggle={() => toggle("year")}>
        {!a || !a.hasHistory ? (
          <p className="text-sm text-muted">{draft.kind === "prospect" ? "A new prospect has no sales yet." : "No sales found for this selection in the dashboard."}</p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <Stat label={`${draft.baseYear - 1} full year`} value={rmShort(a.lastYear)} />
              <Stat label={`${draft.baseYear} to ${MONTH_NAMES[Math.max(0, m - 1)].slice(0, 3)}`} value={rmShort(a.ytd)} note={a.yoyYtd == null ? "" : `${pctText(a.yoyYtd)} on same months`} />
              <Stat label={m === 12 ? "Result" : "Projected year"} value={rmShort(a.projected)} note={m === 12 ? "" : { own: "own season", company: "company season", linear: "straight line", none: "" }[a.method]} />
            </dl>
            <div className="text-ink">
              <div className="rounded-md bg-wash p-2" style={{ color: "var(--text)" }}>
                <MonthBarsThemed months={a.months} prev={calc.prevMonths} reported={a.monthsReported} />
              </div>
              <p className="mt-1 flex gap-4 text-xs text-muted"><span>▮ {draft.baseYear - 1}</span><span className="text-ink">▮ {draft.baseYear}</span></p>
            </div>
            {draft.kind === "group" && a.branches.length > 0 && (
              <div className="max-h-44 overflow-auto rounded-md border border-line">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-wash text-left text-muted"><tr><th className="px-2 py-1 font-medium">Outlet</th><th className="px-2 py-1 text-right font-medium">{draft.baseYear - 1}</th><th className="px-2 py-1 text-right font-medium">{draft.baseYear}</th></tr></thead>
                  <tbody>{a.branches.map((b) => (
                    <tr key={b.name} className="border-t border-line"><td className="break-words px-2 py-1 text-ink">{b.name}</td><td className="whitespace-nowrap px-2 py-1 text-right font-metric text-muted">{rmShort(b.lastYear)}</td><td className="whitespace-nowrap px-2 py-1 text-right font-metric text-ink">{rmShort(b.ytd)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {m > 0 && m < 12 && <p className="text-xs text-faint">Sales are reported to {MONTH_NAMES[m - 1]} {draft.baseYear}. The rest of the year is estimated.</p>}
          </>
        )}
      </Section>

      {/* ----- target ----- */}
      <Section id="target" title={`${draft.contractYear} target`} summary={summaries.target} open={open.target} onToggle={() => toggle("target")}>
        <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
          <Field label={`${draft.contractYear} target${draft.kind === "group" ? " (total for the group)" : ""}`} htmlFor="ct-target">
            <NumField id="ct-target" prefix="RM" value={draft.target} onFocus={focus("target")} onCommit={(n) => setDraft((d) => setTarget(d, rows, n))} />
          </Field>
          <Field label={calc.base > 0 ? `Growth on ${rmShort(calc.base)}` : "Growth"} htmlFor="ct-growth">
            <NumField id="ct-growth" suffix="%" decimals={1} value={draft.growth == null ? null : draft.growth * 100} onFocus={focus("growth")} onCommit={(n) => setDraft((d) => setGrowth(d, rows, n / 100))} className={calc.base > 0 ? "" : "opacity-50"} />
          </Field>
        </div>

        {gs && (
          <Suggestion
            label={`Suggested ${pctText(gs.growth)} → ${rmFull(niceRound(calc.base * (1 + gs.growth), calc.base))}`}
            reason={gs.reason}
            applied={usingGrowth}
            onUse={() => setDraft((d) => ({ ...setGrowth(d, rows, gs.growth), quarters: null }))}
          />
        )}
        {!gs && bm && (
          <Suggestion label={`Suggested opening target ${rmFull(bm.median)}`} reason={bm.reason} applied={usingBench} onUse={() => setDraft((d) => setTarget(d, rows, bm.median))} />
        )}
        {!gs && !bm && <p className="text-xs text-faint">There isn't enough history to suggest a figure. Type the target in.</p>}

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-medium text-muted">By quarter</p>
            {draft.quarters && <button type="button" onClick={() => patch({ quarters: null })} className="text-xs font-semibold text-accent underline underline-offset-2">Follow {calc.season.method === "own" ? "this customer's season" : calc.season.method === "company" ? "the company's season" : "equal quarters"}</button>}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {calc.quarters.map((q, i) => (
              <div key={i} className="grid min-w-0 gap-1">
                <span className="text-xs text-faint">Q{i + 1}</span>
                <NumField ariaLabel={`Quarter ${i + 1} target`} value={q} onFocus={focus("quarters")} onCommit={(n) => patch({ quarters: calc.quarters.map((v, j) => (j === i ? n : v)) })} />
              </div>
            ))}
          </div>
          {calc.quarterGap !== 0 && (
            <p className="text-xs text-watch">
              The quarters {calc.quarterGap > 0 ? `are ${rmFull(calc.quarterGap)} short of` : `are ${rmFull(-calc.quarterGap)} over`} the target.{" "}
              <button type="button" className="font-semibold underline underline-offset-2" onClick={() => patch({ quarters: null })}>Fit to the target</button>
            </p>
          )}
        </div>
      </Section>

      {/* ----- rebate ----- */}
      <Section id="rebate" title="Rebate tiers (additional sponsorship)" summary={summaries.rebate} open={open.rebate} onToggle={() => toggle("rebate")}>
        <p className="text-xs leading-relaxed text-muted">When a tier is reached, its rate is earned as additional sponsorship on all net sales for the period. Set each tier as a target amount in RM or as a % of the annual target; the other follows. Both are printed on the paper.</p>
        <div className="grid gap-2">
          <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_1.75rem] gap-2 text-xs text-faint"><span>Target (RM)</span><span>% of target</span><span>Rebate %</span><span className="text-right">Costs you</span><span /></div>
          {draft.tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_1.75rem] items-center gap-2">
              <NumField ariaLabel={`Tier ${i + 1} target amount`} prefix="RM" value={Math.round(draft.target * t.at)} onFocus={focus("tiers")} onCommit={(n) => draft.target > 0 && setTier(i, { at: n / draft.target })} />
              <NumField ariaLabel={`Tier ${i + 1} share of target`} suffix="%" decimals={1} value={Math.round(t.at * 1000) / 10} onFocus={focus("tiers")} onCommit={(n) => setTier(i, { at: n / 100 })} />
              <NumField ariaLabel={`Tier ${i + 1} rebate`} suffix="%" decimals={2} value={t.pct} onFocus={focus("tiers")} onCommit={(n) => setTier(i, { pct: n })} />
              <span className="text-right font-metric text-xs text-muted" title={`${rmFull(costs[i]?.sales)} of purchases`}>{rmShort(costs[i]?.cost)}</span>
              <button type="button" aria-label={`Remove tier ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, touched: true, tiers: d.tiers.filter((_, j) => j !== i) }))} className="rounded text-faint hover:text-bad focus-visible:outline-2 focus-visible:outline-accent">✕</button>
            </div>
          ))}
          <div>
            <button type="button" className={btnCls} onClick={() => setDraft((d) => {
              const last = d.tiers[d.tiers.length - 1];
              return { ...d, touched: true, tiers: [...d.tiers, { at: last ? Math.round((last.at + 0.1) * 100) / 100 : 1, pct: last ? last.pct + 1 : 1 }] };
            })}>Add a tier</button>
          </div>
        </div>
        {calc.tierWarnings.map((w) => <p key={w} className="text-xs text-watch">{w}</p>)}
        <Suggestion
          label={usingTiers ? "Starting ladder in use" : "Suggested ladder"}
          reason={`${calc.tierSuggestion.tiers.map((t) => `${Math.round(t.at * 100)}% → ${t.pct}%`).join(", ")}. ${calc.tierSuggestion.reason}`}
          applied={usingTiers}
          onUse={() => setDraft((d) => ({ ...d, tiers: calc.tierSuggestion.tiers }))}
        />
      </Section>

      {/* ----- incentives ----- */}
      <Section id="incentives" title="Product incentives and promotion" summary={draft.incentives.length ? `${draft.incentives.length} products` : "None"} open={open.incentives} onToggle={() => toggle("incentives")}>
        <p className="text-xs leading-relaxed text-muted">Optional. Per-box incentives and any special promotion, printed as on your signed memoranda.</p>
        {draft.incentives.map((x, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_1.75rem] items-center gap-2">
            <input aria-label={`Product ${i + 1}`} className={inputCls} placeholder="Product" value={x.item} onChange={(e) => patch({ incentives: draft.incentives.map((y, j) => (j === i ? { ...y, item: e.target.value } : y)) })} />
            <input aria-label={`Incentive ${i + 1}`} className={inputCls} placeholder="RM5/box" value={x.value} onChange={(e) => patch({ incentives: draft.incentives.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) })} />
            <button type="button" aria-label={`Remove product ${i + 1}`} onClick={() => patch({ incentives: draft.incentives.filter((_, j) => j !== i) })} className="rounded text-faint hover:text-bad focus-visible:outline-2 focus-visible:outline-accent">✕</button>
          </div>
        ))}
        <div><button type="button" className={btnCls} onClick={() => patch({ incentives: [...draft.incentives, { item: "", value: "" }] })}>Add a product</button></div>
        <Field label="Special promotion" hint="For example: Buy 3 free 1 (1daypure sphere)." htmlFor="ct-promo">
          <input id="ct-promo" className={inputCls} value={draft.promoNote || ""} onChange={(e) => patch({ promoNote: e.target.value })} />
        </Field>
      </Section>

      {/* ----- terms ----- */}
      <Section id="terms" title="Terms" summary={summaries.terms} open={open.terms} onToggle={() => toggle("terms")}>
        <p className="text-xs leading-relaxed text-muted">
          These become the numbered terms of the contract{template?.source ? <>, read from <strong className="font-semibold text-ink">{template.source}</strong></> : ", starting from the built-in wording"}. Placeholders fill in automatically:{" "}
          {PLACEHOLDERS.map((p, i) => <span key={p.key}><code className="rounded bg-wash px-1 font-metric text-[11px]" title={p.hint}>{`{{${p.key}}}`}</code>{i < PLACEHOLDERS.length - 1 ? " " : ""}</span>)}
        </p>
        {draft.clauses.map((c, i) => (
          <div key={c.id} className="grid gap-1.5 rounded-md border border-line p-2.5">
            <div className="flex items-center gap-2">
              <span className="w-5 text-xs text-faint">{i + 1}.</span>
              <input aria-label={`Clause ${i + 1} title`} className={`${inputCls} font-semibold`} value={c.title} onFocus={focus("clauses")} onChange={(e) => setClause(i, { title: e.target.value })} placeholder="Heading" />
              <button type="button" aria-label={`Move clause ${i + 1} up`} disabled={i === 0} onClick={() => moveClause(i, -1)} className="px-1 text-muted disabled:opacity-30">↑</button>
              <button type="button" aria-label={`Move clause ${i + 1} down`} disabled={i === draft.clauses.length - 1} onClick={() => moveClause(i, 1)} className="px-1 text-muted disabled:opacity-30">↓</button>
              <button type="button" aria-label={`Remove clause ${i + 1}`} onClick={() => patch({ clauses: draft.clauses.filter((_, j) => j !== i) })} className="px-1 text-faint hover:text-bad">✕</button>
            </div>
            <textarea aria-label={`Clause ${i + 1} wording`} rows={Math.min(8, Math.max(3, (c.body || "").split("\n").length + 1))} className={`${inputCls} leading-relaxed`} value={c.body} onFocus={focus("clauses")} onChange={(e) => setClause(i, { body: e.target.value })} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnCls} onClick={() => patch({ clauses: [...draft.clauses, { id: newClauseId(), title: "", body: "" }] })}>Add a clause</button>
          <button type="button" className={btnCls} onClick={() => { if (window.confirm("Replace these terms with the saved wording? Your edits to the terms will be lost.")) patch({ clauses: (template?.clauses || defaultClauses()).map((c) => ({ ...c, id: newClauseId() })) }); }}>Reset to saved wording</button>
        </div>
      </Section>

      {/* ----- details ----- */}
      <Section id="details" title="Details" summary={summaries.details} open={open.details} onToggle={() => toggle("details")}>
        <Field label="Your company name" htmlFor="ct-supplier"><input id="ct-supplier" className={inputCls} value={draft.supplier} onChange={(e) => patch({ supplier: e.target.value })} /></Field>
        <Field label="Customer's registered name and address" hint="Shown under the customer's name on the contract." htmlFor="ct-legal">
          <textarea id="ct-legal" rows={3} className={inputCls} value={draft.customerLegal} onChange={(e) => patch({ customerLegal: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" htmlFor="ct-start"><input id="ct-start" type="date" className={inputCls} value={draft.startDate} onFocus={focus("dates")} onChange={(e) => patch({ startDate: e.target.value })} /></Field>
          <Field label="Ends" htmlFor="ct-end"><input id="ct-end" type="date" className={inputCls} value={draft.endDate} onFocus={focus("dates")} onChange={(e) => patch({ endDate: e.target.value })} /></Field>
        </div>
        <Field label="Document title" hint="Printed as the heading of the contract, with the year." htmlFor="ct-doctitle">
          <input id="ct-doctitle" className={inputCls} value={draft.docTitle || ""} onChange={(e) => patch({ docTitle: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Authorizer" htmlFor="ct-ssig"><input id="ct-ssig" className={inputCls} value={draft.supplierSignatory} onChange={(e) => patch({ supplierSignatory: e.target.value })} /></Field>
          <Field label="Authorizer's position" htmlFor="ct-spos"><input id="ct-spos" className={inputCls} value={draft.supplierPosition || ""} onChange={(e) => patch({ supplierPosition: e.target.value })} /></Field>
          <Field label="Salesperson" htmlFor="ct-sales"><input id="ct-sales" className={inputCls} value={draft.salesperson || ""} onChange={(e) => patch({ salesperson: e.target.value })} /></Field>
          <Field label="Salesperson's position" htmlFor="ct-salespos"><input id="ct-salespos" className={inputCls} value={draft.salespersonPosition || ""} onChange={(e) => patch({ salespersonPosition: e.target.value })} /></Field>
          <Field label="Customer's person in charge" htmlFor="ct-csig"><input id="ct-csig" className={inputCls} placeholder="Filled in at signing if blank" value={draft.customerSignatory} onChange={(e) => patch({ customerSignatory: e.target.value })} /></Field>
          <Field label="Customer's position" htmlFor="ct-cpos"><input id="ct-cpos" className={inputCls} value={draft.customerPosition || ""} onChange={(e) => patch({ customerPosition: e.target.value })} /></Field>
        </div>
        <Field label="Note on the proposal" hint="Optional. Printed at the foot of the proposal page." htmlFor="ct-notes">
          <textarea id="ct-notes" rows={3} className={inputCls} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </Field>
      </Section>
    </div>
  );

  // ----- printing -----
  const printRoot = usePrintRoot();
  const [hint, setHint] = useState(false);
  const print = (pdf) => {
    if (!draft.docs.proposal && !draft.docs.contract) { setNotice({ tone: "bad", text: "Choose Proposal, Contract or both before printing." }); return; }
    const what = draft.docs.proposal && draft.docs.contract ? "Proposal and contract" : draft.docs.proposal ? "Proposal" : "Contract";
    const prevTitle = document.title;
    document.title = `${draft.title || "Customer"} – ${what} ${draft.contractYear}`;
    document.body.classList.add("ct-printing");
    const done = () => { document.title = prevTitle; document.body.classList.remove("ct-printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setHint(!!pdf);
    setTimeout(() => window.print(), 80);
  };

  const docToggle = (k, label) => (
    <button type="button" aria-pressed={draft.docs[k]} onClick={() => patch({ docs: { ...draft.docs, [k]: !draft.docs[k] } })}
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${draft.docs[k] ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:bg-wash"}`}>{label}</button>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={onBack} className="text-sm font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">← All contracts</button>
        <h2 className="min-w-0 basis-full truncate text-lg font-bold tracking-tight text-ink sm:flex-1 sm:basis-0">{draft.title || "Untitled contract"}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${draft.status === "final" ? "bg-ok/15 text-ok" : "bg-wash text-muted"}`}>{draft.status === "final" ? "Final" : "Draft"}</span>
        <div role="group" aria-label="Active or inactive" className="inline-flex overflow-hidden rounded-full border border-line text-xs font-semibold">
          {[[true, "Active"], [false, "Inactive"]].map(([v, l]) => (
            <button key={l} type="button" aria-pressed={draft.active !== false === v} onClick={() => patch({ active: v })}
              className={`px-3 py-1 ${(draft.active !== false) === v ? (v ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad") : "text-muted hover:bg-wash"}`}>{l}</button>
          ))}
        </div>
        {dirty && <span className="text-xs text-watch">Unsaved changes</span>}
        <button type="button" className={btnCls} disabled={saving || !canSave} onClick={() => onSave("draft")}>{saving ? "Saving…" : "Save draft"}</button>
        <button type="button" className={primaryCls} disabled={saving || !canSave} onClick={() => onSave("final")}>{draft.status === "final" ? "Save final" : "Mark final"}</button>
      </div>

      {draft.active === false && (
        <div role="status" className="mb-4 grid gap-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2.5 text-sm text-ink">
          <p><strong className="font-semibold">Inactive:</strong> this customer is not continuing. The contract is kept for the record and left out of the suggestions for new proposals.</p>
          <input aria-label="Why it is inactive" className={inputCls} placeholder="Why, or when it ended (optional)" value={draft.inactiveNote || ""} onChange={(e) => patch({ inactiveNote: e.target.value })} />
        </div>
      )}
      {setupMessage && <p role="status" className="mb-4 rounded-md border border-watch/40 bg-watch/10 px-3 py-2 text-sm text-ink">{setupMessage} You can still preview and print.</p>}
      {notice && (
        <p role="status" className={`mb-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${notice.tone === "bad" ? "border-bad/40 bg-bad/10" : "border-ok/40 bg-ok/10"} text-ink`}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-faint">✕</button>
        </p>
      )}

      <div className="mb-3 flex gap-1 lg:hidden" role="tablist" aria-label="Edit or preview">
        {[["edit", "Edit"], ["preview", "Preview"]].map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={pane === k} onClick={() => setPane(k)} className={`flex-1 rounded-md border px-3 py-2 text-sm font-semibold ${pane === k ? "border-accent bg-accent/15 text-accent" : "border-line text-muted"}`}>{l}</button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <div className={pane === "edit" ? "" : "hidden lg:block"}>{editor}</div>
        <div className={`${pane === "preview" ? "" : "hidden lg:block"} min-w-0`}>
          <div className="lg:sticky lg:top-2">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Pages</span>
              {docToggle("proposal", "Proposal")}
              {docToggle("contract", "Contract")}
              <span className="flex-1" />
              <button type="button" className={btnCls} onClick={() => print(false)}>Print</button>
              <button type="button" className={primaryCls} onClick={() => print(true)}>Save as PDF</button>
            </div>
            {hint && <p role="status" className="mb-3 rounded-md border border-line px-3 py-2 text-xs text-muted">In the print window, set the destination to <strong className="text-ink">Save as PDF</strong>, then save.</p>}
            <div className="rounded-lg bg-track p-3 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
              <PaperViewport><ContractPaper draft={draft} calc={calc} focusKey={focusKey} /></PaperViewport>
            </div>
          </div>
        </div>
      </div>
      {printRoot && createPortal(<ContractPaper draft={draft} calc={calc} focusKey={null} />, printRoot)}
    </div>
  );
}

// The chart in the workspace takes the dashboard's text colour; the paper's own
// copy uses fixed ink.
function MonthBarsThemed({ months, prev, reported }) {
  const w = 480, h = 70;
  const max = Math.max(1, ...months, ...prev);
  const slot = w / 12, bar = slot * 0.34;
  const y = (v) => h - 12 - (Math.max(0, v) / max) * (h - 18);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Monthly sales, this year against last year" className="block w-full">
      {months.map((v, i) => {
        const x = i * slot + slot / 2;
        return (
          <g key={i}>
            <rect x={x - bar - 0.5} y={y(prev[i])} width={bar} height={Math.max(0, h - 12 - y(prev[i]))} fill="currentColor" opacity="0.25" />
            {i < reported && <rect x={x + 0.5} y={y(v)} width={bar} height={Math.max(0, h - 12 - y(v))} fill="currentColor" />}
            <text x={x} y={h - 2} textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.6">{MONTH_NAMES[i][0]}</text>
          </g>
        );
      })}
    </svg>
  );
}

// A node at the end of <body> that the printer sees and the screen does not.
function usePrintRoot() {
  const [el, setEl] = useState(null);
  useEffect(() => {
    const node = document.createElement("div");
    node.id = "ct-print-root";
    document.body.appendChild(node);
    setEl(node);
    return () => { node.remove(); document.body.classList.remove("ct-printing"); };
  }, []);
  return el;
}

// ---------- importing the signed agreements ----------

// Reads a folder of existing agreements in the browser, shows what it found, and
// saves the ones that are ticked. Nothing is saved until "Import" is pressed.
function ImportPanel({ customers, records, template, onSave, onDone, disabled }) {
  const inputRef = useRef(null);
  const [phase, setPhase] = useState("idle"); // idle | reading | review | saving
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [found, setFound] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const chooseFolder = async (fileList) => {
    const all = [...fileList].map((f) => ({ path: f.webkitRelativePath || f.name, name: f.name, modified: f.lastModified, file: f }));
    if (!all.length) return;
    setError(null);
    setPhase("reading");
    const pick = pickAgreementFiles(all);
    setProgress({ done: 0, total: pick.chosen.length });
    const items = [];
    let unopened = 0;
    for (let i = 0; i < pick.chosen.length; i++) {
      const c = pick.chosen[i];
      try {
        const paras = await readDocxParagraphs(await c.file.arrayBuffer());
        items.push({ file: { path: c.path, name: c.name }, parsed: parseAgreement(paras, c.name, c.modified) });
      } catch { unopened += 1; }
      if (i % 10 === 0) setProgress({ done: i + 1, total: pick.chosen.length });
    }
    const plan = planImport(items, { existing: records });
    setFound({ ...pick, older: plan.older, unreadable: unopened + plan.unreadable });
    setRows(plan.rows.map((r) => ({ ...r, pick: !r.alreadySaved })));
    setPhase("review");
  };

  const chosen = rows.filter((r) => r.pick);
  const update = (i, p) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const reset = () => { setRows([]); setFound(null); setPhase("idle"); };

  const run = async () => {
    setPhase("saving");
    setError(null);
    try {
      const names = customers.map((c) => c.name);
      const clauses = (template?.clauses || defaultClauses()).map(({ title, body }) => ({ title, body }));
      const recs = chosen.map((r) => recordFromDraft(draftFromAgreement(r, { clauses, match: matchCustomer(r.parsed.customer, names) })));
      await onSave(recs);
      reset();
      onDone(`Imported ${recs.length} agreement${recs.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(e.message || String(e));
      setPhase("review");
    }
  };

  return (
    <section aria-labelledby="ct-import" className="grid max-w-4xl gap-3 border-t border-line pt-5">
      <h3 id="ct-import" className="text-sm font-semibold text-ink">Import existing agreements</h3>
      {phase === "idle" && (
        <>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Choose the SEED ECP AGREEMENT folder. Each agreement is read once: the Word file is used and its PDF copy skipped, and only the newest agreement per customer comes in. Dated 2026 or later means Active, anything older Inactive. You review the list before anything is saved.
          </p>
          <div>
            <input ref={inputRef} type="file" webkitdirectory="" directory="" multiple className="sr-only" aria-label="Choose the agreements folder" onChange={(e) => { const l = e.target.files; if (l?.length) chooseFolder(l); }} onClick={(e) => { e.target.value = ""; }} />
            <button type="button" className={btnCls} disabled={disabled} onClick={() => inputRef.current?.click()}>Choose the folder</button>
          </div>
        </>
      )}
      {phase === "reading" && <p role="status" className="text-sm text-muted">Reading agreements… {progress.done} of {progress.total}</p>}
      {error && <p role="alert" className="rounded-md border border-watch/40 bg-watch/10 px-3 py-2 text-sm text-ink">{error}</p>}
      {(phase === "review" || phase === "saving") && found && (
        <>
          <p className="text-sm leading-relaxed text-muted">
            <strong className="font-semibold text-ink">{rows.length} customers</strong> from {found.chosen.length} Word files. Left out: {found.skipped.pdfTwins} PDF copies of the same agreement, {found.older} older agreements for the same customer, {found.skipped.proposals} proposals, templates and sheets{found.pdfOnly.length ? `, and ${found.pdfOnly.length} PDF-only files that can't be read here` : ""}{found.unreadable ? `; ${found.unreadable} couldn't be opened` : ""}.
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-md border border-line">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="sticky top-0 bg-wash text-left text-xs text-muted">
                <tr><th className="w-8 px-3 py-2"><span className="sr-only">Import</span></th><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">Year</th><th className="px-3 py-2 font-medium">Salesperson</th><th className="px-3 py-2 font-medium">Read</th><th className="px-3 py-2 font-medium">Continuing</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const read = [r.parsed.tiers.length && `${r.parsed.tiers.length} tiers`, r.parsed.incentives.length && `${r.parsed.incentives.length} incentives`].filter(Boolean).join(", ");
                  return (
                    <tr key={r.file.path} className={`border-t border-line ${r.active ? "" : "opacity-70"}`}>
                      <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Import ${r.parsed.customer}`} checked={r.pick} disabled={phase === "saving"} onChange={(e) => update(i, { pick: e.target.checked })} className="h-4 w-4 accent-accent" /></td>
                      <td className="max-w-[18rem] px-3 py-1.5"><span className="block truncate text-ink" title={r.file.path}>{r.parsed.customer}</span>{r.alreadySaved && <span className="text-xs text-watch">already saved</span>}</td>
                      <td className="px-3 py-1.5 font-metric text-xs text-muted">{r.parsed.year}</td>
                      <td className="px-3 py-1.5 text-muted">{r.rep || "—"}</td>
                      <td className="px-3 py-1.5 text-xs text-muted">{read || "wording only"}</td>
                      <td className="px-3 py-1.5">
                        <button type="button" disabled={phase === "saving"} onClick={() => update(i, { active: !r.active })} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${r.active ? "border-ok/40 text-ok" : "border-bad/40 text-bad"}`}>{r.active ? "Active" : "Inactive"}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primaryCls} disabled={!chosen.length || phase === "saving"} onClick={run}>{phase === "saving" ? "Importing…" : `Import ${chosen.length} agreement${chosen.length === 1 ? "" : "s"}`}</button>
            <button type="button" className={btnCls} disabled={phase === "saving"} onClick={reset}>Cancel</button>
            <span className="text-xs text-faint">Untick any that are the same customer under another name.</span>
          </div>
        </>
      )}
    </section>
  );
}

// ---------- home ----------

function Home({ customers, baseYear, contractYear, records, listState, template, onCustomer, onGroup, onProspect, onOpen, onDelete, onSetActive, onTemplate, onResetTemplate, onImportSave, onImportDone, busy }) {
  const fileRef = useRef(null);
  // Already covered for the year, or not continuing: neither needs a new proposal.
  const contracted = useMemo(() => new Set(records.filter((r) => r.contractYear === contractYear || !isActive(r)).flatMap((r) => [r.title, ...(r.payload?.customerNames || [])]).map((n) => String(n).toLowerCase())), [records, contractYear]);
  const [salesman, setSalesman] = useState("all");
  const inRep = (keys) => salesman === "all" || keys.includes(salesman);
  const suggestions = useMemo(
    () => customers.filter((c) => c.cur > 0 && !contracted.has(c.name.toLowerCase()) && inRep([...(c.reps || [])].map(repKey))).slice(0, 6),
    [customers, contracted, salesman], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [filter, setFilter] = useState("all");
  const [activity, setActivity] = useState("active");
  // Everyone who has a contract or sells to a customer, busiest first.
  const salesmen = useMemo(() => {
    const n = new Map();
    for (const r of records) { const k = repKey(r.payload?.salesperson); n.set(k, (n.get(k) || 0) + (isActive(r) ? 1 : 0)); }
    for (const c of customers) for (const x of c.reps || []) if (!n.has(repKey(x))) n.set(repKey(x), 0);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [records, customers]);
  const [yearSel, setYearSel] = useState("all");
  const ofRep = records.filter((r) => inRep([repKey(r.payload?.salesperson)]));
  // Contract years that exist for this salesperson, newest first.
  const years = [...new Set(ofRep.map((r) => r.contractYear))].filter(Boolean).sort((a, b) => b - a);
  const yearOf = (y) => ofRep.filter((r) => r.contractYear === y).length;
  const mine = ofRep.filter((r) => yearSel === "all" || r.contractYear === yearSel);
  const nActive = mine.filter(isActive).length;
  const counts = { active: nActive, inactive: mine.length - nActive, all: mine.length };
  const shown = mine
    .filter((r) => (filter === "all" || r.kind === filter) && (activity === "all" || (activity === "active") === isActive(r)))
    .sort((a, b) => (b.contractYear || 0) - (a.contractYear || 0) || String(a.title).localeCompare(String(b.title)));
  const activeTarget = mine.filter(isActive).reduce((t, r) => t + (Number(r.payload?.target) || 0), 0);
  return (
    <div className="grid gap-8">
      <header className="max-w-2xl">
        <h2 className="text-xl font-bold tracking-tight text-ink">Sales contracts</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">Turn {baseYear} results into a {contractYear} proposal and contract. Pick who it's for; the target and rebate tiers start from the dashboard's numbers, with the reason beside each suggestion, and everything stays editable.</p>
      </header>

      {salesmen.length > 0 && (
        <section aria-labelledby="ct-by-rep" className="grid gap-2">
          <h3 id="ct-by-rep" className="text-sm font-semibold text-ink">By salesperson</h3>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by salesperson">
            <button type="button" aria-pressed={salesman === "all"} onClick={() => setSalesman("all")} className={`rounded-full border px-3 py-1 text-xs font-semibold ${salesman === "all" ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:bg-wash"}`}>Everyone</button>
            {salesmen.map(([k, n]) => (
              <button key={k || "none"} type="button" aria-pressed={salesman === k} onClick={() => setSalesman(k)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${salesman === k ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:bg-wash"}`}>{repLabel(k)} <span className="font-metric font-normal">{n}</span></button>
            ))}
          </div>
          <p className="text-xs text-faint">{salesman === "all" ? "Everyone's" : `${repLabel(salesman)}'s`} contracts: {nActive} active, {counts.inactive} inactive{activeTarget > 0 ? `, ${rmShort(activeTarget)} in active targets` : ""}.</p>
        </section>
      )}

      <section aria-labelledby="ct-start" className="grid gap-3">
        <h3 id="ct-start" className="text-sm font-semibold text-ink">Start a {contractYear} contract</h3>
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-full max-w-md"><CustomerPicker id="ct-home-pick" customers={customers} onPick={onCustomer} placeholder="Find an existing customer…" /></div>
          <button type="button" className={btnCls} onClick={onGroup}>G&A Retails group</button>
          <button type="button" className={btnCls} onClick={onProspect}>New prospect</button>
        </div>
        <p className="text-xs text-faint">Existing customer: one ECP. G&A Retails: Jac's Optometry, Dr. Specs, Mag Eyewear, Optics 81, Max Vision and Specs House on one total target.</p>
      </section>

      {suggestions.length > 0 && (
        <section aria-labelledby="ct-ready" className="grid gap-2">
          <h3 id="ct-ready" className="text-sm font-semibold text-ink">Biggest {salesman === "all" ? "" : `${repLabel(salesman)} `}accounts without a {contractYear} contract</h3>
          <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((c) => (
              <li key={c.name} style={{ background: "var(--bg)" }}>
                <button type="button" onClick={() => onCustomer(c)} className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left hover:bg-wash focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
                  <span className="min-w-0 truncate text-sm text-ink">{c.name}</span>
                  <span className="shrink-0 font-metric text-xs text-muted">{rmShort(c.cur)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ct-saved" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 id="ct-saved" className="text-sm font-semibold text-ink">Saved contracts</h3>
          <div className="flex gap-1.5" role="group" aria-label="Filter by active or inactive">
            {[["active", "Active"], ["inactive", "Inactive"], ["all", "All"]].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={activity === k} onClick={() => setActivity(k)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${activity === k ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:bg-wash"}`}>{l} <span className="font-metric font-normal">{counts[k]}</span></button>
            ))}
          </div>
          {years.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by contract year">
              <button type="button" aria-pressed={yearSel === "all"} onClick={() => setYearSel("all")} className={`rounded-full border px-3 py-1 text-xs font-semibold ${yearSel === "all" ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:bg-wash"}`}>All years</button>
              {years.map((y) => (
                <button key={y} type="button" aria-pressed={yearSel === y} onClick={() => setYearSel(y)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${yearSel === y ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:bg-wash"}`}>{y} <span className="font-metric font-normal">{yearOf(y)}</span></button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5" role="group" aria-label="Filter by type">
            {[["all", "All"], ["ecp", "Single ECP"], ["group", "Chain group"], ["prospect", "Prospect"]].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === k ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:bg-wash"}`}>{l}</button>
            ))}
          </div>
        </div>
        {listState.loading && <p className="text-sm text-faint">Loading saved contracts…</p>}
        {listState.error && <p role="alert" className="rounded-md border border-watch/40 bg-watch/10 px-3 py-2 text-sm text-ink">{listState.error}</p>}
        {!listState.loading && !listState.error && shown.length === 0 && (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{records.length ? `No ${activity === "all" ? "" : activity + " "}contracts match those filters.` : "No saved contracts yet. Start one above and save it as a draft."}</p>
        )}
        {shown.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-wash text-left text-xs text-muted">
                <tr><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Salesperson</th><th className="px-3 py-2 font-medium">Year</th><th className="px-3 py-2 text-right font-medium">Target</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Continuing</th><th className="px-3 py-2 font-medium">Updated</th><th className="px-3 py-2"><span className="sr-only">Delete</span></th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={`border-t border-line hover:bg-wash ${isActive(r) ? "" : "opacity-60"}`}>
                    <td className="max-w-[16rem] truncate px-3 py-2"><button type="button" onClick={() => onOpen(r)} className="font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent">{r.title}</button></td>
                    <td className="px-3 py-2 text-muted">{KIND_LABEL[r.kind]}</td>
                    <td className="px-3 py-2 text-muted">{r.payload?.salesperson ? repLabel(repKey(r.payload.salesperson)) : "—"}</td>
                    <td className="px-3 py-2 font-metric text-xs text-muted">{r.contractYear}</td>
                    <td className="px-3 py-2 text-right font-metric text-xs text-ink">{r.payload?.target ? rmShort(r.payload.target) : "—"}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === "final" ? "bg-ok/15 text-ok" : "bg-wash text-muted"}`}>{r.status === "final" ? "Final" : "Draft"}</span></td>
                    <td className="px-3 py-2"><button type="button" onClick={() => onSetActive(r, !isActive(r))} title={isActive(r) ? "Mark as not continuing" : "Mark as continuing again"} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-accent ${isActive(r) ? "border-ok/40 text-ok hover:bg-ok/10" : "border-bad/40 text-bad hover:bg-bad/10"}`}>{isActive(r) ? "Active" : "Inactive"}</button></td>
                    <td className="px-3 py-2 text-xs text-muted">{whenText(r.updatedAt)}</td>
                    <td className="px-3 py-2 text-right"><button type="button" aria-label={`Delete ${r.title}`} onClick={() => onDelete(r)} className="text-faint hover:text-bad focus-visible:outline-2 focus-visible:outline-accent">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ImportPanel customers={customers} records={records} template={template} onSave={onImportSave} onDone={onImportDone} disabled={!!listState.setup} />

      <section aria-labelledby="ct-wording" className="grid max-w-2xl gap-2 border-t border-line pt-5">
        <h3 id="ct-wording" className="text-sm font-semibold text-ink">Contract wording</h3>
        <p className="text-sm leading-relaxed text-muted">
          {template?.source
            ? <>New contracts use the terms read from <strong className="font-semibold text-ink">{template.source}</strong>.</>
            : "New contracts use the built-in starting terms. Upload your own contract as a Word file and its clauses become the terms."}
          {" "}A PDF can't be read into clauses here; save it as Word first.
        </p>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".docx,.txt,.md,.pdf" className="sr-only" aria-label="Upload contract template" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onTemplate(f); }} />
          <button type="button" className={btnCls} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Reading…" : "Upload a template"}</button>
          {template?.source && <button type="button" className={btnCls} onClick={onResetTemplate}>Use built-in terms</button>}
        </div>
      </section>
    </div>
  );
}

// ---------- the tab ----------

export default function ContractsTab({ data, year, user, tk, store = supabaseStore }) {
  const rows = useMemo(() => (data?.customers || []).filter((r) => r && r.customer), [data]);
  const baseYear = year;
  const contractYear = baseYear + 1;
  const customers = useMemo(
    () => [...activeCustomers(rows, baseYear).values()]
      .filter((c) => !chainBranches([c.name]).some((b) => b.sure))
      .sort((a, b) => (b.cur || b.prev) - (a.cur || a.prev)),
    [rows, baseYear],
  );

  const [records, setRecords] = useState([]);
  const [listState, setListState] = useState({ loading: true, error: null, setup: false });
  const [template, setTemplate] = useState(null);
  const [draft, setDraft] = useState(null);
  const [savedJson, setSavedJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  // One editing session = one Editor instance, so saving (which assigns an id) doesn't reset the panes.
  const [session, setSession] = useState(0);

  const reload = useCallback(async () => {
    setListState((s) => ({ ...s, loading: true }));
    try {
      setRecords(await store.list());
      setListState({ loading: false, error: null, setup: false });
    } catch (e) {
      setListState({ loading: false, error: e.message || String(e), setup: !!e.setup });
    }
  }, [store]);

  useEffect(() => {
    reload();
    store.getTemplate().then((t) => t?.clauses?.length && setTemplate(t)).catch(() => {});
  }, [reload, store]);

  const clauses = () => (template?.clauses || defaultClauses()).map((c) => ({ ...c, id: newClauseId() }));
  const start = (kind, name = "") => {
    const d = newDraft({ kind, name, rows, baseYear, clauses: clauses() });
    setDraft(d);
    setSavedJson("");
    setNotice(null);
    setSession((n) => n + 1);
  };
  const open = (rec) => {
    const d = draftFromRecord(rec);
    setDraft(d);
    setSavedJson(JSON.stringify(d));
    setNotice(null);
    setSession((n) => n + 1);
  };
  const dirty = !!draft && JSON.stringify(draft) !== savedJson;
  const back = () => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    setDraft(null);
  };

  const save = async (status) => {
    setSaving(true);
    setNotice(null);
    try {
      const next = { ...draft, status };
      const rec = await store.save(recordFromDraft(next));
      const saved = { ...next, id: rec.id };
      setDraft(saved);
      setSavedJson(JSON.stringify(saved));
      setNotice({ tone: "ok", text: status === "final" ? "Marked final and saved." : "Draft saved." });
      reload();
    } catch (e) {
      setNotice({ tone: "bad", text: e.message || String(e) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rec) => {
    if (!window.confirm(`Delete the ${rec.contractYear} contract for ${rec.title}? This can't be undone.`)) return;
    try { await store.remove(rec.id); await reload(); } catch (e) { setListState((s) => ({ ...s, error: e.message || String(e) })); }
  };

  // Flip a saved contract between active and inactive without opening it.
  const setActive = async (rec, active) => {
    try {
      await store.save({ ...rec, payload: { ...rec.payload, active } });
      await reload();
    } catch (e) {
      setListState((s) => ({ ...s, error: e.message || String(e) }));
    }
  };

  const uploadTemplate = async (file) => {
    setBusy(true);
    try {
      const r = await readTemplateFile(file);
      if (r.kind === "attachment") {
        setListState((s) => ({ ...s, error: "A PDF can't be read into clauses here. Save it as a Word (.docx) file and upload that, or paste its wording into a contract's Terms." }));
        return;
      }
      const t = { clauses: r.clauses, source: r.source };
      await store.saveTemplate(t);
      setTemplate(t);
      setListState((s) => ({ ...s, error: null }));
      setNotice({ tone: "ok", text: `Read ${r.clauses.length} clauses from ${r.source}. New contracts will use them.` });
    } catch (e) {
      setListState((s) => ({ ...s, error: e.message || String(e) }));
    } finally {
      setBusy(false);
    }
  };
  const resetTemplate = async () => {
    try { await store.saveTemplate({ clauses: defaultClauses().map(({ title, body }) => ({ title, body })), source: null }); } catch { /* the built-in terms apply either way */ }
    setTemplate(null);
  };

  return (
    <div className="ct-root mx-auto w-full max-w-[1400px] px-1 pb-10 text-ink">
      {draft ? (
        <Editor
          key={session}
          draft={draft}
          setDraft={setDraft}
          rows={rows}
          customers={customers}
          template={template}
          onBack={back}
          onSave={save}
          saving={saving}
          dirty={dirty}
          canSave={!listState.setup}
          notice={notice}
          setNotice={setNotice}
          setupMessage={listState.setup ? listState.error : null}
        />
      ) : (
        <>
          {notice && (
            <p role="status" className={`mb-4 rounded-md border px-3 py-2 text-sm text-ink ${notice.tone === "bad" ? "border-bad/40 bg-bad/10" : "border-ok/40 bg-ok/10"}`}>{notice.text}</p>
          )}
          <Home
            customers={customers}
            baseYear={baseYear}
            contractYear={contractYear}
            records={records}
            listState={listState}
            template={template}
            busy={busy}
            onCustomer={(c) => start("ecp", c.name)}
            onGroup={() => start("group")}
            onProspect={() => start("prospect")}
            onOpen={open}
            onDelete={remove}
            onSetActive={setActive}
            onTemplate={uploadTemplate}
            onResetTemplate={resetTemplate}
            onImportSave={async (recs) => { await store.saveMany(recs); await reload(); }}
            onImportDone={(text) => setNotice({ tone: "ok", text })}
          />
        </>
      )}
    </div>
  );
}
