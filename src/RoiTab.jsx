import { useMemo, useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from "recharts";
import { buildStoreRoi, sortByPriority, ROI_CONFIG, VERDICTS, VERDICT_ORDER } from "./lib/roi.js";
import "./roi.css";

const METER_MAX = ROI_CONFIG.allowance * 2; // the allowance tick sits mid-track
const PAGE = 30;
const allowancePct = Math.round(ROI_CONFIG.allowance * 100);

const VERDICT_STYLE = {
  review:   { text: "text-bad",    bg: "bg-bad",    chart: "var(--st-bad)" },
  coach:    { text: "text-watch",  bg: "bg-watch",  chart: "var(--st-watch)" },
  grow:     { text: "text-ok",     bg: "bg-ok",     chart: "var(--st-ok)" },
  untapped: { text: "text-info",   bg: "bg-info",   chart: "var(--st-info)" },
  keep:     { text: "text-muted",  bg: "bg-steady", chart: "rgba(var(--tint),0.45)" },
  small:    { text: "text-faint",  bg: "bg-idle",   chart: "rgba(var(--tint),0.22)" },
};

const SORTS = {
  priority: { label: "Needs action first" },
  sales:    { label: "Sales",  by: s => s.sales },
  usage:    { label: "Sales Trial use", by: s => (Number.isFinite(s.usage) ? s.usage : 9) },
  roi:      { label: "Return", by: s => s.roi ?? -1 },
  growth:   { label: "Trend",  by: s => s.growth ?? -9 },
};

const money = (v) => `RM ${Math.round(v || 0).toLocaleString("en-MY")}`;
const moneyShort = (v) => {
  const n = v || 0;
  if (Math.abs(n) >= 1e6) return `RM ${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `RM ${Math.round(n / 1e3)}K`;
  return money(n);
};
const boxes = (v) => Math.round(v || 0).toLocaleString("en-MY");
const usageText = (u) => (Number.isFinite(u) ? `${(u * 100).toFixed(1)}%` : "No net sales");
const roiText = (s) => (s.roi == null ? "—" : `RM ${s.roi.toFixed(1)}`);
const trendText = (g) => (g == null ? "New" : `${g >= 0 ? "+" : "−"}${Math.round(Math.abs(g) * 100)}%`);
const trendClass = (g) => (g == null ? "text-faint" : g >= ROI_CONFIG.growing ? "text-ok" : g <= ROI_CONFIG.falling ? "text-bad" : "text-muted");
const usageClass = (u) => (u > ROI_CONFIG.allowance * ROI_CONFIG.reviewMultiple ? "bg-bad" : u > ROI_CONFIG.allowance ? "bg-watch" : "bg-ok");

// The page's one recurring mark: trial use against the allowance tick.
function Meter({ usage, tall = false }) {
  const pct = Number.isFinite(usage) ? Math.min(usage / METER_MAX, 1) * 100 : 100;
  return (
    <div
      role="img"
      aria-label={`Sales Trial use ${usageText(usage)}, allowance ${allowancePct}%`}
      className={`relative w-full rounded-full bg-track ${tall ? "h-3" : "h-1.5"}`}
    >
      <div className={`h-full rounded-full ${usageClass(usage)}`} style={{ width: `${pct}%` }} />
      <div className={`absolute left-1/2 w-0.5 -translate-x-1/2 bg-ink ${tall ? "-top-1 h-5" : "-top-0.5 h-2.5"}`} />
    </div>
  );
}

function VerdictTag({ verdict }) {
  const st = VERDICT_STYLE[verdict];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold ${st.text}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${st.bg}`} />
      {VERDICTS[verdict].label}
    </span>
  );
}

function Fact({ label, value, note }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 mt-1 font-metric text-lg font-bold leading-tight text-ink sm:text-xl">{value}</dd>
      {note && <dd className="m-0 mt-0.5 text-xs text-faint">{note}</dd>}
    </div>
  );
}

