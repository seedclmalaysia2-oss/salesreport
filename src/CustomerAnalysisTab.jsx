import { useEffect, useMemo, useState } from "react";
import "./customeranalysis.css";
import { supabase } from "./lib/supabase.js";
import { ALL_EX_HOUSE, HOUSE_SP, scopeName } from "./lib/teamScope.js";
import {
  buildAccounts, filterAccounts, summarize, growth, activeReps, canonSp,
  MONTHS, STATUSES, REGIONS, NOT_LISTED,
} from "./lib/customerAnalysis.js";

// Customer Analysis: every account on the customer list, by type, area,
// salesperson and opening year, with this year's sales against the same
// months last year. The list comes from the newest "Customer Data <year>.xlsx"
// on the Data tab; the sales are the same customers_data the other tabs use.

const PAGE = 12;

// Status vocabulary, shared by the map, the legend and every mini bar.
const STATUS_COLOUR = {
  new: "var(--st-info)",
  growing: "var(--st-ok)",
  steady: "rgba(var(--tint), 0.42)",
  declining: "var(--st-watch)",
  lapsed: "var(--st-bad)",
  never: "rgba(var(--tint), 0.14)",
};
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));
const STATUS_ORDER = Object.fromEntries(STATUSES.map((s, i) => [s.key, i]));

