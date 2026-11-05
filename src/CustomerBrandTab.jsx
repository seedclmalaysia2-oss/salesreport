import { useMemo, useState } from "react";
import { buildCustomerBrand, pairKey, TOP_BRAND_COLOURS } from "./lib/customerBrand.js";
import "./customerbrand.css";

// Customer x Brand, rebuilt around the two questions people actually ask:
//   "What does each customer buy?"  -> one stacked bar per customer, split by brand
//   "Who buys each brand?"          -> one bar per brand, with its biggest customers
// plus a compact grid for anyone who wants the raw customer-by-brand numbers.
// Revenue and quantity are one switch instead of two near-identical tables.

const PAGE = 15;
const GRID_CUSTOMERS = 12;
const GRID_BRANDS = 8;
const OTHER = "rgba(var(--tint), 0.28)";

const money = (v) => `RM ${Math.round(v || 0).toLocaleString("en-MY")}`;
const moneyShort = (v) => {
  const n = v || 0;
  if (Math.abs(n) >= 1e6) return `RM ${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `RM ${Math.round(n / 1e3)}K`;
  return money(n);
};
const units = (v) => Math.round(v || 0).toLocaleString("en-MY");
const pct = (v) => {
  const p = v * 100;
  return p > 0 && p < 0.1 ? "<0.1%" : `${p.toFixed(p >= 10 ? 0 : 1)}%`;
};
const plural = (n, word) => `${n.toLocaleString("en-MY")} ${word}${n === 1 ? "" : "s"}`;

function Pills({ label, value, options, onPick }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="w-24 shrink-0 text-sm text-muted">{label}</span>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onPick(key)}
          className={`cursor-pointer rounded-full px-4 py-1.5 font-metric text-xs font-semibold outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${
            value === key ? "bg-accent text-white" : "bg-wash text-muted hover:text-ink"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Legend({ brands, colour }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      {brands.map((b) => (
        <li key={b} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: colour(b) }} />
          {b}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: OTHER }} />
        All other
      </li>
    </ul>
  );
}