// The two ways trial lenses go out. Only Sales Trial is in the dashboard's data,
// so PRM Trial gets its own open section rather than being folded into a total.
function TrialSections({ totals, costAvailable }) {
  return (
    <section aria-label="Trial lens use" className="grid grid-cols-1 gap-3 md:grid-cols-[3fr_2fr]">
      <div className="rounded-xl border border-solid border-line p-4">
        <h3 className="m-0 text-base font-bold text-ink">Sales Trial <span className="font-normal text-muted">(tie in goods)</span></h3>
        <p className="m-0 mt-1 text-xs leading-snug text-muted">Sent together with the invoice. Every figure on this page is based on this.</p>
        <div className="mb-3 mt-4 flex flex-wrap items-baseline gap-x-2">
          <span className="font-metric text-3xl font-bold leading-none text-ink">{usageText(totals.usage)}</span>
          <span className="text-sm text-muted">{`of boxes sold, against a ${allowancePct}% allowance`}</span>
        </div>
        <Meter usage={totals.usage} tall />
        <dl className="m-0 mt-4 grid grid-cols-3 gap-3">
          <Fact label="Boxes" value={boxes(totals.trialBoxes)} />
          <Fact label="Pieces" value={boxes(totals.trialPieces)} />
          <Fact label="Cost" value={costAvailable ? moneyShort(totals.trialCost) : "Pending"} />
        </dl>
      </div>
      <div className="rounded-xl border border-dashed border-faint p-4">
        <h3 className="m-0 text-base font-bold text-ink">PRM Trial <span className="font-normal text-muted">(tie in PRM)</span></h3>
        <p className="m-0 mt-1 text-xs leading-snug text-muted">Issued on PRM documents, outside sales.</p>
        <p className="m-0 mt-4 font-metric text-xl font-bold leading-tight text-muted">Not captured</p>
        <p className="m-0 mt-2 text-xs leading-relaxed text-muted">It isn't in the sales data, so it's left out of this page. A store's total trial lens use is higher wherever PRM Trial was also given.</p>
      </div>
    </section>
  );
}

function Headline({ result, scopeName }) {
  const { totals, segments, year, costAvailable } = result;
  const review = segments.review.stores;
  const lead = totals.roi != null
    ? `Every RM 1 of Sales Trial lenses earned ${scopeName} RM ${totals.roi.toFixed(2)} in gross profit in ${year}.`
    : `${scopeName} used ${(totals.usage * 100).toFixed(1)}% in Sales Trial lenses in ${year}, against a ${allowancePct}% allowance.`;
  const follow = review === 0
    ? "No store needs a review right now."
    : costAvailable
      ? `${review} ${review === 1 ? "store needs" : "stores need"} a review, and ${money(totals.overCost)} of Sales Trial went over allowance.`
      : `${review} ${review === 1 ? "store needs" : "stores need"} a review, with ${boxes(totals.overBoxes)} Sales Trial boxes over allowance.`;
  return (
    <div className="max-w-3xl">
      <h2 className="m-0 text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl">{lead}</h2>
      <p className="m-0 mt-2 text-sm leading-relaxed text-muted sm:text-base">{follow}</p>
    </div>
  );
}

