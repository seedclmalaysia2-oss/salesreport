import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase.js";
import {
  ACCOUNT_PARENT, BANDS, UNDATED_LABEL, agoText, ageText, attention, outletRows, ownerIsRep, people, sumQty, todayISO, toLines, totals,
} from "./lib/consignment.js";
import "./consignment.css";

// What the warehouse has out at each ECP outlet, for the sales team. It reads the
// warehouse's latest upload straight from the database (sales_consignment()), so
// nothing is copied: when the warehouse uploads, this tab shows it on its next
// refresh. It refreshes itself every few minutes and whenever the tab is reopened.

const PAGE = 1000;            // PostgREST's row cap per request
const REFRESH_MS = 3 * 60_000;
const SHOWN = 6;
const OUTLETS_PAGE = 20;

const BAND_LABELS = [...BANDS.map(b => b.label), UNDATED_LABEL];
const bandVar = (i) => `var(--cg-${i})`;
const n = (x) => Math.round(x || 0).toLocaleString("en-MY");
const plural = (x, word) => `${n(x)} ${word}${x === 1 ? "" : "s"}`;
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "No date");

async function fetchSnapshot() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc("sales_consignment").range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < PAGE) break;
  }
  const { data: info, error: infoErr } = await supabase.rpc("sales_consignment_info");
  if (infoErr) throw infoErr;
  return { rows, info: Array.isArray(info) ? info[0] || null : info };
}

const errorText = (e) =>
  e?.code === "PGRST202" || /sales_consignment/i.test(e?.message || "") && /not find|does not exist/i.test(e?.message || "")
    ? "Consignment is not connected yet. Ask the admin to apply the warehouse SQL 0006 in Supabase."
    : `Could not load consignment stock. ${e?.message || ""}`.trim();

