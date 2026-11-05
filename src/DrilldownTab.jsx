import { useMemo, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TIERS, buildTierRanking } from "./lib/customerTiers.js";
import "./drilldown.css";

// Customer drill-down: who the yearly revenue comes from, grouped into the
// RM 100K / 80K / 60K / 50K / 40K / 30K / 20K / 10K / 6K / 3K bands. The tier
// ladder is the page's one memorable element; picking a rung filters the ranked
// list, and a customer expands in place into their detail.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAGE = 25;

const money = (v) => `RM ${Math.round(v || 0).toLocaleString("en-MY")}`;
const moneyShort = (v) => {
  const n = v || 0;
  if (Math.abs(n) >= 1e6) return `RM ${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `RM ${Math.round(n / 1e3)}K`;
  return money(n);
};
const axisMoney = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : `${Math.round(v)}`);
const pct = (v) => {
  const p = v * 100;
  return p > 0 && p < 0.1 ? "<0.1%" : `${p.toFixed(p >= 10 ? 0 : 1)}%`;
};
const plural = (n, word) => `${n.toLocaleString("en-MY")} ${word}${n === 1 ? "" : "s"}`;

function Change({ now, before }) {
  if (before == null) return <span className="text-muted">New this year</span>;
  if (before <= 0) return <span className="text-muted">No sales last year</span>;
  const c = (now - before) / before;
  const up = c >= 0;
  return (
    <span className={up ? "text-ok" : "text-bad"}>
      {up ? "▲" : "▼"} {Math.abs(c * 100).toFixed(0)}% on last year
    </span>
  );
}

// One rung of the ladder.
function TierRung({ tier, scale, active, onPick, reduceMotion }) {
  const empty = tier.count === 0;
  return (
    <li>
      <button
        type="button"
        disabled={empty}
        aria-pressed={active}
        onClick={onPick}
        className={`grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5 text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${
          active ? "bg-wash ring-1 ring-accent" : empty ? "opacity-45" : "hover:bg-wash"
        } ${empty ? "cursor-default" : "cursor-pointer"}`}
      >
        <span className="text-sm font-semibold text-ink">{tier.label}</span>
        <span className="font-metric text-sm tabular-nums text-ink">
          {tier.count.toLocaleString("en-MY")} <span className="font-sans text-xs text-muted">{tier.count === 1 ? "customer" : "customers"}</span>
        </span>
        <span aria-hidden="true" className="col-span-2 h-2 rounded-full bg-track">
          <span
            className={`block h-full rounded-full bg-accent ${reduceMotion ? "" : "transition-[width] duration-500"}`}
            style={{ width: `${scale > 0 ? Math.max(tier.share / scale, tier.count ? 0.015 : 0) * 100 : 0}%` }}
          />
        </span>
        <span className="col-span-2 flex justify-between gap-3 text-xs text-muted">
          <span>
            {moneyShort(tier.revenue)} · {pct(tier.share)} of sales
          </span>
          <span>{pct(tier.cumulative)} running total</span>
        </span>
      </button>
    </li>
  );
}

function Detail({ c, year, scopeLabel, data, scopeSp, brandsLoading, tk, colors, reduceMotion }) {
  // This customer's months (this year vs last) and yearly totals, within the same
  // salesperson scope as the ranking so every figure on screen agrees.
  const { monthly, yearly, brands } = useMemo(() => {
    const rows = (data.customers || []).filter((r) => r.customer === c.customer && (scopeSp === "All" || r.sp === scopeSp));
    const thisYear = new Array(12).fill(0);
    const lastYear = new Array(12).fill(0);
    const perYear = new Map();
    for (const r of rows) {
      perYear.set(r.year, (perYear.get(r.year) || 0) + (Number(r.total) || 0));
      const target = r.year === year ? thisYear : r.year === year - 1 ? lastYear : null;
      if (target) for (let m = 0; m < 12; m++) target[m] += Number(r.months?.[m]) || 0;
    }
    const brandMap = new Map();
    for (const r of data.brandSales || []) {
      if (r.customer !== c.customer || r.year !== year || (scopeSp !== "All" && r.sp !== scopeSp)) continue;
      const e = brandMap.get(r.brand) || { brand: r.brand, amt: 0, qty: 0 };
      e.amt += Number(r.amt) || 0;
      e.qty += Number(r.qty) || 0;
      brandMap.set(r.brand, e);
    }
    return {
      monthly: MONTHS.map((m, i) => ({ month: m, [year]: thisYear[i], [year - 1]: lastYear[i] })),
      yearly: (data.years || []).map((y) => ({ year: String(y), total: perYear.get(y) || 0 })),
      brands: [...brandMap.values()].filter((b) => b.amt > 0).sort((a, b) => b.amt - a.amt).slice(0, 8),
    };
  }, [c.customer, data, year, scopeSp]);

  const tooltipStyle = { background: tk.tooltipBg, border: `1px solid ${tk.tooltipBorder}`, borderRadius: 8, fontSize: 12, color: tk.tooltipText };
  const brandMax = brands.length ? brands[0].amt : 0;

  return (
    <div className="space-y-6 bg-wash px-3 py-5 sm:px-5">
      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <div>
          <dt className="text-muted">Rank {scopeLabel === "All Teams" ? "overall" : `for ${scopeLabel}`}</dt>
          <dd className="font-metric tabular-nums text-ink">#{c.rank}</dd>
        </div>
        <div>
          <dt className="text-muted">Band</dt>
          <dd className="text-ink">{TIERS[c.tier].label}</dd>
        </div>
        <div>
          <dt className="text-muted">Share of {year} sales</dt>
          <dd className="font-metric tabular-nums text-ink">{pct(c.share)}</dd>
        </div>
        <div>
          <dt className="text-muted">Served by</dt>
          <dd className="flex flex-wrap gap-x-3 text-ink">
            {c.sps.map((sp) => (
              <span key={sp} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: colors[sp] || "#888" }} />
                {sp}
              </span>
            ))}
          </dd>
        </div>
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h4 className="mb-2 text-sm font-semibold text-ink">Month by month</h4>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
              <XAxis dataKey="month" tick={{ fill: tk.chartTickFill, fontSize: 11 }} axisLine={false} />
              <YAxis tick={{ fill: tk.chartTickFill, fontSize: 11 }} axisLine={false} tickFormatter={axisMoney} width={44} />
              <Tooltip formatter={(v, name) => [money(v), name]} contentStyle={tooltipStyle} labelStyle={{ color: tk.text, fontWeight: 600 }} itemStyle={{ color: tk.tooltipText }} />
              <Line isAnimationActive={!reduceMotion} type="monotone" dataKey={year - 1} name={String(year - 1)} stroke="rgba(148,163,184,0.9)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} />
              <Line isAnimationActive={!reduceMotion} type="monotone" dataKey={year} name={String(year)} stroke="var(--st-accent)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-1 flex gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 bg-accent" />{year}</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t-2 border-dashed border-faint" />{year - 1}</span>
          </p>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-ink">Revenue each year</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={yearly}>
              <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
              <XAxis dataKey="year" tick={{ fill: tk.chartTickFill, fontSize: 11 }} axisLine={false} />
              <YAxis tick={{ fill: tk.chartTickFill, fontSize: 11 }} axisLine={false} tickFormatter={axisMoney} width={44} />
              <Tooltip formatter={(v) => [money(v), "Revenue"]} contentStyle={tooltipStyle} labelStyle={{ color: tk.text, fontWeight: 600 }} itemStyle={{ color: tk.tooltipText }} />
              <Bar isAnimationActive={!reduceMotion} dataKey="total" fill="var(--st-accent)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-ink">What they bought in {year}</h4>
        {brands.length === 0 ? (
          <p className="text-sm text-muted">
            {brandsLoading ? "Loading brand sales…" : `No brand sales recorded for this customer in ${year}.`}
          </p>
        ) : (
          <ul className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
            {brands.map((b) => (
              <li key={b.brand}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-ink">{b.brand}</span>
                  <span className="shrink-0 font-metric text-xs tabular-nums text-ink">
                    {money(b.amt)}
                    {b.qty > 0 && <span className="font-sans text-muted"> · {Math.round(b.qty).toLocaleString("en-MY")} units</span>}
                  </span>
                </div>
                <div aria-hidden="true" className="mt-1 h-1.5 rounded-full bg-track">
                  <div className="h-full rounded-full bg-info" style={{ width: `${(b.amt / brandMax) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function DrilldownTab({ data, year, selectedSP, setSelectedSP, salespeople, colors, brandsLoading, tk, reduceMotion }) {
  const [tier, setTier] = useState(null); // index into TIERS, or null for everyone
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null); // expanded customer name
  const [shown, setShown] = useState(PAGE);

  const ranking = useMemo(() => buildTierRanking(data.customers, year, selectedSP), [data, year, selectedSP]);
  const scopeLabel = selectedSP === "All" ? "All Teams" : selectedSP;
  const maxShare = Math.max(0, ...ranking.tiers.map((t) => t.share));

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ranking.customers.filter((c) => (tier == null || c.tier === tier) && (!q || c.customer.toLowerCase().includes(q)));
  }, [ranking, tier, search]);

  const top = ranking.tiers[0];
  const biggest = ranking.customers[0];
  const topMax = list.length ? list[0].total : 0;

  const pickTier = (idx) => { setTier((cur) => (cur === idx ? null : idx)); setShown(PAGE); setOpen(null); };
  const pickSP = (sp) => { setSelectedSP(sp); setTier(null); setShown(PAGE); setOpen(null); };

  return (
    <div className="dd-root space-y-6 text-ink">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Salesperson">
        <span className="mr-1 text-sm text-muted">Salesperson</span>
        {["All", ...salespeople].map((sp) => {
          const active = selectedSP === sp;
          return (
            <button
              key={sp}
              type="button"
              aria-pressed={active}
              onClick={() => pickSP(sp)}
              className={`cursor-pointer rounded-full px-4 py-1.5 font-metric text-xs font-semibold outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${
                active ? "bg-accent text-white" : "bg-wash text-muted hover:text-ink"
              }`}
            >
              {sp === "All" ? "All Teams" : sp}
            </button>
          );
        })}
      </div>

      <header className="max-w-3xl">
        <h2 className="text-xl font-bold leading-snug tracking-tight text-ink">
          {ranking.customers.length === 0
            ? `No customer sales for ${scopeLabel} in ${year}`
            : `${moneyShort(ranking.total)} from ${plural(ranking.customers.length, "customer")} in ${year}`}
        </h2>
        {ranking.customers.length > 0 && (
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {top.count > 0
              ? `${plural(top.count, "customer")} at RM 100K or more bring ${pct(top.share)} of ${scopeLabel === "All Teams" ? "all sales" : `${scopeLabel}'s sales`}. `
              : `No customer reached RM 100K; the largest is ${biggest.customer} at ${money(biggest.total)}. `}
            Pick a band to see who is in it.
            {ranking.unranked > 0 && ` ${plural(ranking.unranked, "customer")} netted zero or less after credit notes and are not ranked.`}
          </p>
        )}
      </header>

      {ranking.customers.length === 0 ? (
        <p className="rounded-lg border border-line px-4 py-10 text-center text-sm text-muted">
          Nothing to rank. Choose another year at the top, or another salesperson.
        </p>
      ) : (
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <section aria-labelledby="ladder-title" className="xl:sticky xl:top-4">
            <h3 id="ladder-title" className="mb-2 px-3 text-sm font-semibold text-ink">
              Sales by customer size
            </h3>
            <ul className="space-y-0.5">
              {ranking.tiers.map((t) => (
                <TierRung key={t.idx} tier={t} scale={maxShare} active={tier === t.idx} onPick={() => pickTier(t.idx)} reduceMotion={reduceMotion} />
              ))}
            </ul>
          </section>

          <section aria-labelledby="list-title" className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h3 id="list-title" className="text-sm font-semibold text-ink">
                {tier == null ? "All customers" : TIERS[tier].label}
                <span className="ml-2 font-normal text-muted">{plural(list.length, "customer")}</span>
                {tier != null && (
                  <button type="button" onClick={() => pickTier(tier)} className="ml-3 cursor-pointer text-xs font-normal text-info underline underline-offset-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent">
                    Show all bands
                  </button>
                )}
              </h3>
              <input
                type="search"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }}
                placeholder="Search customer"
                aria-label="Search customer"
                className="w-full rounded-lg border border-line bg-wash px-3 py-2 text-sm text-ink placeholder:text-faint outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent sm:w-60"
              />
            </div>

            {list.length === 0 ? (
              <p className="rounded-lg border border-line px-4 py-8 text-center text-sm text-muted">No customer matches “{search.trim()}” in this band.</p>
            ) : (
              <ol className="border-t border-line">
                {list.slice(0, shown).map((c) => {
                  const expanded = open === c.customer;
                  return (
                    <li key={c.customer} className="border-b border-line">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : c.customer)}
                        className={`grid w-full cursor-pointer grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-3 text-left outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-accent ${expanded ? "bg-wash" : "hover:bg-wash"}`}
                      >
                        <span className="pt-0.5 font-metric text-xs tabular-nums text-faint">#{c.rank}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">{c.customer}</span>
                          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                            <span>{TIERS[c.tier].label}</span>
                            <span>{pct(c.share)} of sales</span>
                            <Change now={c.total} before={c.prev} />
                          </span>
                        </span>
                        <span className="text-right font-metric text-sm font-semibold tabular-nums text-ink">{money(c.total)}</span>
                        <span aria-hidden="true" className="col-span-3 mt-2 h-1 rounded-full bg-track">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${topMax > 0 ? (c.total / topMax) * 100 : 0}%` }} />
                        </span>
                      </button>
                      {expanded && (
                        <Detail c={c} year={year} scopeLabel={scopeLabel} scopeSp={selectedSP} data={data} brandsLoading={brandsLoading} tk={tk} colors={colors} reduceMotion={reduceMotion} />
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {list.length > shown && (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="mt-3 w-full cursor-pointer rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink outline-offset-2 hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent"
              >
                Show {Math.min(PAGE, list.length - shown)} more of {(list.length - shown).toLocaleString("en-MY")} remaining
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