const money = (v) => `RM ${Math.round(v || 0).toLocaleString("en-MY")}`;
const moneyShort = (v) => {
  const n = v || 0;
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}RM ${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}RM ${Math.round(a / 1e3)}K`;
  return `${sign}RM ${Math.round(a).toLocaleString("en-MY")}`;
};
const pct0 = (v) => `${Math.round((v || 0) * 100)}%`;
const n = (v) => (v || 0).toLocaleString("en-MY");
const plural = (c, w) => `${n(c)} ${w}${c === 1 ? "" : "s"}`;
const monthLabel = (lo) => (lo ? `${MONTHS[lo.month]} ${lo.year}` : "Never");

function Growth({ cur, prev, className = "" }) {
  const g = growth(cur, prev);
  if (g === null) return <span className={`whitespace-nowrap text-info ${className}`}>new sales</span>;
  if (!cur && !prev) return <span className={`text-faint ${className}`}>—</span>;
  const up = g >= 0;
  return (
    <span className={`whitespace-nowrap font-metric ${up ? "text-ok" : "text-bad"} ${className}`}>
      {up ? "+" : "−"}{Math.abs(Math.round(g * 100))}%
    </span>
  );
}

function StatusBar({ counts, total, className = "h-2" }) {
  if (!total) return <div className={`${className} rounded-full bg-track`} />;
  return (
    <div className={`flex overflow-hidden rounded-full bg-track ${className}`} aria-hidden="true">
      {STATUSES.map((s) =>
        counts[s.key] ? (
          <span key={s.key} style={{ width: `${(counts[s.key] / total) * 100}%`, background: STATUS_COLOUR[s.key] }} />
        ) : null
      )}
    </div>
  );
}

function Pills({ label, value, options, onPick, divideAfter }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="w-24 shrink-0 text-sm text-muted">{label}</span>
      {options.map(([key, text]) => [
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
        </button>,
        key === divideAfter && <span key={`${key}-div`} aria-hidden="true" className="mx-1 h-5 w-px bg-line" />,
      ])}
    </div>
  );
}

function Section({ title, note, children, aside }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-2">
        <div>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {note && <p className="mt-0.5 text-xs leading-relaxed text-muted">{note}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

const th = "px-2 py-2 text-left text-xs font-medium text-faint";
const thR = "px-2 py-2 text-right text-xs font-medium text-faint";
const td = "px-2 py-2 align-middle";
const tdR = "px-2 py-2 text-right align-middle font-metric text-xs";
const rowBtn = "cursor-pointer border-t border-hair hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent";

// ---------- loading the customer list ----------

function useMasterList() {
  const [state, setState] = useState({ loading: true, rows: null, file: null, error: null });
  useEffect(() => {
    let live = true;
    supabase
      .from("data_files")
      .select("id,name,uploaded_at,rows_json")
      .eq("kind", "master")
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) return setState({ loading: false, rows: null, file: null, error: error.message });
        const f = data?.[0];
        setState({
          loading: false,
          rows: Array.isArray(f?.rows_json) ? f.rows_json : null,
          file: f ? { name: f.name, uploadedAt: f.uploaded_at } : null,
          error: null,
        });
      });
    return () => { live = false; };
  }, []);
  return [state, setState];
}

function NoList({ user, onPreview, error }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const { parseFile } = await import("./lib/parseXlsx.js");
      const res = await parseFile(file);
      if (!res.ok || res.kind !== "master") throw new Error(res.error || "This is not a customer list. Pick “Customer Data <year>.xlsx”.");
      onPreview(res.rows, file.name);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-2xl space-y-3 rounded-xl border border-line px-5 py-6">
      <h2 className="text-lg font-semibold text-ink">The customer list isn’t loaded yet</h2>
      {user?.canUpload ? (
        <>
          <p className="text-sm leading-relaxed text-muted">
            Upload <strong className="text-ink">Customer Data 2026.xlsx</strong> on the Data tab. Each new upload replaces the previous list.
            Set it to “Everyone” there so salespeople can see this page too.
          </p>
          <p className="text-sm leading-relaxed text-muted">Or open the file here to preview the analysis without saving it.</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            {busy ? "Reading file…" : "Preview a customer list"}
            <input type="file" accept=".xlsx" className="sr-only" onChange={pick} disabled={busy} />
          </label>
        </>
      ) : (
        <p className="text-sm leading-relaxed text-muted">An admin needs to upload the customer list and share it with everyone.</p>
      )}
      {(msg || error) && <p className="text-sm text-bad">{msg || error}</p>}
    </div>
  );
}

// ---------- the page ----------

export default function CustomerAnalysisTab({ sales, years, year, setYear, selectedSP, setSelectedSP, salespeople, user }) {
  const [master, setMaster] = useMasterList();
  const [lapse, setLapse] = useState(6);
  const [typeF, setTypeF] = useState(null);
  const [areaF, setAreaF] = useState(null); // { region } or { state }
  const [statusF, setStatusF] = useState(null);
  const [openState, setOpenState] = useState(null);
  const [inactiveView, setInactiveView] = useState("lapsed");
  const [shown, setShown] = useState(PAGE);
  const [q, setQ] = useState("");

  const built = useMemo(
    () => (master.rows ? buildAccounts({ master: master.rows, sales: sales || [], year, lapseMonths: lapse }) : null),
    [master.rows, sales, year, lapse]
  );

  // Only salespeople who had sales in the chosen year.
  const reps = useMemo(() => {
    const active = activeReps(sales, year);
    const isActive = (s) => active.has(canonSp(s) || s);
    const base = salespeople.filter(isActive);
    if (!built) return base;
    const extra = [...new Set(built.accounts.map((a) => a.sp))].filter((s) => !salespeople.includes(s) && s !== "Unassigned" && isActive(s)).sort();
    return [...base, ...extra];
  }, [built, salespeople, sales, year]);

  // A rep picked for another year who wasn't selling in this one: go back to All Teams.
  useEffect(() => {
    if (selectedSP && selectedSP !== "All" && selectedSP !== ALL_EX_HOUSE && !reps.includes(selectedSP)) setSelectedSP("All");
  }, [reps, selectedSP, setSelectedSP]);

  const scoped = useMemo(() => (built ? filterAccounts(built.accounts, { scope: selectedSP }) : []), [built, selectedSP]);
  const filtered = useMemo(
    () => filterAccounts(scoped, { type: typeF, region: areaF?.region || null, state: areaF?.state || null }),
    [scoped, typeF, areaF]
  );
  const s = useMemo(() => summarize(filtered), [filtered]);
  // The type and area tables ignore their own filter so you can switch between rows.
  const sType = useMemo(() => summarize(filterAccounts(scoped, { region: areaF?.region || null, state: areaF?.state || null })), [scoped, areaF]);
  const sArea = useMemo(() => summarize(filterAccounts(scoped, { type: typeF })), [scoped, typeF]);

  if (master.loading) return <p className="ca-root px-1 py-10 text-sm text-muted">Loading the customer list…</p>;
  if (!master.rows) {
    return (
      <div className="ca-root text-ink">
        <NoList user={user} error={master.error} onPreview={(rows, name) => setMaster({ loading: false, rows, file: { name, preview: true }, error: null })} />
      </div>
    );
  }

  const { asOf, hasData, merged = [] } = built;
  const period = asOf === 11 ? String(year) : `Jan–${MONTHS[asOf]} ${year}`;
  const lyPeriod = asOf === 11 ? String(year - 1) : `Jan–${MONTHS[asOf]} ${year - 1}`;
  const sinceIdx = year * 12 + asOf - lapse + 1;
  const since = `${MONTHS[((sinceIdx % 12) + 12) % 12]} ${Math.floor(sinceIdx / 12)}`;
  const t = s.total;

  const resetList = () => { setShown(PAGE); };
  const pickType = (k) => { setTypeF((cur) => (cur === k ? null : k)); resetList(); };
  const pickState = (st) => { setAreaF((cur) => (cur?.state === st ? null : { state: st })); resetList(); };
  const pickRegion = (r) => { setAreaF((cur) => (cur?.region === r ? null : { region: r })); resetList(); };

  // Portfolio map rows: one per type, accounts sorted by status then sales.
  const mapRows = s.byType.map((g) => ({
    ...g,
    list: filtered
      .filter((a) => a.type === g.key)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.ytd - a.ytd),
  }));

  const needle = q.trim().toLowerCase();
  const inactiveAll = filtered
    .filter((a) => a.status === inactiveView)
    .filter((a) => !needle || `${a.name} ${a.code} ${a.town} ${a.state}`.toLowerCase().includes(needle))
    .sort((a, b) => b.lyFull - a.lyFull || b.lifetime - a.lifetime || (b.created || "").localeCompare(a.created || ""));
  const inactive = inactiveAll.slice(0, shown);
  const lapsedValue = filtered.filter((a) => a.status === "lapsed").reduce((x, a) => x + a.lyFull, 0);

  const unlisted = filtered.filter((a) => !a.listed);
  const unlistedYtd = unlisted.reduce((x, a) => x + a.ytd, 0);
  const noArea = filtered.filter((a) => a.listed && a.region === "Unknown").length;

  const maxCohort = Math.max(1, ...s.byCohort.map((c) => c.accounts));
  const maxMove = Math.max(1, ...s.gainers.slice(0, 10).map((a) => a.delta), ...s.losers.slice(0, 10).map((a) => -a.delta));
  const statesByRegion = REGIONS.map((r) => ({ region: r, row: sArea.byRegion.find((x) => x.key === r), states: sArea.byState.filter((x) => x.region === r) })).filter((x) => x.row);

  const filterChips = [
    typeF && { k: "type", label: `Type ${typeF}`, clear: () => setTypeF(null) },
    areaF && { k: "area", label: areaF.state || areaF.region, clear: () => setAreaF(null) },
  ].filter(Boolean);

  return (
    <div className="ca-root space-y-8 text-ink">
      <div className="space-y-3">
        <Pills label="Year" value={year} options={years.map((y) => [y, String(y)])} onPick={(y) => { setYear(y); resetList(); }} />
        <Pills
          label="Salesperson"
          value={selectedSP}
          options={[
            ["All", "All Teams"],
            ...(reps.includes(HOUSE_SP) ? [[ALL_EX_HOUSE, `All Teams − ${HOUSE_SP}`]] : []),
            ...reps.map((r) => [r, r]),
          ]}
          divideAfter={reps.includes(HOUSE_SP) ? ALL_EX_HOUSE : "All"}
          onPick={(v) => { setSelectedSP(v); resetList(); }}
        />
        <Pills
          label="Inactive after"
          value={lapse}
          options={[[3, "3 months"], [6, "6 months"], [12, "12 months"]]}
          onPick={(v) => { setLapse(v); resetList(); }}
        />
      </div>

      <header className="max-w-3xl space-y-2">
        <h2 className="text-xl font-bold leading-snug tracking-tight text-ink">
          {hasData
            ? <>{n(t.active)} of {plural(t.accounts, "account")} ordered in {period}, for {moneyShort(t.ytd)} <Growth cur={t.ytd} prev={t.ly} className="text-lg" /> on {lyPeriod}</>
            : `No sales loaded for ${year} yet`}
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          {scopeName(selectedSP)}
          {filterChips.length ? "" : "."}{" "}
          {filterChips.map((c) => (
            <button key={c.k} type="button" onClick={c.clear}
              className="mr-1.5 inline-flex cursor-pointer items-center gap-1 rounded-full bg-wash px-2.5 py-0.5 text-xs text-ink ring-1 ring-line hover:ring-accent focus-visible:outline-2 focus-visible:outline-accent"
              aria-label={`Remove filter ${c.label}`}>
              {c.label}<span aria-hidden="true" className="text-faint">×</span>
            </button>
          ))}
          {n(t.counts.lapsed)} accounts have not ordered since {since} — together they bought {moneyShort(lapsedValue)} in {year - 1}.
          {master.file?.preview ? " Preview only: this list is not saved." : ""}
        </p>
      </header>

      {/* Portfolio map: every account is one square. */}
      <Section
        title="Every account at a glance"
        note="One square per account, grouped by customer type. Hover a square for the name. Pick a status to highlight it."
        aside={
          <ul className="flex flex-wrap gap-1.5" aria-label="Highlight a status">
            {STATUSES.map((st) => (
              <li key={st.key}>
                <button type="button" aria-pressed={statusF === st.key}
                  onClick={() => setStatusF((c) => (c === st.key ? null : st.key))}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent ${
                    statusF === st.key ? "bg-wash text-ink ring-1 ring-accent" : "text-muted hover:text-ink"
                  }`}>
                  <span aria-hidden="true" className="ca-dot" style={{ background: STATUS_COLOUR[st.key] }} />
                  {st.label}<span className="font-metric text-faint">{n(t.counts[st.key])}</span>
                </button>
              </li>
            ))}
          </ul>
        }
      >
        <div className="space-y-2">
          {mapRows.map((g) => (
            <div key={g.key} className="grid grid-cols-[7.5rem_1fr] items-start gap-3 sm:grid-cols-[10rem_1fr]">
              <button type="button" onClick={() => pickType(g.key)} aria-pressed={typeF === g.key}
                className={`cursor-pointer truncate rounded px-1 text-left text-xs leading-[10px] focus-visible:outline-2 focus-visible:outline-accent ${typeF === g.key ? "text-accent" : "text-muted hover:text-ink"}`}
                title={`${g.key}: ${plural(g.accounts, "account")}, ${g.active} ordering`}>
                <span className="font-metric">{g.key === NOT_LISTED ? "Not on list" : g.key}</span>{" "}
                <span className="text-faint">{g.accounts}</span>
              </button>
              <div className="flex flex-wrap gap-[3px]" role="img" aria-label={`${g.key}: ${STATUSES.map((st) => `${g.counts[st.key]} ${st.label.toLowerCase()}`).join(", ")}`}>
                {g.list.map((a) => (
                  <span key={a.id} className="ca-dot" data-dim={statusF && a.status !== statusF ? "1" : undefined}
                    style={{ background: STATUS_COLOUR[a.status] }}
                    title={`${a.name}\n${a.town ? `${a.town}, ` : ""}${a.state} · ${a.sp}\n${STATUS_LABEL[a.status]} · ${period}: ${money(a.ytd)} (last year ${money(a.ly)})\nLast order: ${monthLabel(a.lastOrder)}`} />
                ))}
              </div>
            </div>
          ))}
          {!mapRows.length && <p className="py-8 text-center text-sm text-muted">No accounts match these filters.</p>}
        </div>
      </Section>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section title="By customer type" note={`Sales ${period} against ${lyPeriod}. Click a type to filter the page.`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr><th className={th}>Type</th><th className={thR}>Accounts</th><th className={th}>Status · ordering</th><th className={thR}>Sales</th><th className={thR}>Growth</th></tr>
              </thead>
              <tbody>
                {sType.byType.map((g) => (
                  <tr key={g.key} tabIndex={0} onClick={() => pickType(g.key)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pickType(g.key))}
                    aria-selected={typeF === g.key} className={`${rowBtn} ${typeF === g.key ? "bg-wash" : ""}`}>
                    <td className={`${td} font-metric text-xs ${typeF === g.key ? "text-accent" : ""}`}>{g.key}</td>
                    <td className={tdR}>{n(g.accounts)}</td>
                    <td className={`${td} w-[30%]`}>
                      <div className="flex items-center gap-2">
                        <StatusBar counts={g.counts} total={g.accounts} className="h-2 flex-1" />
                        <span className="w-9 text-right font-metric text-xs text-muted">{pct0(g.activeRate)}</span>
                      </div>
                    </td>
                    <td className={tdR}>{moneyShort(g.ytd)}</td>
                    <td className={tdR}><Growth cur={g.ytd} prev={g.ly} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="By area" note="Regions and states, biggest first. Open a state for its towns; click a name to filter the page.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr><th className={th}>Area</th><th className={thR}>Accounts</th><th className={th}>Status · ordering</th><th className={thR}>Sales</th><th className={thR}>Growth</th></tr>
              </thead>
              {statesByRegion.map(({ region, row, states }) => (
                <tbody key={region}>
                  <tr className="border-t border-line">
                    <td className={td}>
                      <button type="button" onClick={() => pickRegion(region)} aria-pressed={areaF?.region === region}
                        className={`cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent ${areaF?.region === region ? "text-accent" : "text-ink hover:text-accent"}`}>{region}</button>
                    </td>
                    <td className={tdR}>{n(row.accounts)}</td>
                    <td className={`${td} w-[28%]`}>
                      <div className="flex items-center gap-2">
                        <StatusBar counts={row.counts} total={row.accounts} className="h-2 flex-1" />
                        <span className="w-9 text-right font-metric text-xs text-muted">{pct0(row.activeRate)}</span>
                      </div>
                    </td>
                    <td className={`${tdR} font-semibold`}>{moneyShort(row.ytd)}</td>
                    <td className={tdR}><Growth cur={row.ytd} prev={row.ly} /></td>
                  </tr>
                  {states.map((st) => (
                    [
                      <tr key={st.key} className="border-t border-hair">
                        <td className={`${td} pl-5`}>
                          <span className="inline-flex items-center gap-1.5">
                            <button type="button" aria-expanded={openState === st.key} aria-label={`${openState === st.key ? "Hide" : "Show"} towns in ${st.key}`}
                              onClick={() => setOpenState((c) => (c === st.key ? null : st.key))}
                              className="w-4 cursor-pointer text-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">{openState === st.key ? "▾" : "▸"}</button>
                            <button type="button" onClick={() => pickState(st.key)} aria-pressed={areaF?.state === st.key}
                              className={`cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-accent ${areaF?.state === st.key ? "text-accent" : "text-muted hover:text-ink"}`}>{st.key}</button>
                          </span>
                        </td>
                        <td className={tdR}>{n(st.accounts)}</td>
                        <td className={td}>
                          <div className="flex items-center gap-2">
                            <StatusBar counts={st.counts} total={st.accounts} className="h-1.5 flex-1" />
                            <span className="w-9 text-right font-metric text-xs text-faint">{pct0(st.activeRate)}</span>
                          </div>
                        </td>
                        <td className={tdR}>{moneyShort(st.ytd)}</td>
                        <td className={tdR}><Growth cur={st.ytd} prev={st.ly} /></td>
                      </tr>,
                      openState === st.key && st.towns.map((tw) => (
                        <tr key={`${st.key}|${tw.key}`} className="text-xs text-muted">
                          <td className={`${td} pl-14`}>{tw.key}</td>
                          <td className={tdR}>{n(tw.accounts)}</td>
                          <td className={`${td} font-metric`}>{tw.active} ordering</td>
                          <td className={tdR}>{moneyShort(tw.ytd)}</td>
                          <td className={tdR}><Growth cur={tw.ytd} prev={tw.ly} /></td>
                        </tr>
                      )),
                    ]
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </Section>
      </div>

      <Section
        title="Accounts to win back"
        note={inactiveView === "lapsed"
          ? `No order since ${since}, sorted by what they bought in ${year - 1}.`
          : "On the customer list but no order in any year loaded on the dashboard."}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label="Which accounts">
              {[["lapsed", `Inactive ${n(t.counts.lapsed)}`], ["never", `Never ordered ${n(t.counts.never)}`], ["declining", `Declining ${n(t.counts.declining)}`]].map(([k, label]) => (
                <button key={k} type="button" aria-pressed={inactiveView === k} onClick={() => { setInactiveView(k); resetList(); }}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-accent ${inactiveView === k ? "bg-wash text-ink ring-1 ring-accent" : "text-muted hover:text-ink"}`}>
                  {label}
                </button>
              ))}
            </div>
            <input type="search" value={q} onChange={(e) => { setQ(e.target.value); resetList(); }} placeholder="Search name or town" aria-label="Search accounts"
              className="w-full rounded-lg border border-line bg-wash px-3 py-1.5 text-sm text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent sm:w-52" />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className={th}>Account</th><th className={th}>Type</th><th className={th}>Area</th><th className={th}>Salesperson</th>
                <th className={th}>Last order</th><th className={thR}>{year - 1} sales</th>
                <th className={thR}>{inactiveView === "declining" ? `${period}` : "Opened"}</th>
              </tr>
            </thead>
            <tbody>
              {inactive.map((a) => (
                <tr key={a.id} className="border-t border-hair">
                  <td className={`${td} max-w-[16rem]`}>
                    <div className="truncate text-ink" title={a.name}>{a.name}</div>
                    {a.chain && <div className="text-xs text-faint">{a.chain}</div>}
                  </td>
                  <td className={`${td} font-metric text-xs text-muted`}>{a.type}</td>
                  <td className={`${td} text-xs text-muted`}>{a.town ? `${a.town}, ` : ""}{a.state}</td>
                  <td className={`${td} text-xs text-muted`}>{a.sp}</td>
                  <td className={`${td} font-metric text-xs ${a.status === "lapsed" ? "text-bad" : "text-muted"}`}>{monthLabel(a.lastOrder)}</td>
                  <td className={tdR}>{a.lyFull ? moneyShort(a.lyFull) : "—"}</td>
                  <td className={`${tdR} text-muted`}>
                    {inactiveView === "declining" ? <>{moneyShort(a.ytd)} <Growth cur={a.ytd} prev={a.ly} /></> : a.created ? a.created.slice(0, 7) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!inactiveAll.length && <p className="py-8 text-center text-sm text-muted">None — every account here ordered recently.</p>}
        </div>
        {inactiveAll.length > shown && (
          <button type="button" onClick={() => setShown((v) => v + PAGE * 2)}
            className="cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-accent hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent">
            Show more ({n(inactiveAll.length - shown)} left)
          </button>
        )}
      </Section>

      <Section title="Biggest movers" note={`Change in sales, ${period} against ${lyPeriod}.`}>
        <div className="grid gap-6 md:grid-cols-2">
          {[["Growing most", s.gainers, "var(--st-ok)"], ["Falling most", s.losers, "var(--st-bad)"]].map(([title, list, colour]) => (
            <div key={title}>
              <h4 className="mb-2 text-sm font-semibold text-muted">{title}</h4>
              <ol className="space-y-1.5">
                {list.slice(0, 10).map((a) => (
                  <li key={a.id} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate text-ink" title={`${a.name} · ${a.type} · ${a.state}`}>{a.name}</span>
                    <span className="h-2 rounded-full bg-track">
                      <span className="block h-2 rounded-full" style={{ width: `${(Math.abs(a.delta) / maxMove) * 100}%`, background: colour }} />
                    </span>
                    <span className="w-24 text-right font-metric text-xs" style={{ color: colour }}>{a.delta > 0 ? "+" : ""}{moneyShort(a.delta)}</span>
                  </li>
                ))}
                {!list.length && <li className="text-sm text-muted">No accounts.</li>}
              </ol>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section title="By salesperson" note="Each rep’s accounts on the customer list, and how many are still ordering.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr><th className={th}>Salesperson</th><th className={thR}>Accounts</th><th className={th}>Status mix</th><th className={thR}>Inactive</th><th className={thR}>Sales</th><th className={thR}>Growth</th></tr>
              </thead>
              <tbody>
                {s.bySp.map((g) => (
                  <tr key={g.key} className="border-t border-hair">
                    <td className={`${td} text-ink`}>{g.key}</td>
                    <td className={tdR}>{n(g.accounts)}</td>
                    <td className={`${td} w-[28%]`}><StatusBar counts={g.counts} total={g.accounts} /></td>
                    <td className={`${tdR} text-bad`}>{n(g.counts.lapsed)}</td>
                    <td className={tdR}>{moneyShort(g.ytd)}</td>
                    <td className={tdR}><Growth cur={g.ytd} prev={g.ly} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Accounts opened by year" note={`How many accounts each year added, and how many still ordered in ${period}.`}>
          <div className="flex h-44 items-end gap-1.5 overflow-x-auto pb-1" role="img"
            aria-label={s.byCohort.map((c) => `${c.key}: ${c.accounts} opened, ${c.active} ordering`).join("; ")}>
            {s.byCohort.map((c) => (
              <div key={c.key} className="flex min-w-9 flex-1 flex-col items-center gap-1" title={`${c.key}: ${c.accounts} opened · ${c.active} ordering · ${money(c.ytd)}`}>
                <span className="font-metric text-[10px] text-muted">{c.accounts}</span>
                <div className="flex w-full flex-col justify-end overflow-hidden rounded-t bg-track" style={{ height: `${(c.accounts / maxCohort) * 120}px` }}>
                  <div style={{ height: `${c.accounts ? (c.active / c.accounts) * 100 : 0}%`, background: c.key === year ? "var(--st-info)" : "var(--st-ok)" }} />
                </div>
                <span className={`font-metric text-[10px] ${c.key === year ? "text-ink" : "text-faint"}`}>{String(c.key).slice(2)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            Filled part = accounts that ordered in {period}.
            {s.byCohort.find((c) => c.key === year) ? ` ${n(s.byCohort.find((c) => c.key === year).accounts)} opened in ${year}, ${n(s.byCohort.find((c) => c.key === year).active)} already ordering.` : ""}
          </p>
        </Section>
      </div>

      {s.byChain.length > 0 && (
        <Section title="Chains and groups" note="Accounts that share a chain name in the Remark column.">
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {s.byChain.map((g) => (
              <div key={g.key} className="flex items-center justify-between gap-3 border-t border-hair py-1.5 text-sm">
                <span className="truncate text-ink">{g.key}</span>
                <span className="flex shrink-0 items-center gap-3 font-metric text-xs">
                  <span className="text-faint">{g.active}/{g.accounts}</span>
                  <span>{moneyShort(g.ytd)}</span>
                  <Growth cur={g.ytd} prev={g.ly} className="w-14 text-right" />
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(unlisted.length > 0 || noArea > 0 || merged.length > 0) && (
        <Section title="Tidy the customer list" note="Fixing these in Autocount and re-exporting the list makes the type and area figures complete.">
          <ul className="space-y-1 text-sm text-muted">
            {unlisted.length > 0 && (
              <li>
                <details>
                  <summary className="cursor-pointer">
                    <strong className="text-ink">{plural(unlisted.length, "customer")}</strong> with sales are not on the list ({moneyShort(unlistedYtd)} in {period}). They show as “Not on list”.
                  </summary>
                  <p className="mt-2 columns-1 text-xs sm:columns-2 xl:columns-3">
                    {unlisted.sort((a, b) => b.ytd - a.ytd).map((a) => <span key={a.id} className="block truncate">{a.name} <span className="text-faint">· {a.sp}</span></span>)}
                  </p>
                </details>
              </li>
            )}
            {merged.length > 0 && (
              <li>
                <details>
                  <summary className="cursor-pointer">
                    <strong className="text-ink">{plural(merged.length, "account")}</strong> {merged.length === 1 ? "is" : "are"} on the list more than once and counted once here.
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {merged.map((g) => (
                      <li key={g.kept.code + g.kept.name}>
                        Kept <span className="font-metric text-ink">{g.kept.code}</span> ({g.kept.name}, {g.kept.sp}); merged{" "}
                        {g.dropped.map((d) => `${d.code} (${d.name}, ${d.sp})`).join(", ")}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            )}
            {noArea > 0 && <li><strong className="text-ink">{plural(noArea, "account")}</strong> {noArea === 1 ? "has" : "have"} no usable state, so {noArea === 1 ? "it sits" : "they sit"} under “Unknown” area.</li>}
          </ul>
        </Section>
      )}

      {master.file && (
        <p className="text-xs text-faint">
          Customer list: {master.file.name}
          {master.file.uploadedAt ? `, uploaded ${new Date(master.file.uploadedAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}` : ""}.
        </p>
      )}
    </div>
  );
}