// Proportional strip of stores by verdict, doubling as the list's filter.
function VerdictStrip({ result, active, onPick }) {
  const total = result.stores.length || 1;
  return (
    <section aria-label="Stores by verdict">
      <div aria-hidden="true" className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {VERDICT_ORDER.filter(v => result.segments[v].stores > 0).map(v => (
          <div
            key={v}
            className={`${VERDICT_STYLE[v].bg} ${active && active !== v ? "opacity-30" : ""}`}
            style={{ width: `${(result.segments[v].stores / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {VERDICT_ORDER.map(v => {
          const seg = result.segments[v];
          const on = active === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              disabled={seg.stores === 0}
              onClick={() => onPick(on ? null : v)}
              className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-solid p-3 text-left font-[inherit] text-ink disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-accent bg-track" : "border-line bg-transparent"}`}
            >
              <span className="min-w-0">
                <VerdictTag verdict={v} />
                <span className="mt-1 block text-xs leading-snug text-muted">{VERDICTS[v].action}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-metric text-lg font-bold leading-none">{seg.stores}</span>
                <span className="mt-1 block text-xs text-faint">{moneyShort(seg.sales)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StoreDetail({ store, history, costAvailable }) {
  const showCost = costAvailable;
  return (
    <div className="border-0 border-t border-solid border-line px-3 pb-4 pt-3 md:px-4">
      <p className="m-0 max-w-3xl text-sm leading-relaxed text-ink">{store.advice}</p>
      {store.costPartial && (
        <p className="m-0 mt-1 text-xs text-faint">Return leaves out products with no cost on record.</p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-xs">
          <caption className="pb-2 text-left text-sm font-semibold text-ink">{`By product, ${store.year} (Sales Trial only)`}</caption>
          <thead>
            <tr className="text-right text-muted">
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">Product</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Boxes sold</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Sales Trial pieces</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Sales Trial boxes</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Sales Trial use</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Free boxes</th>
              {showCost && <th scope="col" className="py-1.5 pl-2 font-medium">Sales Trial cost</th>}
            </tr>
          </thead>
          <tbody className="font-metric">
            {store.lines.map(l => (
              <tr key={l.key} className="border-0 border-t border-solid border-line text-right text-ink">
                <th scope="row" className="py-1.5 pr-2 text-left font-sans font-medium">{l.label}</th>
                <td className="px-2 py-1.5">{boxes(l.sold)}</td>
                <td className="px-2 py-1.5">{boxes(l.pieces)}</td>
                <td className="px-2 py-1.5">{l.trialBoxes.toFixed(1)}</td>
                <td className={`px-2 py-1.5 ${l.usage > ROI_CONFIG.allowance ? "text-watch" : ""}`}>{usageText(l.usage)}</td>
                <td className="px-2 py-1.5">{boxes(l.freeBoxes)}</td>
                {showCost && <td className="py-1.5 pl-2">{l.trialCost == null ? "No cost" : money(l.trialCost)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history.length > 1 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[22rem] border-collapse text-xs">
            <caption className="pb-2 text-left text-sm font-semibold text-ink">Year by year</caption>
            <thead>
              <tr className="text-right text-muted">
                <th scope="col" className="py-1.5 pr-2 text-left font-medium">Year</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Sales</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Boxes sold</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Sales Trial use</th>
                {showCost && <th scope="col" className="py-1.5 pl-2 font-medium">Return per RM 1</th>}
              </tr>
            </thead>
            <tbody className="font-metric">
              {history.map(h => (
                <tr key={h.year} className="border-0 border-t border-solid border-line text-right text-ink">
                  <th scope="row" className="py-1.5 pr-2 text-left font-medium">{h.year}</th>
                  <td className="px-2 py-1.5">{money(h.sales)}</td>
                  <td className="px-2 py-1.5">{boxes(h.boxes)}</td>
                  <td className="px-2 py-1.5">{usageText(h.usage)}</td>
                  {showCost && <td className="py-1.5 pl-2">{roiText(h)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const LIST_COLUMNS = "md:grid md:grid-cols-[minmax(0,2.4fr)_5.5rem_6rem_minmax(7rem,1.3fr)_5rem_4rem] md:items-center md:gap-3";

function StoreRow({ store, open, onToggle, history, costAvailable, showRep }) {
  return (
    <li className="border-0 border-t border-solid border-line first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`block w-full cursor-pointer border-0 p-3 text-left font-[inherit] text-ink md:px-4 ${open ? "bg-wash" : "bg-transparent"}`}
      >
        <span className={LIST_COLUMNS}>
          <span className="block min-w-0">
            <span className="block truncate text-sm font-semibold">{store.customer}</span>
            {showRep && store.sp && <span className="block text-xs text-faint">{store.sp}</span>}
          </span>
          <span className="mt-1 block md:mt-0"><VerdictTag verdict={store.verdict} /></span>
          <span className="mt-2 hidden font-metric text-sm md:mt-0 md:block md:text-right">{moneyShort(store.sales)}</span>
          <span className="mt-2 block md:mt-0">
            <span className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-muted md:hidden">Sales Trial use</span>
              <span className="font-metric font-bold">{usageText(store.usage)}</span>
            </span>
            <Meter usage={store.usage} />
          </span>
          <span className="mt-2 flex justify-between gap-4 text-xs md:contents">
            <span className="font-metric md:hidden">{moneyShort(store.sales)}</span>
            <span className="font-metric md:text-right md:text-sm">
              <span className="font-sans text-muted md:hidden">Return </span>{roiText(store)}
            </span>
            <span className={`font-metric md:text-right md:text-sm ${trendClass(store.growth)}`}>{trendText(store.growth)}</span>
          </span>
        </span>
        {!open && <span className="mt-2 block max-w-3xl text-xs leading-snug text-muted">{store.advice}</span>}
      </button>
      {open && <StoreDetail store={store} history={history} costAvailable={costAvailable} />}
    </li>
  );
}

function StoreMap({ stores, onOpen, tk }) {
  const points = stores
    .filter(s => s.verdict !== "small" && s.growth != null && Number.isFinite(s.usage))
    .map(s => ({
      x: Math.min(s.usage * 100, 80),
      y: Math.max(Math.min(s.growth * 100, 100), -100),
      z: s.sales,
      name: s.customer, verdict: s.verdict, usage: s.usage, growth: s.growth, sales: s.sales,
    }));
  if (points.length < 3) return null;
  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
      <div style={{ background: tk.tooltipBg, border: `1px solid ${tk.tooltipBorder}`, color: tk.tooltipText, borderRadius: 8, padding: "8px 10px", fontSize: 12, maxWidth: 240 }}>
        <div style={{ fontWeight: 600, color: tk.text }}>{p.name}</div>
        <div>{`${usageText(p.usage)} Sales Trial use, ${trendText(p.growth)} sales, ${moneyShort(p.sales)}`}</div>
      </div>
    );
  };
  return (
    <section className="rounded-xl border border-solid border-line p-3 md:p-4">
      <h3 className="m-0 text-sm font-semibold text-ink">Where each store sits</h3>
      <p className="m-0 mt-1 text-xs leading-snug text-muted">
        Right of the line is over allowance. Top right is paying for itself, bottom right needs attention. Tap a dot to open the store.
      </p>
      <div className="mt-3 h-72 md:h-96">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, bottom: 18, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
            <XAxis type="number" dataKey="x" domain={[0, 80]} tickFormatter={v => `${v}%`} tick={{ fill: tk.chartTickFill, fontSize: 11 }} axisLine={false}
              label={{ value: "Sales Trial use", position: "insideBottom", offset: -10, fill: tk.chartTickFill, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" domain={[-100, 100]} tickFormatter={v => `${v}%`} tick={{ fill: tk.chartTickFill, fontSize: 11 }} axisLine={false} width={48}
              label={{ value: "Sales trend", angle: -90, position: "insideLeft", offset: 12, fill: tk.chartTickFill, fontSize: 11 }} />
            <ZAxis type="number" dataKey="z" range={[24, 260]} />
            <ReferenceLine x={allowancePct} stroke={tk.text} strokeDasharray="4 3" />
            <ReferenceLine y={0} stroke={tk.chartTickFill} />
            <Tooltip content={tip} cursor={false} />
            <Scatter data={points} isAnimationActive={false} onClick={(p) => onOpen(p.name)} cursor="pointer">
              {points.map((p, i) => <Cell key={i} fill={VERDICT_STYLE[p.verdict].chart} fillOpacity={0.75} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function RepTable({ reps, onPick, costAvailable }) {
  return (
    <section className="rounded-xl border border-solid border-line p-3 md:p-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <caption className="pb-2 text-left text-sm font-semibold text-ink">By salesperson</caption>
          <thead>
            <tr className="text-right text-xs text-muted">
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">Salesperson</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Stores</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Sales</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Sales Trial use</th>
              {costAvailable && <th scope="col" className="px-2 py-1.5 font-medium">Return per RM 1</th>}
              <th scope="col" className="py-1.5 pl-2 font-medium">To review</th>
            </tr>
          </thead>
          <tbody className="font-metric">
            {reps.map(r => (
              <tr key={r.sp} className="border-0 border-t border-solid border-line text-right text-ink">
                <th scope="row" className="py-1 pr-2 text-left font-sans font-medium">
                  <button type="button" onClick={() => onPick(r.sp)} className="cursor-pointer border-0 bg-transparent p-1 pl-0 font-[inherit] text-sm font-medium text-accent">{r.sp}</button>
                </th>
                <td className="px-2 py-1">{r.stores}</td>
                <td className="px-2 py-1">{moneyShort(r.sales)}</td>
                <td className={`px-2 py-1 ${r.usage > ROI_CONFIG.allowance ? "text-watch" : ""}`}>{usageText(r.usage)}</td>
                {costAvailable && <td className="px-2 py-1">{roiText(r)}</td>}
                <td className="py-1 pl-2">{r.review}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function RoiTab({ data, year, user, tk }) {
  const groupRows = data.groupRows || [];
  const customers = data.customers || [];
  const costRows = data.productCosts || [];

  // Admins see everyone. Everyone else sees their own stores and any reps they manage.
  const isAdmin = !!user?.isAdmin;
  const scopes = useMemo(() => {
    const present = new Set(groupRows.filter(r => r.year === year && r.sp).map(r => r.sp));
    if (isAdmin) return ["All", ...(data.salespeople || []).filter(sp => present.has(sp))];
    return [user?.sp, ...(user?.managedSps || [])].filter(Boolean).filter((sp, i, a) => a.indexOf(sp) === i);
  }, [groupRows, year, isAdmin, user, data.salespeople]);

  const [scopePick, setScopePick] = useState(null);
  const scope = scopes.includes(scopePick) ? scopePick : scopes[0];
  const sp = scope === "All" ? null : scope;

  const [verdict, setVerdict] = useState(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("priority");
  const [limit, setLimit] = useState(PAGE);
  const [openStore, setOpenStore] = useState(null);

  const result = useMemo(
    () => (scope ? buildStoreRoi({ groupRows, customers, costRows, year, sp }) : null),
    [groupRows, customers, costRows, year, sp, scope],
  );

  const historyYears = useMemo(
    () => [...new Set(groupRows.map(r => r.year))].filter(y => y <= year).sort((a, b) => b - a),
    [groupRows, year],
  );
  const historyByYear = useMemo(() => {
    if (!openStore) return [];
    return historyYears.map(y => buildStoreRoi({ groupRows, customers, costRows, year: y, sp }))
      .map(r => ({ year: r.year, store: r.stores.find(s => s.customer === openStore) }))
      .filter(r => r.store)
      .map(r => ({ year: r.year, sales: r.store.sales, boxes: r.store.boxes, usage: r.store.usage, roi: r.store.roi }));
  }, [openStore, historyYears, groupRows, customers, costRows, sp]);

  const reps = useMemo(() => {
    if (sp !== null || !result) return [];
    return scopes.filter(s => s !== "All").map(rep => {
      const r = buildStoreRoi({ groupRows, customers, costRows, year, sp: rep });
      return { sp: rep, stores: r.stores.length, sales: r.totals.sales, usage: r.totals.usage, roi: r.totals.roi, review: r.segments.review.stores };
    }).sort((a, b) => b.sales - a.sales);
  }, [scopes, sp, result, groupRows, customers, costRows, year]);

  const list = useMemo(() => {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    const shown = result.stores.filter(s =>
      (!verdict || s.verdict === verdict) && (!q || s.customer.toLowerCase().includes(q)));
    if (sort === "priority") return sortByPriority(shown);
    const by = SORTS[sort].by;
    return [...shown].sort((a, b) => by(b) - by(a));
  }, [result, verdict, search, sort]);

  const resetList = () => { setLimit(PAGE); setOpenStore(null); };

  const groupFile = (data.dataFiles || []).filter(f => f.kind === "group" && f.year === year).sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))[0];
  const scopeName = sp || "the team";

  if (!scope || !result || result.stores.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-8 text-center">
        <h2 className="m-0 text-lg font-bold text-ink">{`No store figures for ${year} yet`}</h2>
        <p className="m-0 mt-2 text-sm text-muted">
          This page reads the {`Stock Sales Analysis - Summary ${year}`} file. Upload it in the Data tab, or pick another year above.
        </p>
      </div>
    );
  }

  const { totals, costAvailable } = result;

  return (
    <div className="flex flex-col gap-6 text-ink">
      {scopes.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Choose salesperson">
          {scopes.map(s => (
            <button
              key={s}
              type="button"
              aria-pressed={s === scope}
              onClick={() => { setScopePick(s); resetList(); }}
              className={`cursor-pointer rounded-full border-0 px-3 py-1.5 font-[inherit] text-xs font-semibold ${s === scope ? "bg-accent text-white" : "bg-track text-muted"}`}
            >
              {s === "All" ? "All teams" : s}
            </button>
          ))}
        </div>
      )}

      <Headline result={result} scopeName={scopeName} />

      <TrialSections totals={totals} costAvailable={costAvailable} />

      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Fact label="Sales" value={moneyShort(totals.sales)} note={`${result.stores.length} stores`} />
        <Fact label="Lens boxes sold" value={boxes(totals.boxes)} />
        <Fact label="Return per RM 1" value={totals.roi != null ? `RM ${totals.roi.toFixed(2)}` : "Cost pending"} note="Gross profit on lenses" />
      </dl>

      {!costAvailable && (
        <p role="status" className="m-0 rounded-lg border border-solid border-watch p-3 text-sm leading-relaxed text-ink">
          Cost pending: RM figures appear after an admin runs migration 0023 and uploads the latest Stock Detail file again. Sales Trial use below is already correct, and a few verdicts may change once return is known.
        </p>
      )}

      <VerdictStrip result={result} active={verdict} onPick={(v) => { setVerdict(v); resetList(); }} />

      <section aria-label="Stores">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="m-0 mr-auto text-sm font-semibold">
            {verdict ? `${VERDICTS[verdict].label} stores` : "All stores"} <span className="font-normal text-muted">{`(${list.length})`}</span>
          </h3>
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetList(); }}
            placeholder="Find a store"
            aria-label="Find a store"
            className="box-border w-full rounded-lg border border-solid border-line bg-transparent px-3 py-2 font-[inherit] text-sm text-ink sm:w-56"
          />
          <label className="flex items-center gap-2 text-xs text-muted md:hidden">
            Sort by
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-lg border border-solid border-line bg-transparent px-2 py-2 font-[inherit] text-sm text-ink"
            >
              {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k} style={{ color: "#111" }}>{s.label}</option>)}
            </select>
          </label>
        </div>

        <div className="overflow-hidden rounded-xl border border-solid border-line">
          <div className={`hidden border-0 border-b border-solid border-line px-4 py-2 text-xs text-muted ${LIST_COLUMNS}`}>
            {[["priority", "Store", ""], [null, "Verdict", ""], ["sales", "Sales", "text-right"], ["usage", "Sales Trial use", ""], ["roi", "Return per RM 1", "text-right"], ["growth", "Trend", "text-right"]].map(([key, label, align]) => (
              key ? (
                <button
                  key={label}
                  type="button"
                  aria-pressed={sort === key}
                  onClick={() => setSort(key)}
                  className={`cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-xs ${align || "text-left"} ${sort === key ? "font-semibold text-accent" : "text-muted"}`}
                >
                  {label}
                </button>
              ) : <span key={label}>{label}</span>
            ))}
          </div>
          {list.length === 0 ? (
            <p className="m-0 p-6 text-center text-sm text-muted">No stores match. Clear the search or pick another verdict.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {list.slice(0, limit).map(s => (
                <StoreRow
                  key={s.customer}
                  store={{ ...s, year }}
                  open={openStore === s.customer}
                  onToggle={() => setOpenStore(openStore === s.customer ? null : s.customer)}
                  history={openStore === s.customer ? historyByYear : []}
                  costAvailable={costAvailable}
                  showRep={sp === null}
                />
              ))}
            </ul>
          )}
        </div>
        {list.length > limit && (
          <button
            type="button"
            onClick={() => setLimit(limit + PAGE)}
            className="mt-3 w-full cursor-pointer rounded-lg border border-solid border-line bg-transparent py-2.5 font-[inherit] text-sm font-medium text-ink"
          >
            {`Show ${Math.min(PAGE, list.length - limit)} more of ${list.length - limit} left`}
          </button>
        )}
      </section>

      <StoreMap
        stores={result.stores}
        tk={tk}
        onOpen={(name) => { setVerdict(null); setSearch(name); setLimit(PAGE); setOpenStore(name); }}
      />

      {reps.length > 1 && <RepTable reps={reps} costAvailable={costAvailable} onPick={(rep) => { setScopePick(rep); resetList(); }} />}

      <details className="rounded-xl border border-solid border-line p-3 text-sm md:p-4">
        <summary className="cursor-pointer font-semibold text-ink">How this is worked out</summary>
        <ul className="m-0 mt-3 flex list-disc flex-col gap-2 pl-5 leading-relaxed text-muted">
          <li>Sales Trial use is Sales Trial boxes divided by lens boxes sold. Pieces become boxes using each product's pack size. Free promo boxes are shown per product, but don't count as trial lenses.</li>
          <li>{`The allowance is ${allowancePct}%, set from what a typical store actually uses. Above ${Math.round(ROI_CONFIG.allowance * ROI_CONFIG.reviewMultiple * 100)}% is always a Review.`}</li>
          <li>Sales Trial cost uses each product's average cost per box from the Stock Detail file. Return is gross profit on lenses sold, per RM 1 of Sales Trial cost.</li>
          <li>{`Trend compares ${result.months === 12 ? "the full year" : `January to the latest month (${result.months} months)`} with the same months last year, so a part-year is fair. "New" means no sales last year.`}</li>
          <li>PRM Trial isn't included, because it's issued outside sales and isn't in the dashboard's data.</li>
          {groupFile?.uploadedAt && <li>{`Product and Sales Trial figures come from the ${year} Summary file uploaded on ${new Date(groupFile.uploadedAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}.`}</li>}
          {isAdmin && result.unknownCodes.length > 0 && (
            <li>{`Product codes not recognised, so counted in sales only: ${result.unknownCodes.map(u => u.code).join(", ")}.`}</li>
          )}
        </ul>
      </details>
    </div>
  );
}