export default function CustomerBrandTab({ rows, year, years, setYear, selectedSP, setSelectedSP, salespeople, noun, toggle, palette }) {
  const [view, setView] = useState("customers"); // customers | brands | grid
  const [metric, setMetric] = useState("amt"); // amt | qty
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState(null);
  const [showAll, setShowAll] = useState(false); // expanded row: every line, not just the first 10

  const nounLc = noun.toLowerCase();
  const isAmt = metric === "amt";
  const fmt = isAmt ? moneyShort : units;
  const fmtFull = isAmt ? money : (v) => `${units(v)} units`;

  const rollup = useMemo(() => buildCustomerBrand(rows, year, selectedSP, metric), [rows, year, selectedSP, metric]);
  const scopeLabel = selectedSP === "All" ? "All Teams" : selectedSP;

  const colourOf = useMemo(() => {
    const m = new Map(rollup.topBrands.map((b, i) => [b, palette[i % palette.length]]));
    return (b) => m.get(b) || OTHER;
  }, [rollup, palette]);

  const reset = () => { setShown(PAGE); setOpen(null); setShowAll(false); };
  const set = (fn) => (v) => { fn(v); reset(); };

  const q = search.trim().toLowerCase();
  const customers = useMemo(() => rollup.customers.filter((c) => !q || c.customer.toLowerCase().includes(q)), [rollup, q]);
  const brands = useMemo(() => rollup.brands.filter((b) => !q || b.brand.toLowerCase().includes(q)), [rollup, q]);

  const top10 = rollup.customers.slice(0, 10).reduce((a, c) => a + c.total, 0);
  const topBrand = rollup.brands[0];
  const empty = rollup.customers.length === 0;

  const list = view === "customers" ? customers : brands;
  const maxBrand = brands.length ? brands[0].total : 0;

  const gridCustomers = rollup.customers.slice(0, GRID_CUSTOMERS);
  const gridBrands = rollup.brands.slice(0, GRID_BRANDS);
  const gridMax = useMemo(() => {
    let mx = 0;
    for (const c of gridCustomers) for (const b of gridBrands) {
      const e = rollup.pair.get(pairKey(c.customer, b.brand));
      if (e && e[metric] > mx) mx = e[metric];
    }
    return mx;
  }, [gridCustomers, gridBrands, rollup, metric]);

  return (
    <div className="cb-root space-y-6 text-ink">
      <div className="space-y-3">
        <Pills label="Year" value={year} options={years.map((y) => [y, String(y)])} onPick={(y) => { setYear(y); reset(); }} />
        <Pills label="Salesperson" value={selectedSP} options={[["All", "All Teams"], ...salespeople.map((s) => [s, s])]} onPick={set(setSelectedSP)} />
        <Pills label="Show" value={metric} options={[["amt", "Revenue"], ["qty", "Quantity"]]} onPick={set(setMetric)} />
        {toggle}
      </div>

      <header className="max-w-3xl">
        <h2 className="text-xl font-bold leading-snug tracking-tight text-ink">
          {empty
            ? `No ${nounLc} sales for ${scopeLabel} in ${year}`
            : `${isAmt ? moneyShort(rollup.total) : `${units(rollup.total)} units`} across ${plural(rollup.customers.length, "customer")} and ${plural(rollup.brands.length, nounLc)} in ${year}`}
        </h2>
        {!empty && (
          <p className="mt-1 text-sm leading-relaxed text-muted">
            The 10 biggest customers account for {pct(rollup.total > 0 ? top10 / rollup.total : 0)} of {isAmt ? "sales" : "units"}.
            {topBrand ? ` ${topBrand.brand} is the biggest ${nounLc} at ${pct(topBrand.share)}.` : ""}
          </p>
        )}
      </header>

      {empty ? (
        <p className="rounded-lg border border-line px-4 py-10 text-center text-sm text-muted">
          Nothing to show. Choose another year or salesperson.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="View">
              {[
                ["customers", "What each customer buys"],
                ["brands", `Who buys each ${nounLc}`],
                ["grid", "Grid"],
              ].map(([key, text]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => { setView(key); reset(); }}
                  className={`cursor-pointer rounded-lg px-3.5 py-2 text-sm font-semibold outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${
                    view === key ? "bg-wash text-ink ring-1 ring-accent" : "text-muted hover:bg-wash hover:text-ink"
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
            {view !== "grid" && (
              <input
                type="search"
                value={search}
                onChange={(e) => { setSearch(e.target.value); reset(); }}
                placeholder={view === "customers" ? "Search customer" : `Search ${nounLc}`}
                aria-label={view === "customers" ? "Search customer" : `Search ${nounLc}`}
                className="w-full rounded-lg border border-line bg-wash px-3 py-2 text-sm text-ink placeholder:text-faint outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent sm:w-60"
              />
            )}
          </div>

          {view === "customers" && (
            <>
              <p className="text-sm text-muted">
                Each bar is one customer's {isAmt ? "revenue" : "units"}, split by {nounLc}. Click a customer for the exact figures.
              </p>
              <Legend brands={rollup.topBrands} colour={colourOf} />
            </>
          )}
          {view === "brands" && (
            <p className="text-sm text-muted">
              Each bar is one {nounLc}'s total {isAmt ? "revenue" : "units"}, ranked. Click one to see which customers buy it.
            </p>
          )}

          {view !== "grid" && (
            list.length === 0 ? (
              <p className="rounded-lg border border-line px-4 py-8 text-center text-sm text-muted">Nothing matches “{search.trim()}”.</p>
            ) : (
              <ol className="border-t border-line">
                {list.slice(0, shown).map((item) => {
                  const id = view === "customers" ? item.customer : item.brand;
                  const expanded = open === id;
                  const rank = rollup[view === "customers" ? "customers" : "brands"].indexOf(item) + 1;
                  const lead = view === "customers"
                    ? item.brands.slice(0, 2).map((b) => `${b.brand} ${pct(b.share)}`).join(" · ")
                    : `${plural(item.customers.length, "customer")}${item.customers[0] ? ` · biggest: ${item.customers[0].customer} (${pct(item.customers[0].share)})` : ""}`;
                  return (
                    <li key={id} className="border-b border-line">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => { setOpen(expanded ? null : id); setShowAll(false); }}
                        className={`grid w-full cursor-pointer grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-3 text-left outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-accent ${expanded ? "bg-wash" : "hover:bg-wash"}`}
                      >
                        <span className="pt-0.5 font-metric text-xs tabular-nums text-faint">#{rank}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">{id}</span>
                          {view === "customers" ? (
                            <span aria-hidden="true" className="mt-2 flex h-3 overflow-hidden rounded-sm bg-track">
                              {item.brands.map((b, bi) =>
                                bi < TOP_BRAND_COLOURS && rollup.topBrands.includes(b.brand) ? (
                                  <span key={b.brand} className="h-full border-r border-[var(--bg)]" title={`${b.brand}: ${fmtFull(b.value)} (${pct(b.share)})`} style={{ width: `${b.share * 100}%`, background: colourOf(b.brand) }} />
                                ) : null
                              )}
                              <span className="h-full flex-1" style={{ background: OTHER }} />
                            </span>
                          ) : (
                            <span aria-hidden="true" className="mt-2 block h-3 rounded-sm bg-track">
                              <span className="block h-full rounded-sm bg-accent" style={{ width: `${maxBrand > 0 ? (item.total / maxBrand) * 100 : 0}%` }} />
                            </span>
                          )}
                          <span className="mt-1.5 block truncate text-xs text-muted">{lead}</span>
                        </span>
                        <span className="text-right">
                          <span className="block font-metric text-sm font-semibold tabular-nums text-ink">{isAmt ? money(item.total) : `${units(item.total)} units`}</span>
                          <span className="block text-xs text-muted">{pct(item.share)} of {view === "customers" ? "all" : "total"}</span>
                        </span>
                      </button>

                      {expanded && (
                        <div className="bg-wash px-3 pb-4 pt-1 sm:px-5">
                          <ul className="space-y-2.5">
                            {(view === "customers" ? item.brands : item.customers).slice(0, showAll ? undefined : 10).map((x) => {
                              const name = view === "customers" ? x.brand : x.customer;
                              return (
                                <li key={name}>
                                  <div className="flex items-baseline justify-between gap-3 text-sm">
                                    <span className="inline-flex min-w-0 items-center gap-2 text-ink">
                                      {view === "customers" && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colourOf(name) }} />}
                                      <span className="truncate">{name}</span>
                                    </span>
                                    <span className="shrink-0 font-metric text-xs tabular-nums text-ink">
                                      {fmtFull(x.value)}
                                      <span className="font-sans text-muted"> · {pct(x.share)}</span>
                                      <span className="font-sans text-muted"> · {isAmt ? `${units(x.qty)} units` : money(x.amt)}</span>
                                    </span>
                                  </div>
                                  <div aria-hidden="true" className="mt-1 h-1.5 rounded-full bg-track">
                                    <div className="h-full rounded-full" style={{ width: `${x.share * 100}%`, background: view === "customers" ? colourOf(name) : "var(--st-accent)" }} />
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                          {(view === "customers" ? item.brands : item.customers).length > 10 && (
                            <button
                              type="button"
                              onClick={() => setShowAll((v) => !v)}
                              className="mt-3 cursor-pointer text-xs text-info underline underline-offset-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
                            >
                              {showAll ? "Show top 10 only" : `Show all ${(view === "customers" ? item.brands : item.customers).length}`}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )
          )}

          {view !== "grid" && list.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="w-full cursor-pointer rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink outline-offset-2 hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent"
            >
              Show {Math.min(PAGE, list.length - shown)} more of {(list.length - shown).toLocaleString("en-MY")} remaining
            </button>
          )}

          {view === "grid" && (
            <>
              <p className="text-sm text-muted">
                The {gridCustomers.length} biggest customers against the {gridBrands.length} biggest {nounLc}s. A darker cell means more {isAmt ? "revenue" : "units"}; a dash means none.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="sticky left-0 z-10 bg-[var(--bg)] px-3 py-2 text-left align-bottom text-xs font-semibold text-muted">Customer</th>
                      {gridBrands.map((b) => (
                        <th key={b.brand} scope="col" className="w-24 px-1.5 py-2 text-right align-bottom text-xs font-semibold leading-tight text-muted">
                          <span className="block break-words">{b.brand}</span>
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2 text-right align-bottom text-xs font-semibold text-muted">All {nounLc}s</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridCustomers.map((c) => (
                      <tr key={c.customer}>
                        <th scope="row" className="sticky left-0 z-10 max-w-[14rem] truncate border-t border-line bg-[var(--bg)] px-3 py-2 text-left text-sm font-semibold text-ink">{c.customer}</th>
                        {gridBrands.map((b) => {
                          const e = rollup.pair.get(pairKey(c.customer, b.brand));
                          const v = e ? e[metric] : 0;
                          const t = gridMax > 0 && v > 0 ? v / gridMax : 0;
                          return (
                            <td
                              key={b.brand}
                              title={`${c.customer} × ${b.brand}\n${money(e?.amt)} · ${units(e?.qty)} units`}
                              className="border-t border-line px-1.5 py-2 text-right font-metric text-xs tabular-nums text-ink"
                              style={{ background: t > 0 ? `color-mix(in srgb, var(--st-accent) ${(8 + t * 42).toFixed(0)}%, transparent)` : "transparent" }}
                            >
                              {v > 0 ? (isAmt ? moneyShort(v).replace("RM ", "") : units(v)) : <span className="text-faint">–</span>}
                            </td>
                          );
                        })}
                        <td className="border-t border-line px-3 py-2 text-right font-metric text-xs font-semibold tabular-nums text-ink">{isAmt ? moneyShort(c.total).replace("RM ", "") : units(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" className="sticky left-0 z-10 border-t border-line bg-[var(--bg)] px-3 py-2 text-left text-xs font-semibold text-muted">Total, all customers</th>
                      {gridBrands.map((b) => (
                        <td key={b.brand} className="border-t border-line px-1.5 py-2 text-right font-metric text-xs font-semibold tabular-nums text-ink">{isAmt ? moneyShort(b.total).replace("RM ", "") : units(b.total)}</td>
                      ))}
                      <td className="border-t border-line px-3 py-2 text-right font-metric text-xs font-semibold tabular-nums text-ink">{isAmt ? moneyShort(rollup.total).replace("RM ", "") : units(rollup.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-muted">Amounts in RM; K = thousand, M = million. Hover a cell for revenue and units together.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