export default function ConsignmentTab({ user }) {
  const [snap, setSnap] = useState({ rows: [], info: null });
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setPicked] = useState(null);       // null until the viewer chooses; then "" = everyone
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [limit, setLimit] = useState(OUTLETS_PAGE);
  const [now, setNow] = useState(() => Date.now());
  const last = useRef(0);

  const load = useCallback(async (quiet) => {
    if (quiet) setRefreshing(true);
    try {
      const next = await fetchSnapshot();
      setSnap(next);
      setStatus("ready");
      setError("");
    } catch (e) {
      // A quiet refresh failing must not wipe what is already on screen.
      if (!quiet) { setStatus("error"); setError(errorText(e)); }
    } finally {
      last.current = Date.now();
      setNow(Date.now());
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const tick = setInterval(() => { if (document.visibilityState === "visible") load(true); }, REFRESH_MS);
    const back = () => { if (document.visibilityState === "visible" && Date.now() - last.current > 60_000) load(true); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(tick); clearInterval(clock); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [load]);

  const today = todayISO(new Date(now));
  const lines = useMemo(() => toLines(snap.rows, today), [snap.rows, today]);
  const crowd = useMemo(() => people(lines), [lines]);

  // First view: the viewer's own stock if they have any, otherwise everyone's.
  const ownName = useMemo(() => crowd.main.find(w => ownerIsRep(w.name, user?.sp))?.name ?? "", [crowd, user?.sp]);
  const who = picked === null ? ownName : [...crowd.main, ...crowd.subs].some(w => w.name === picked) ? picked : "";

  const mine = useMemo(() => (who ? lines.filter(l => l.owner === who) : lines), [lines, who]);
  const tot = useMemo(() => totals(mine), [mine]);
  const act = useMemo(() => attention(mine), [mine]);
  const outlets = useMemo(() => outletRows(mine), [mine]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const hit = needle
      ? outlets.filter(o => [o.name, o.town, o.state, o.owner, ...o.csgs.map(c => c.csgNo || "")].some(t => t.toLowerCase().includes(needle)))
      : outlets;
    return [...hit].sort((a, b) => b.refresh - a.refresh || (b.oldest ?? -1) - (a.oldest ?? -1) || a.name.localeCompare(b.name));
  }, [outlets, needle]);

  const toggle = (name) => setOpen(s => { const x = new Set(s); if (x.has(name)) x.delete(name); else x.add(name); return x; });
  const pick = (name) => { setPicked(name); setLimit(OUTLETS_PAGE); setOpen(new Set()); };

  return (
    <div className="cg-root flex flex-col gap-6 text-ink" aria-label="ECP consignment stock">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-lg font-bold">ECP Consignment</h2>
          <p className="mt-0.5 max-w-[60ch] text-sm text-muted">
            Stock the warehouse has out at ECP outlets, from its latest upload. It updates by itself when the warehouse uploads a new file.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted" role="status" aria-live="polite">
          {snap.info && <span>Warehouse upload {agoText(snap.info.uploaded_at, now)}</span>}
          <button
            type="button" onClick={() => load(true)} disabled={refreshing}
            className="cursor-pointer rounded-md border border-line px-3 py-1.5 font-semibold text-ink outline-offset-2 hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {status === "loading" && <p className="rounded-lg bg-wash px-4 py-8 text-center text-sm text-muted">Loading consignment stock…</p>}
      {status === "error" && (
        <div className="rounded-lg border border-line bg-wash px-4 py-4 text-sm">
          <p className="font-semibold text-bad">{error}</p>
          <button type="button" onClick={() => { setStatus("loading"); load(false); }} className="mt-2 cursor-pointer font-semibold text-accent underline">Try again</button>
        </div>
      )}

      {status === "ready" && lines.length === 0 && (
        <p className="rounded-lg bg-wash px-4 py-8 text-center text-sm text-muted">
          No consignment stock to show{snap.info ? " for your account" : " yet. The warehouse has not uploaded the consignment workbook"}.
        </p>
      )}

      {status === "ready" && lines.length > 0 && (
        <>
          {/* One pill per salesman. The red number is how many CSGs are marked for refresh. */}
          <div role="group" aria-label="Salesman" className="cg-rail -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
            <Pill name="All salesmen" marked={crowd.main.concat(crowd.subs).reduce((s, w) => s + w.marked, 0)} on={who === ""} onClick={() => pick("")} />
            {crowd.main.map(w => <Pill key={w.name} name={w.name} marked={w.marked} old={w.old} on={who === w.name} onClick={() => pick(w.name)} />)}
            {crowd.subs.length > 0 && (
              <>
                <span className="flex flex-none items-center gap-2 pl-2 text-xs text-faint">
                  <span aria-hidden="true" className="h-5 w-px bg-line" />
                  {ACCOUNT_PARENT}&apos;s accounts
                </span>
                {crowd.subs.map(w => <Pill key={w.name} name={w.name} marked={w.marked} old={w.old} on={who === w.name} onClick={() => pick(w.name)} />)}
              </>
            )}
          </div>

          <section aria-label="Totals" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
            <Figure big value={n(tot.units)} label="units on consignment" />
            <Figure value={n(tot.outlets)} label={tot.outlets === 1 ? "outlet holds stock" : "outlets hold stock"} />
            <Figure
              value={n(tot.refreshLines)} tone={tot.refreshLines ? "bad" : ""}
              label={tot.refreshLines ? `marked for refresh (${n(tot.refreshUnits)} units)` : "marked for refresh"}
            />
            <Figure wide value={`${tot.units ? Math.round((tot.overYearUnits / tot.units) * 100) : 0}%`} label={`older than 1 year (${n(tot.overYearUnits)} units)`} />
          </section>

          <Ages bands={tot.bands} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Attention title="Refresh first" note="Marked in red in the workbook" tone="bad" lines={act.flagged} showOwner={!who}
              empty={who ? `Nothing is marked for refresh for ${who}.` : "Nothing is marked for refresh."} />
            <Attention title="Over 2 years, not marked" note="Old enough to check, but not flagged" tone="" lines={act.unflagged} showOwner={!who}
              empty={who ? `No unmarked stock over 2 years old for ${who}.` : "No unmarked stock is over 2 years old."} />
          </div>

          <section aria-labelledby="cg-outlets-h">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 id="cg-outlets-h" className="text-base font-bold">Outlets</h3>
                <p className="text-sm text-muted">{plural(shown.length, "outlet")}. Open one to see its CSGs.</p>
              </div>
              <input
                type="search" value={q} onChange={e => { setQ(e.target.value); setLimit(OUTLETS_PAGE); }} placeholder="Search outlet, town or CSG no."
                aria-label="Search outlets"
                className="w-full rounded-md border border-line bg-wash px-3 py-1.5 text-sm outline-offset-2 placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent sm:w-72"
              />
            </div>
            {shown.length === 0 ? (
              <p className="mt-3 rounded-lg bg-wash px-4 py-6 text-center text-sm text-muted">No outlet matches &ldquo;{q}&rdquo;.</p>
            ) : (
              <ul className="mt-3 overflow-hidden rounded-lg border border-line">
                {shown.slice(0, limit).map(o => (
                  <OutletRow key={o.name} o={o} open={open.has(o.name)} onToggle={() => toggle(o.name)} showOwner={!who} />
                ))}
              </ul>
            )}
            {shown.length > limit && (
              <button type="button" onClick={() => setLimit(l => l + OUTLETS_PAGE)} className="mt-2 cursor-pointer rounded px-1 text-sm font-semibold text-accent hover:underline">
                Show {Math.min(OUTLETS_PAGE, shown.length - limit)} more
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Pill({ name, marked, old, on, onClick }) {
  const detail = `${marked} marked for refresh${old ? `, ${old} over 2 years not marked` : ""}`;
  return (
    <button
      type="button" aria-pressed={on} onClick={onClick} title={`${name}: ${detail}`}
      className={`relative inline-flex flex-none cursor-pointer items-center gap-2 rounded-full border py-1 pl-3.5 pr-1.5 text-sm font-semibold outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${
        on ? "border-accent bg-accent text-white" : "border-line text-ink hover:bg-wash"
      }`}
    >
      {name}
      <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center font-metric text-xs font-bold ${marked > 0 ? (on ? "bg-white text-bad" : "bg-bad text-white") : on ? "bg-white/25 text-white" : "bg-track text-faint"}`}>
        {marked}
        <span className="sr-only"> marked for refresh</span>
      </span>
    </button>
  );
}

function Figure({ value, label, big, wide, tone }) {
  return (
    <div className={`bg-[var(--bg)] px-5 py-4 ${big || wide ? "col-span-2 lg:col-span-1" : ""}`}>
      <p className={`font-metric font-bold leading-none ${big ? "text-4xl" : "text-3xl"} ${tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</p>
      <p className="mt-2 text-sm text-muted">{label}</p>
    </div>
  );
}

function Ages({ bands }) {
  const total = bands.reduce((s, x) => s + x, 0);
  return (
    <section aria-labelledby="cg-age-h" className="rounded-xl border border-line p-5">
      <h3 id="cg-age-h" className="text-base font-bold">How long stock has been out</h3>
      <p className="mt-0.5 text-sm text-muted">Units, split by how old the CSG is.</p>
      <div
        role="img" aria-label={BAND_LABELS.map((l, i) => (bands[i] ? `${l} ${n(bands[i])} units` : "")).filter(Boolean).join(", ")}
        className="mt-4 flex h-6 gap-px overflow-hidden rounded-md bg-track"
      >
        {bands.map((x, i) => x > 0 && <span key={i} title={`${BAND_LABELS[i]}: ${n(x)} units`} style={{ flex: `${x} 1 0`, background: bandVar(i), minWidth: 2 }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-x-4 gap-y-2">
        {BAND_LABELS.map((label, i) => (bands[i] === 0 && i === BANDS.length ? null : (
          <li key={label} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1 h-3 w-3 flex-none rounded-sm" style={{ background: bandVar(i) }} />
            <span className="text-sm leading-tight text-muted">
              {label}
              <span className="block font-metric font-bold text-ink">
                {n(bands[i])}<span className="ml-1.5 font-sans text-xs font-normal text-faint">{total ? Math.round((bands[i] / total) * 100) : 0}%</span>
              </span>
            </span>
          </li>
        )))}
      </ul>
    </section>
  );
}

function Attention({ title, note, lines, tone, showOwner, empty }) {
  const [all, setAll] = useState(false);
  const rows = all ? lines : lines.slice(0, SHOWN);
  return (
    <section>
      <div className={`border-l-4 pl-3 ${tone === "bad" ? "border-bad" : "border-line"}`}>
        <h3 className="text-base font-bold">{title}</h3>
        <p className="text-sm text-muted">
          {note}
          {lines.length > 0 && <> &middot; {plural(lines.length, "CSG")}, {n(sumQty(lines))} units</>}
        </p>
      </div>
      {lines.length === 0 ? (
        <p className="mt-3 rounded-lg bg-wash px-3 py-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-lg border border-line">
          {rows.map((l, i) => (
            <li key={`${l.outlet}|${l.csgNo}|${l.product}|${i}`} className="flex items-start justify-between gap-3 border-t border-line px-3 py-2.5 first:border-t-0">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{l.outlet}</span>
                <span className="block truncate text-xs text-muted">
                  {l.product}{showOwner && <> &middot; {l.owner}</>}
                </span>
                <span className="block text-xs text-faint">{l.csgNo || "No CSG no."} &middot; {fmtDate(l.csgDate)}</span>
              </span>
              <span className="flex-none text-right">
                <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${tone === "bad" ? "text-bad" : ""}`}>
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: bandVar(l.band) }} />
                  {ageText(l.days)}
                </span>
                <span className="block font-metric text-xs text-muted">{n(l.qty)} {l.qty === 1 ? "unit" : "units"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {lines.length > SHOWN && (
        <button type="button" onClick={() => setAll(a => !a)} className="mt-2 cursor-pointer rounded px-1 text-sm font-semibold text-accent hover:underline">
          {all ? `Show the oldest ${SHOWN}` : `Show all ${n(lines.length)}`}
        </button>
      )}
    </section>
  );
}

function OutletRow({ o, open, onToggle, showOwner }) {
  const place = [o.town, o.state].filter(Boolean).join(", ");
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button" aria-expanded={open} onClick={onToggle}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-3 py-2.5 outline-offset-[-2px] hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{o.name}</span>
          <span className="block truncate text-xs text-muted">{place}{showOwner && <>{place ? " · " : ""}{o.owner}</>}</span>
        </span>
        <span className="flex items-center gap-3 text-right">
          {o.refresh > 0 && <span className="rounded-full bg-bad px-2 py-0.5 font-metric text-xs font-bold text-white">{o.refresh} to refresh</span>}
          <span>
            <span className="block font-metric text-sm font-bold">{n(o.units)}</span>
            <span className="block text-xs text-faint">{o.oldest === null ? "No date" : `oldest ${ageText(o.oldest)}`}</span>
          </span>
          <span aria-hidden="true" className={`text-faint transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line bg-wash px-3 py-3">
          <ul className="flex flex-col gap-2">
            {o.csgs.map(c => (
              <li key={c.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="text-sm font-semibold">
                    {c.csgNo || "No CSG no."}
                    <span className="ml-2 text-xs font-normal text-muted">{fmtDate(c.csgDate)}</span>
                    {c.needsRefresh && <span className="ml-2 rounded-full bg-bad px-2 py-0.5 text-xs font-bold text-white">Refresh</span>}
                    {c.tags.map(t => <span key={t} className="ml-2 rounded-full bg-track px-2 py-0.5 text-xs font-semibold text-muted">{t}</span>)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: bandVar(c.band) }} />
                    {ageText(c.days)}
                    <span className="font-metric font-bold">{n(c.units)}</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{c.products.map(p => `${p.product} ×${n(p.qty)}`).join(" · ")}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
