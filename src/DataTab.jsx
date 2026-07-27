// Data tab — admin-only file library.
//
// Uploaded workbooks live in the private 'data-files' bucket with a row in
// public.data_files. They are for admins only; regular users never see this
// tab and RLS returns them nothing from data_files or the bucket even if they
// call the API directly. This component is only ever rendered for an admin
// (Dashboard gates it), but nothing here is load-bearing for security — the
// database is.

import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { parseFile, parseFilename } from "./lib/parseXlsx.js";
import {
  listFiles, uploadFile, replaceFile,
  softDeleteFile, restoreFile, purgeFile, downloadUrl,
  reprocessAllFiles,
} from "./lib/files.js";
import {
  syncWeeklyFromFiles, invoiceFilesFrom,
  syncCustomersFromFiles, syncBrandsFromFiles,
} from "./lib/weekly.js";
import { fetchAll } from "./lib/supabase.js";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtSize(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function detectedLabel(kind) {
  if (kind === "customer") return "Sales Analysis · Customer";
  if (kind === "brand") return "Stock Sales · Brand";
  if (kind === "invoice") return "Customer Invoice Listing";
  return kind || "Unknown";
}

function kindColor(kind) {
  if (kind === "customer") return "#34D399";
  if (kind === "brand") return "#A855F7";
  if (kind === "invoice") return "#3B82F6";
  return "#94A3B8";
}

function fmtDate(ts) {
  return ts
    ? new Date(ts).toLocaleString("en-MY", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "—";
}

// Key like "2026-05" for grouping and label like "May 2026" for display. Files
// with no uploadedAt fall into an "Unknown" bucket that sorts last.
function monthKeyFor(ts) {
  if (!ts) return "unknown";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFor(key) {
  if (key === "unknown") return "Unknown date";
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

const Card = ({children, style}) => (
  <div style={{background:"rgba(var(--tint),0.02)",border:"1px solid rgba(var(--tint),0.06)",borderRadius:14,padding:20,marginBottom:20,...style}}>
    {children}
  </div>
);

const KPI = ({label, value, sub, color}) => (
  <div style={{flex:"1 1 180px",background:"rgba(var(--tint),0.02)",border:"1px solid rgba(var(--tint),0.06)",borderRadius:14,padding:"16px 18px"}}>
    <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1.2,color:"rgba(var(--tint),0.45)",marginBottom:6}}>{label}</div>
    <div style={{fontSize:20,fontWeight:700,color,fontFamily:"'Space Mono',monospace"}}>{value}</div>
    {sub && <div style={{fontSize:11,color:"rgba(var(--tint),0.4)",marginTop:4}}>{sub}</div>}
  </div>
);

const thStyle = {
  textAlign: "left", padding: "10px 14px", fontSize: 10, fontWeight: 600,
  letterSpacing: 1, color: "rgba(var(--tint),0.45)",
  borderBottom: "1px solid rgba(var(--tint),0.06)", textTransform: "uppercase",
  fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 14px", borderBottom: "1px solid rgba(var(--tint),0.04)",
  verticalAlign: "middle",
};

function actionBtn(color, disabled = false) {
  return {
    background: "transparent",
    border: `1px solid ${disabled ? "rgba(255,255,255,0.08)" : color + "55"}`,
    color: disabled ? "rgba(var(--tint),0.25)" : color,
    borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap",
  };
}

export default function DataTab({ data, onRefresh }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [showTrash, setShowTrash] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);

  // Sorting + quick search. Defaults to newest-first, which is what the list
  // did before it was sortable.
  const [sort, setSort] = useState({ key: "uploadedAt", dir: "desc" });
  const [query, setQuery] = useState("");

  const toggleSort = (key) =>
    setSort(s => (s.key === key
      ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
      // First click on a new column: names read best A->Z, but dates and
      // sizes are almost always wanted biggest/newest first.
      : { key, dir: (key === "uploadedAt" || key === "sizeBytes") ? "desc" : "asc" }));

  const dropRef = useRef(null);
  const inputRef = useRef(null);
  const updateInputRef = useRef(null);
  const updateTargetRef = useRef(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listFiles();
      setFiles(list);
      setError(null);
      return list;
    } catch (e) {
      setError(`Could not load files: ${e.message || e}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  // Push the invoice-listing numbers into the weekly_sales board. This is the
  // link that makes an upload on this tab actually show up on the Weekly Sales
  // view — before, the two were disconnected. Idempotent, so the manual button
  // can also backfill files uploaded before this existed. `silent` suppresses
  // the "nothing to sync" note during the automatic post-upload run.
  const runWeeklySync = async (list, { silent = false } = {}) => {
    setSyncing(true);
    setError(null);
    try {
      const res = await syncWeeklyFromFiles(list ?? files);
      if (res.rows > 0) {
        setNotice(
          `Weekly Sales updated — ${res.weeks} week${res.weeks === 1 ? "" : "s"} ` +
          `synced from ${res.files} invoice file${res.files === 1 ? "" : "s"} ` +
          `(${res.periodStart} → ${res.periodEnd}). Open the Overview tab to see it.`
        );
        onRefresh?.();
      } else if (!silent) {
        setNotice("No invoice rows to sync yet — upload a Customer Invoice Listing first.");
      }
      return res;
    } catch (e) {
      setError(`Weekly sync failed: ${e.message || e}`);
      return null;
    } finally {
      setSyncing(false);
    }
  };

  const invoiceFileCount = useMemo(() => invoiceFilesFrom(files).length, [files]);

  // Step-by-step recalculate with a visible checklist. Each stage sets its own
  // status (pending / running / done / error) plus a short numeric result so the
  // admin can watch the work happen instead of clicking a button that "silently
  // did something". We do the fetches directly here (via fetchAll) rather than
  // just calling onRefresh, so every stage's row count is visible before the
  // parent picks up the same data on its own re-fetch.
  const RECALC_STAGES = [
    { id: "files",       label: "Reload file library" },
    { id: "pushCust",    label: "Push customer files → customers_data (charts)" },
    { id: "pushBrand",   label: "Push brand files → brand_sales_data (charts)" },
    { id: "weekly",      label: "Sync invoice listings → weekly board" },
    { id: "customers",   label: "Fetch customer sales rows" },
    { id: "targets",     label: "Fetch monthly sales targets" },
    { id: "weeklyDb",    label: "Fetch weekly sales rows" },
    { id: "brands",      label: "Fetch brand sales rows (largest)" },
    { id: "reload",      label: "Refresh every dashboard chart" },
  ];
  const [recalculating, setRecalculating] = useState(false);
  const [lastRecalcAt, setLastRecalcAt] = useState(null);
  const [recalcSteps, setRecalcSteps] = useState({}); // { id: { status, detail } }

  // Reprocess uploaded files: for every archived workbook, download the xlsx
  // bytes from storage, re-run the parser, and write the fresh rows back into
  // data_files.rows_json. Old uploads (from before we captured rows_json) get
  // their rows filled in for the first time, and any file with stale/corrupt
  // rows gets rewritten from the source of truth. Then the fact-table syncs
  // run so the charts pick up the reprocessed data — no need to re-upload
  // anything from disk.
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState(null); // { index, total, name, kind }
  const reprocessUploaded = async () => {
    if (!confirm(
      "Reprocess every uploaded workbook?\n\n" +
      "For each archived file this will re-download from storage, re-parse the " +
      "xlsx, update the row data, then push customer/brand/invoice rows into " +
      "the chart tables. Use this when charts are missing scopes (like the " +
      "2026 wipe) — nothing on disk needs re-uploading."
    )) return;
    setReprocessing(true);
    setError(null);
    setNotice(null);
    setReprocessProgress({ index: 0, total: 1, name: "loading file list…", kind: "" });
    try {
      // Always work from a fresh listFiles so we know the storage paths and
      // ids match what's actually in the database right now.
      const current = await listFiles();
      setFiles(current);
      const res = await reprocessAllFiles(current, (p) => setReprocessProgress(p));
      setFiles(res.files);

      // Now push everything to the fact tables so the charts update.
      setReprocessProgress({ index: res.total, total: res.total, name: "pushing to customers_data…", kind: "sync" });
      const cust = await syncCustomersFromFiles(res.files);
      setReprocessProgress({ index: res.total, total: res.total, name: "pushing to brand_sales_data…", kind: "sync" });
      const brand = await syncBrandsFromFiles(res.files);
      let weekly = { rows: 0 };
      if (invoiceFilesFrom(res.files).length > 0) {
        setReprocessProgress({ index: res.total, total: res.total, name: "syncing weekly board…", kind: "sync" });
        weekly = await syncWeeklyFromFiles(res.files);
      }

      const parts = [
        `${res.reprocessed}/${res.total} file${res.total === 1 ? "" : "s"} reprocessed`,
        `${cust.rows.toLocaleString()} customer rows across ${cust.scopes} scope${cust.scopes === 1 ? "" : "s"}`,
        `${brand.rows.toLocaleString()} brand rows across ${brand.scopes} scope${brand.scopes === 1 ? "" : "s"}`,
      ];
      if (weekly.rows > 0) parts.push(`${weekly.weeks} weekly buckets`);
      setNotice(`Reprocess complete · ${parts.join(" · ")}. Dashboard refreshing…`);
      if (res.errors.length) {
        setError(
          `${res.errors.length} file(s) could not be reprocessed:\n${res.errors.slice(0, 5).join("\n")}` +
          (res.errors.length > 5 ? `\n…and ${res.errors.length - 5} more` : "")
        );
      }
      onRefresh?.();
    } catch (e) {
      setError(`Reprocess failed: ${e.message || e}`);
    } finally {
      setReprocessing(false);
      setReprocessProgress(null);
    }
  };

  const setStep = (id, patch) =>
    setRecalcSteps(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));

  const recalcAll = async () => {
    setRecalculating(true);
    setError(null);
    setNotice(null);
    // Seed every stage as "pending" so the checklist renders in full from step 0.
    setRecalcSteps(Object.fromEntries(RECALC_STAGES.map(s => [s.id, { status: "pending" }])));

    let failed = false;
    const runStage = async (id, task) => {
      setStep(id, { status: "running" });
      const t0 = performance.now();
      try {
        const detail = await task();
        const ms = Math.round(performance.now() - t0);
        setStep(id, { status: "done", detail, ms });
        return detail;
      } catch (e) {
        setStep(id, { status: "error", detail: e.message || String(e) });
        failed = true;
        throw e;
      }
    };

    let list = [];
    try {
      // 1. File library. runStage returns the DETAIL string for the UI, so we
      // capture the real list into the outer scope for later stages instead of
      // reusing the return value (which would leave `list` as the detail text
      // — the "(s || []).filter is not a function" bug).
      await runStage("files", async () => {
        list = await listFiles();
        setFiles(list);
        const n = list.filter(f => !f.deletedAt).length;
        return `${n} active file${n === 1 ? "" : "s"}`;
      });

      // 2. Push customer files → customers_data. This is the missing link that
      // makes uploaded workbooks actually change the charts: for each (sp, year)
      // the newest uploaded customer file replaces every row in customers_data
      // for that scope. Re-uploading a file with the same name just makes it
      // the newest and it wins. Empty files are skipped (see weekly.js) — the
      // skip list is echoed on the checklist row so a coverage gap is visible.
      await runStage("pushCust", async () => {
        const res = await syncCustomersFromFiles(list);
        if (res.scopes === 0 && (!res.skipped || res.skipped.length === 0)) {
          return "no customer files to push";
        }
        const preview = res.scopeLabels.slice(0, 3).join(", ");
        const more = res.scopeLabels.length > 3 ? ` +${res.scopeLabels.length - 3} more` : "";
        const skip = res.skipped?.length
          ? ` · skipped ${res.skipped.length}: ${res.skipped.slice(0, 2).join(", ")}${res.skipped.length > 2 ? "…" : ""}`
          : "";
        return `${res.rows.toLocaleString()} rows across ${res.scopes} scope${res.scopes === 1 ? "" : "s"} (${preview}${more})${skip}`;
      });

      // 3. Push brand files → brand_sales_data (same shape as step 2).
      await runStage("pushBrand", async () => {
        const res = await syncBrandsFromFiles(list);
        if (res.scopes === 0 && (!res.skipped || res.skipped.length === 0)) {
          return "no brand files to push";
        }
        const preview = res.scopeLabels.slice(0, 3).join(", ");
        const more = res.scopeLabels.length > 3 ? ` +${res.scopeLabels.length - 3} more` : "";
        const skip = res.skipped?.length
          ? ` · skipped ${res.skipped.length}: ${res.skipped.slice(0, 2).join(", ")}${res.skipped.length > 2 ? "…" : ""}`
          : "";
        return `${res.rows.toLocaleString()} rows across ${res.scopes} scope${res.scopes === 1 ? "" : "s"} (${preview}${more})${skip}`;
      });

      // 4. Invoice → weekly sync (idempotent). Skip cleanly when no invoice
      // files are present, but still mark the step "done" so the checklist
      // reads as complete rather than stuck.
      const invoiceCount = invoiceFilesFrom(list).length;
      if (invoiceCount === 0) {
        setStep("weekly", { status: "done", detail: "no invoice files to sync" });
      } else {
        await runStage("weekly", async () => {
          const res = await syncWeeklyFromFiles(list);
          if (res.rows === 0) return `already in sync (${invoiceCount} file${invoiceCount === 1 ? "" : "s"})`;
          return `${res.weeks} week${res.weeks === 1 ? "" : "s"} · ${res.rows} rep-week rows`;
        });
      }

      // 3-6. Pull each dashboard table directly so the row counts are visible
      // per source. onRefresh below will re-fire the same reads, but this way
      // the checklist shows real numbers, not a spinning icon.
      await runStage("customers", async () => {
        const rows = await fetchAll("customers_data", "sp,year,customer,months,total");
        return `${rows.length.toLocaleString()} rows`;
      });
      await runStage("targets", async () => {
        const rows = await fetchAll("sales_targets", "year,month,sp,target_amt");
        return `${rows.length.toLocaleString()} rows`;
      });
      await runStage("weeklyDb", async () => {
        const rows = await fetchAll("weekly_sales", "period_start,period_end,sp,amount,uploaded_at");
        return `${rows.length.toLocaleString()} rows`;
      });
      await runStage("brands", async () => {
        const rows = await fetchAll("brand_sales_data", "sp,year,customer,brand,amt,qty");
        return `${rows.length.toLocaleString()} rows`;
      });

      // 7. Nudge the parent to actually re-render every chart with fresh data.
      // The parent's own useEffect will re-run these same fetches — quick since
      // Supabase's connection is warm — and produce new object references so
      // memoised charts recompute.
      await runStage("reload", async () => {
        onRefresh?.();
        return "signalled parent refresh";
      });

      setLastRecalcAt(Date.now());
      const ok = RECALC_STAGES.filter(s => recalcSteps[s.id]?.status !== "error").length;
      setNotice(`Recalculated · ${ok}/${RECALC_STAGES.length} steps · dashboard now shows the latest data.`);
    } catch (e) {
      // The step that threw has already been marked "error"; leave the rest as
      // "pending" so the admin can see where it stopped.
      setError(`Recalculate stopped: ${e.message || e}`);
    } finally {
      setRecalculating(false);
    }
    void failed; // referenced above via setStep; suppress "unused" nag if enabled
  };

  // Live (non-trashed) files, narrowed by the search box and ordered by the
  // current sort. Sorting on 'kind' uses the label shown in the Type column so
  // A->Z matches what the eye reads, not the internal 'customer'/'brand' value.
  const active = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = files.filter(f => !f.deletedAt);
    if (q) {
      list = list.filter(f =>
        (f.name || "").toLowerCase().includes(q) ||
        (f.sp || "").toLowerCase().includes(q) ||
        String(f.year || "").includes(q) ||
        detectedLabel(f.kind).toLowerCase().includes(q)
      );
    }
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    const val = (f) => (key === "kind" ? detectedLabel(f.kind) : f[key]);
    return [...list].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "string" || typeof bv === "string") {
        // numeric:true so "Alan 2022" sorts before "Alan 2023" naturally
        return mul * String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
          numeric: true, sensitivity: "base",
        });
      }
      return mul * ((av ?? 0) - (bv ?? 0));
    });
  }, [files, sort, query]);

  // How the list is bucketed. 'type' groups by file kind (customer / brand /
  // invoice) which is what most admins want when scanning the library; 'month'
  // groups by upload date. Sticky per browser so admins don't have to re-pick
  // on every visit.
  const [groupBy, setGroupBy] = useState(() => {
    try { return localStorage.getItem("dataTab.groupBy") || "type"; } catch { return "type"; }
  });
  useEffect(() => {
    try { localStorage.setItem("dataTab.groupBy", groupBy); } catch {}
  }, [groupBy]);

  // Group active files by the selected axis. Each group keeps the current
  // sort order for the files inside it.
  const grouped = useMemo(() => {
    const buckets = new Map();
    if (groupBy === "type") {
      const KIND_ORDER = { customer: 0, brand: 1, invoice: 2 };
      for (const entry of active) {
        const key = entry.kind || "other";
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(entry);
      }
      const keys = [...buckets.keys()].sort((a, b) => {
        const ai = KIND_ORDER[a] ?? 99;
        const bi = KIND_ORDER[b] ?? 99;
        return ai - bi || a.localeCompare(b);
      });
      return keys.map(key => ({
        key,
        label: detectedLabel(key),
        color: kindColor(key),
        entries: buckets.get(key),
        totalSize: buckets.get(key).reduce((s, e) => s + (e.sizeBytes || 0), 0),
      }));
    }
    // groupBy === "month"
    for (const entry of active) {
      const key = monthKeyFor(entry.uploadedAt);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(entry);
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return b.localeCompare(a);
    });
    return keys.map(key => ({
      key,
      label: monthLabelFor(key),
      color: "rgba(var(--tint),0.55)",
      entries: buckets.get(key),
      totalSize: buckets.get(key).reduce((s, e) => s + (e.sizeBytes || 0), 0),
    }));
  }, [active, groupBy]);

  // Which group sections are expanded. Keys include the group-by axis so
  // switching between Type and Month keeps each layout's open state separate.
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [seenGroups, setSeenGroups] = useState(() => new Set());
  useEffect(() => {
    if (!grouped.length) return;
    const scoped = grouped.map(g => `${groupBy}:${g.key}`);
    const fresh = scoped.filter(k => !seenGroups.has(k));
    if (!fresh.length) return;
    setSeenGroups(prev => {
      const next = new Set(prev); fresh.forEach(k => next.add(k)); return next;
    });
    setOpenGroups(prev => {
      // First render for this axis: open the first (most-relevant) group only.
      const anyForAxis = [...prev].some(k => k.startsWith(`${groupBy}:`));
      if (!anyForAxis) return new Set([...prev, scoped[0]]);
      const next = new Set(prev); fresh.forEach(k => next.add(k)); return next;
    });
  }, [grouped, seenGroups, groupBy]);

  const groupKey = (k) => `${groupBy}:${k}`;
  const toggleGroup = (key) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      const scoped = groupKey(key);
      if (next.has(scoped)) next.delete(scoped);
      else next.add(scoped);
      return next;
    });
  };
  const expandAllGroups = () => setOpenGroups(prev => {
    const next = new Set(prev);
    grouped.forEach(g => next.add(groupKey(g.key)));
    return next;
  });
  const collapseAllGroups = () => setOpenGroups(prev => {
    const next = new Set(prev);
    grouped.forEach(g => next.delete(groupKey(g.key)));
    return next;
  });

  const liveCount = useMemo(() => files.filter(f => !f.deletedAt).length, [files]);
  const trashed = useMemo(
    () => files.filter(f => f.deletedAt).sort((a,b) => (b.deletedAt||0) - (a.deletedAt||0)),
    [files]
  );

  const onDownload = async (entry) => {
    setBusyId(entry.id);
    try {
      const url = await downloadUrl(entry);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const addFiles = (picked) => {
    setSelectedFiles(prev => {
      const seen = new Set(prev.map(f => f.name));
      return [...prev, ...picked.filter(f => !seen.has(f.name))];
    });
    setError(null);
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropRef.current) dropRef.current.style.borderColor = "rgba(var(--tint),0.1)";
    addFiles([...e.dataTransfer.files].filter(f => f.name.endsWith(".xlsx")));
  };

  const onUploadClick = async () => {
    const valid = selectedFiles.filter(f => parseFilename(f.name));
    if (!valid.length) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    const failures = [];
    let done = 0;
    for (const file of valid) {
      setProgress({ index: done, total: valid.length, file: file.name });
      try {
        const parsed = await parseFile(file);
        if (!parsed.ok) failures.push(`${file.name}: ${parsed.error}`);
        else await uploadFile(file, parsed);
      } catch (e) {
        failures.push(`${file.name}: ${e.message || e}`);
      }
      done += 1;
    }
    setProgress(null);
    setUploading(false);
    setSelectedFiles([]);
    if (failures.length) setError(`${failures.length} file(s) failed:\n${failures.join("\n")}`);
    const okCount = valid.length - failures.length;
    if (okCount > 0) setNotice(`Uploaded ${okCount} file${okCount === 1 ? "" : "s"}.`);
    const list = await refresh();
    // Push the freshly-uploaded workbooks into the fact tables the charts read
    // from. This is what makes an upload change what visitors see — before this,
    // customer/brand files only archived to data_files and every chart stayed
    // frozen. Best-effort: a sync failure surfaces as an inline error but does
    // not undo the upload itself.
    if (okCount > 0 && list) {
      const kinds = new Set(valid.map((f) => parseFilename(f.name)?.kind));
      const syncErrors = [];
      try {
        if (kinds.has("Sales Analysis by customer")) {
          const r = await syncCustomersFromFiles(list);
          if (r.scopes > 0) setNotice(
            `Uploaded ${okCount} file${okCount === 1 ? "" : "s"} · pushed ${r.rows.toLocaleString()} customer rows to the dashboard.`
          );
        }
      } catch (e) { syncErrors.push(`customer sync: ${e.message || e}`); }
      try {
        if ([...kinds].some((k) => /Stock Sales/i.test(k || ""))) {
          const r = await syncBrandsFromFiles(list);
          if (r.scopes > 0) setNotice(
            `Uploaded ${okCount} file${okCount === 1 ? "" : "s"} · pushed ${r.rows.toLocaleString()} brand rows to the dashboard.`
          );
        }
      } catch (e) { syncErrors.push(`brand sync: ${e.message || e}`); }
      if (kinds.has("Customer Invoice Listing")) {
        await runWeeklySync(list, { silent: true });
      }
      if (syncErrors.length) {
        setError(
          `Files uploaded, but pushing to the charts hit an error. ` +
          `Click Recalculate to retry.\n${syncErrors.join("\n")}`
        );
      } else {
        // Force every chart on every tab to recompute against the freshly
        // pushed fact-table rows. Without this the upload lands but the
        // dashboard keeps rendering the previous fetch.
        onRefresh?.();
      }
    }
  };

  const onUpdateFile = (entry) => {
    updateTargetRef.current = entry.id;
    updateInputRef.current?.click();
  };

  const onUpdateFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const targetId = updateTargetRef.current;
    updateTargetRef.current = null;
    if (!file || !targetId) return;
    const target = files.find(f => f.id === targetId);
    if (!target) return;
    setBusyId(targetId);
    setError(null);
    try {
      const parsed = await parseFile(file);
      if (!parsed.ok) {
        setError(`Update failed: ${parsed.error}`);
        return;
      }
      const updated = await replaceFile(target, file, parsed);
      const nextFiles = files.map(f => (f.id === updated.id ? updated : f));
      setFiles(nextFiles);
      setNotice(`"${updated.name}" replaced.`);
      // Replacing a workbook is the whole point of the Update button — the
      // dashboard must reflect the newer numbers immediately. Route each kind
      // through its fact-table sync, then nudge every chart to recompute.
      try {
        if (updated.kind === "customer") await syncCustomersFromFiles(nextFiles);
        if (updated.kind === "brand")    await syncBrandsFromFiles(nextFiles);
        if (updated.kind === "invoice")  await runWeeklySync(nextFiles, { silent: true });
        onRefresh?.();
      } catch (syncErr) {
        setError(
          `Replaced the file, but pushing to the charts failed. ` +
          `Click Recalculate to retry.\n${syncErr.message || syncErr}`
        );
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (entry) => {
    if (!confirm(`Move "${entry.name}" to trash? You can restore it later.`)) return;
    setBusyId(entry.id);
    try {
      const updated = await softDeleteFile(entry);
      setFiles(prev => prev.map(f => (f.id === updated.id ? updated : f)));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onRestore = async (entry) => {
    setBusyId(entry.id);
    try {
      const updated = await restoreFile(entry);
      setFiles(prev => prev.map(f => (f.id === updated.id ? updated : f)));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onPurge = async (entry) => {
    if (!confirm(`Permanently delete "${entry.name}" and its stored .xlsx? This cannot be undone.`)) return;
    setBusyId(entry.id);
    try {
      await purgeFile(entry);
      setFiles(prev => prev.filter(f => f.id !== entry.id));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const validNames = selectedFiles.filter(f => parseFilename(f.name));
  const invalidNames = selectedFiles.filter(f => !parseFilename(f.name));

  const SortHeader = ({ label, k }) => {
    const on = sort.key === k;
    const nextDir = on && sort.dir === "asc" ? "Z–A" : "A–Z";
    return (
      <th
        onClick={() => toggleSort(k)}
        title={`Sort by ${label} (${nextDir})`}
        style={{...thStyle, cursor:"pointer", userSelect:"none", color: on ? "#E8633B" : thStyle.color}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
          {label}
          <span style={{fontSize:9,opacity: on ? 1 : 0.35}}>
            {on ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}
          </span>
        </span>
      </th>
    );
  };

  return (
    <>
      <div style={{display:"flex",gap:16,marginBottom:16,flexWrap:"wrap"}}>
        <KPI label="Uploaded files" value={active.length} sub="admin-only · not visible to users" color="#E8633B" />
        <KPI label="Customer-year rows" value={data.customers?.length.toLocaleString() ?? "0"} sub="loaded into the dashboard" color="#34D399" />
        <KPI label="Brand-sale rows" value={data.brandSales?.length.toLocaleString() ?? "0"} sub={`across ${(data.brands || []).length} brands`} color="#A855F7" />
        <KPI label="Years covered" value={(data.years || []).join(", ") || "—"} sub={`${(data.salespeople || []).length} salespeople`} color="#3B82F6" />
      </div>

      {/* One-click "refresh everything the dashboard reads". Each stage renders
          its own checklist row below so the admin can watch the fetches finish
          instead of clicking a button that runs invisibly. */}
      <div style={{
        marginBottom:20,padding:"14px 18px",borderRadius:12,
        background:"linear-gradient(135deg, rgba(232,99,59,0.08), rgba(59,130,246,0.06))",
        border:"1px solid rgba(232,99,59,0.28)",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <div style={{fontSize:22,lineHeight:1,flexShrink:0}} aria-hidden="true">🔄</div>
          <div style={{flex:"1 1 260px",minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:2}}>
              Recalculate dashboard
            </div>
            <div style={{fontSize:12,color:"rgba(var(--tint),0.65)",lineHeight:1.5}}>
              Reload the file library, replay invoice listings into the Weekly Sales board, and re-fetch every table on every tab. Each step below turns green as it completes.
            </div>
          </div>
          {lastRecalcAt && !recalculating && (
            <div style={{fontSize:11,color:"rgba(var(--tint),0.55)",fontFamily:"'Space Mono',monospace",whiteSpace:"nowrap"}}>
              Last run {fmtDate(lastRecalcAt)}
            </div>
          )}
          <button
            onClick={recalcAll}
            disabled={recalculating}
            style={{
              display:"inline-flex",alignItems:"center",gap:8,
              background: recalculating ? "rgba(232,99,59,0.15)" : "#E8633B",
              color: recalculating ? "rgba(232,99,59,0.9)" : "#fff",
              border: recalculating ? "1px solid rgba(232,99,59,0.4)" : "none",
              borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:700,
              cursor: recalculating ? "wait" : "pointer",
              fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",
            }}>
            {recalculating ? (
              <>
                <span style={{
                  width:13,height:13,borderRadius:"50%",display:"inline-block",
                  border:"2px solid rgba(232,99,59,0.35)",borderTopColor:"#E8633B",
                  animation:"seedspin 0.8s linear infinite",
                }} />
                Recalculating…
              </>
            ) : "🔄 Recalculate now"}
          </button>
        </div>

        {Object.keys(recalcSteps).length > 0 && (
          <ol style={{
            listStyle:"none",padding:0,margin:"14px 0 0",
            display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(min(280px,100%), 1fr))",gap:8,
          }}>
            {RECALC_STAGES.map((stage, idx) => {
              const s = recalcSteps[stage.id] || { status: "pending" };
              const glyph =
                s.status === "done"    ? "✓" :
                s.status === "running" ? "" :
                s.status === "error"   ? "✕" : "○";
              const color =
                s.status === "done"    ? "#34D399" :
                s.status === "running" ? "#3B82F6" :
                s.status === "error"   ? "#F87171" : "rgba(var(--tint),0.35)";
              return (
                <li key={stage.id} style={{
                  display:"flex",alignItems:"center",gap:10,
                  padding:"8px 12px",borderRadius:8,fontSize:12,
                  background: s.status === "pending" ? "rgba(var(--tint),0.03)" : `${color}12`,
                  border: `1px solid ${s.status === "pending" ? "rgba(var(--tint),0.06)" : color + "40"}`,
                }}>
                  <span style={{
                    display:"inline-flex",alignItems:"center",justifyContent:"center",
                    width:20,height:20,borderRadius:"50%",flexShrink:0,
                    background: s.status === "pending" ? "rgba(var(--tint),0.06)" : `${color}22`,
                    color,fontSize:12,fontWeight:700,
                    border: s.status === "running" ? "none" : `1px solid ${color}66`,
                  }}>
                    {s.status === "running" ? (
                      <span style={{
                        width:11,height:11,borderRadius:"50%",display:"inline-block",
                        border:`2px solid ${color}40`,borderTopColor:color,
                        animation:"seedspin 0.8s linear infinite",
                      }} />
                    ) : glyph}
                  </span>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{color: s.status === "pending" ? "rgba(var(--tint),0.55)" : "var(--text)",fontWeight:500,lineHeight:1.3}}>
                      <span style={{color:"rgba(var(--tint),0.35)",fontFamily:"'Space Mono',monospace",marginRight:6}}>{idx+1}.</span>
                      {stage.label}
                    </div>
                    {s.detail && (
                      <div style={{color, fontSize:10.5,fontFamily:"'Space Mono',monospace",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {s.detail}{s.ms != null ? ` · ${s.ms} ms` : ""}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Reprocess uploaded files. The workbooks are already archived in the
          data-files bucket; this replays every one of them (download → parse →
          update rows_json → push to fact tables) so the dashboard picks up
          rows the DB never got the first time. This is how the missing-2026
          scopes come back when the files ARE uploaded but the fact tables are
          empty. Kept visually distinct from Recalculate so admins reach for it
          only when a chart is actually missing data. */}
      <div style={{
        display:"flex",alignItems:"center",gap:14,flexWrap:"wrap",marginBottom:20,
        padding:"12px 16px",borderRadius:12,
        background:"rgba(245,158,11,0.06)",
        border:"1px dashed rgba(245,158,11,0.4)",
      }}>
        <div style={{fontSize:22,lineHeight:1,flexShrink:0}} aria-hidden="true">🔁</div>
        <div style={{flex:"1 1 260px",minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:2}}>
            Reprocess uploaded files (recovery)
          </div>
          <div style={{fontSize:12,color:"rgba(var(--tint),0.65)",lineHeight:1.5}}>
            When a chart is missing scopes despite the files being uploaded (e.g. the earlier 2026 wipe). Re-downloads every archived workbook from storage, re-parses it, and pushes fresh rows into customers_data / brand_sales_data / weekly_sales. Slower than Recalculate but self-healing — no need to re-upload from disk.
          </div>
          {reprocessProgress && (
            <div style={{fontSize:11,color:"rgba(245,158,11,0.9)",marginTop:6,fontFamily:"'Space Mono',monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              [{Math.min(reprocessProgress.index + 1, reprocessProgress.total)}/{reprocessProgress.total}] {reprocessProgress.kind ? `${reprocessProgress.kind} · ` : ""}{reprocessProgress.name}
            </div>
          )}
        </div>
        <button
          onClick={reprocessUploaded}
          disabled={reprocessing || recalculating}
          style={{
            display:"inline-flex",alignItems:"center",gap:8,
            background: "rgba(245,158,11,0.15)",
            color: "#F59E0B",
            border: "1px solid rgba(245,158,11,0.55)",
            borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:700,
            cursor: (reprocessing || recalculating) ? "not-allowed" : "pointer",
            fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",
            opacity: (reprocessing || recalculating) ? 0.75 : 1,
          }}>
          {reprocessing ? (
            <>
              <span style={{
                width:13,height:13,borderRadius:"50%",display:"inline-block",
                border:"2px solid rgba(245,158,11,0.35)",borderTopColor:"#F59E0B",
                animation:"seedspin 0.8s linear infinite",
              }} />
              Reprocessing…
            </>
          ) : "🔁 Reprocess uploaded files"}
        </button>
      </div>

      {/* The link between this tab and the Weekly Sales board. Uploading an
          invoice listing now feeds the board automatically, but this button
          also rebuilds it from every invoice file already in the library — the
          one click that backfills weeks uploaded before that link existed. */}
      {invoiceFileCount > 0 && (
        <div style={{
          display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",marginBottom:20,
          padding:"14px 18px",borderRadius:14,
          background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.28)",
        }}>
          <div style={{fontSize:22,lineHeight:1,flexShrink:0}} aria-hidden="true">📊</div>
          <div style={{flex:"1 1 260px",minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,color:"var(--text)",marginBottom:2}}>
              Weekly Sales board
            </div>
            <div style={{fontSize:12,color:"rgba(var(--tint),0.65)",lineHeight:1.5}}>
              {invoiceFileCount} invoice listing{invoiceFileCount===1?"":"s"} in the library feed the weekly view.
              New uploads sync on their own — use this to rebuild every week from the current files.
            </div>
          </div>
          <button
            onClick={() => runWeeklySync(files)}
            disabled={syncing}
            style={{
              display:"inline-flex",alignItems:"center",gap:8,
              background: syncing ? "rgba(59,130,246,0.12)" : "#3B82F6",
              color: syncing ? "rgba(59,130,246,0.9)" : "#fff",
              border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:700,
              cursor: syncing ? "wait" : "pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",
            }}>
            {syncing ? (
              <>
                <span style={{
                  width:13,height:13,borderRadius:"50%",display:"inline-block",
                  border:"2px solid rgba(59,130,246,0.35)",borderTopColor:"#3B82F6",
                  animation:"seedspin 0.8s linear infinite",
                }} />
                Syncing…
              </>
            ) : "↻ Sync Weekly Sales"}
          </button>
        </div>
      )}

      {error && (
        <div style={{marginBottom:16,padding:"10px 14px",background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:8,fontSize:12,color:"#F87171",whiteSpace:"pre-wrap"}}>
          ⚠ {error}
        </div>
      )}
      {notice && (
        <div style={{marginBottom:16,padding:"10px 14px",background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.25)",borderRadius:8,fontSize:12,color:"#34D399",display:"flex",justifyContent:"space-between",gap:10}}>
          <span>✓ {notice}</span>
          <button onClick={() => setNotice(null)} style={{background:"transparent",border:"none",color:"#34D399",cursor:"pointer",fontSize:13}}>✕</button>
        </div>
      )}

      <Card>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
          <div style={{fontSize:14,fontWeight:600}}>
            📁 Uploaded files
            <span style={{color:"rgba(var(--tint),0.4)",fontWeight:400,fontSize:12}}>
              {" · "}
              {query.trim() && active.length !== liveCount
                ? `${active.length} of ${liveCount} files`
                : `${liveCount} file${liveCount===1?"":"s"}`}
              {" · admin-only"}
            </span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {liveCount > 0 && (
              <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                <span style={{position:"absolute",left:10,fontSize:11,opacity:0.4,pointerEvents:"none"}}>🔍</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, rep, year, type…"
                  style={{
                    background:"rgba(var(--tint),0.04)",
                    border:"1px solid rgba(var(--tint),0.1)",
                    color:"var(--text)",borderRadius:8,
                    padding:"6px 26px 6px 28px",fontSize:12,width:230,outline:"none",
                    fontFamily:"'DM Sans',sans-serif",
                  }}
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    title="Clear search"
                    style={{position:"absolute",right:6,background:"transparent",border:"none",
                            color:"rgba(var(--tint),0.45)",cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
                )}
              </div>
            )}
            {liveCount > 0 && (
              <div style={{
                display:"flex",alignItems:"center",gap:0,
                border:"1px solid rgba(var(--tint),0.12)",borderRadius:8,overflow:"hidden",
              }}>
                <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"rgba(var(--tint),0.5)",padding:"0 10px",fontWeight:600}}>Group by</span>
                {["type","month"].map((g, i) => (
                  <button key={g} onClick={() => setGroupBy(g)} style={{
                    background: groupBy === g ? "rgba(232,99,59,0.15)" : "transparent",
                    color: groupBy === g ? "var(--st-accent)" : "rgba(var(--tint),0.65)",
                    border:"none",
                    borderLeft: i === 0 ? "1px solid rgba(var(--tint),0.12)" : "1px solid rgba(var(--tint),0.12)",
                    padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",
                    fontFamily:"'DM Sans',sans-serif",textTransform:"capitalize",
                  }}>{g}</button>
                ))}
              </div>
            )}
            {grouped.length > 1 && (
              <>
                <button onClick={expandAllGroups} style={actionBtn("rgba(255,255,255,0.5)")} title="Expand every group">Expand all</button>
                <button onClick={collapseAllGroups} style={actionBtn("rgba(255,255,255,0.5)")} title="Collapse every group">Collapse all</button>
              </>
            )}
            <button onClick={refresh} style={actionBtn("#3B82F6")}>↻ Refresh</button>
          </div>
        </div>

        {/* The long explainer is only worth the space once there is actually
            something here; when empty this card collapses to one line so it
            stops dominating the screen above the upload area. */}
        {liveCount > 0 && (
          <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",marginBottom:14,lineHeight:1.6}}>
            These workbooks live in a private bucket that only admins can read. Regular users never see this tab, and the
            database blocks them from the files even if they call the API directly. Downloads are short-lived signed links.
          </div>
        )}

        {loading ? (
          <div style={{fontSize:12,color:"rgba(var(--tint),0.4)",padding:"4px 0"}}>Loading files…</div>
        ) : !liveCount ? (
          <div style={{fontSize:12,color:"rgba(var(--tint),0.45)",padding:"2px 0 4px",lineHeight:1.6}}>
            Nothing on the server yet — files you upload below will appear here. Stored privately, admin-only.
          </div>
        ) : !active.length ? (
          <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",padding:"14px 0",textAlign:"center"}}>
            No file matches “{query}”.{" "}
            <button onClick={() => setQuery("")} style={{background:"transparent",border:"none",color:"#3B82F6",cursor:"pointer",fontSize:12,textDecoration:"underline",padding:0}}>
              Clear search
            </button>
          </div>
        ) : (
          <div style={{overflowX:"auto",border:"1px solid rgba(var(--tint),0.06)",borderRadius:10}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:"rgba(var(--tint),0.03)"}}>
                  <SortHeader label="File" k="name" />
                  <SortHeader label="Type" k="kind" />
                  <SortHeader label="Size" k="sizeBytes" />
                  <SortHeader label="Uploaded" k="uploadedAt" />
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(group => {
                  const isOpen = openGroups.has(groupKey(group.key));
                  return (
                    <Fragment key={group.key}>
                      <tr onClick={() => toggleGroup(group.key)}
                          style={{cursor:"pointer",background:`${group.color}12`}}>
                        <td colSpan={5} style={{
                          padding:"9px 14px",
                          borderTop:`1px solid ${group.color}33`,
                          borderLeft:`3px solid ${group.color}`,
                          borderBottom: isOpen ? `1px solid ${group.color}33` : "none",
                          fontSize:12,fontWeight:600,
                        }}>
                          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                            <span style={{color: group.color,width:12,display:"inline-block",fontFamily:"'Space Mono',monospace"}}>{isOpen ? "▾" : "▸"}</span>
                            <span style={{color: group.color}}>{group.label}</span>
                            <span style={{color:"rgba(var(--tint),0.5)",fontWeight:400,fontSize:11,fontFamily:"'Space Mono',monospace"}}>
                              · {group.entries.length} file{group.entries.length===1?"":"s"} · {fmtSize(group.totalSize)}
                            </span>
                          </div>
                        </td>
                      </tr>
                      {isOpen && group.entries.map(entry => (
                        <tr key={entry.id}>
                          <td style={{...tdStyle,minWidth:280}}>
                            <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                              <span style={{color: kindColor(entry.kind),fontSize:14,marginTop:1,flexShrink:0}}>📄</span>
                              <div style={{minWidth:0,flex:1}}>
                                <div title={entry.name} style={{fontWeight:500,wordBreak:"break-word",lineHeight:1.35}}>{entry.name}</div>
                                <div style={{fontSize:10,color:"rgba(var(--tint),0.45)",fontFamily:"'Space Mono',monospace",marginTop:2}}>
                                  {entry.sp || "—"} · {entry.year || "—"} · {entry.rowCount} rows
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={tdStyle}>
                            <span style={{display:"inline-block",padding:"3px 10px",borderRadius:6,background:`${kindColor(entry.kind)}15`,color: kindColor(entry.kind),fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
                              {detectedLabel(entry.kind)}
                            </span>
                          </td>
                          <td style={{...tdStyle,fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.7)",whiteSpace:"nowrap"}}>{fmtSize(entry.sizeBytes)}</td>
                          <td style={{...tdStyle,fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.6)",whiteSpace:"nowrap",fontSize:11}}>{fmtDate(entry.uploadedAt)}</td>
                          <td style={tdStyle}>
                            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                              <button onClick={() => setViewing(entry)} style={actionBtn("#3B82F6")}>👁 View</button>
                              <button onClick={() => onDownload(entry)} disabled={busyId === entry.id} style={actionBtn("#34D399", busyId === entry.id)}>⬇ Save</button>
                              <button onClick={() => onUpdateFile(entry)} disabled={busyId === entry.id} style={actionBtn("#E8633B", busyId === entry.id)}>↻ Update</button>
                              <button onClick={() => onDelete(entry)} disabled={busyId === entry.id} style={actionBtn("#F87171", busyId === entry.id)}>🗑 Remove</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {trashed.length > 0 && (
          <div style={{marginTop:16}}>
            <button onClick={() => setShowTrash(s => !s)} style={{background:"transparent",border:"none",color:"rgba(var(--tint),0.5)",fontSize:12,cursor:"pointer",padding:0}}>
              {showTrash ? "▾" : "▸"} 🗑 Trash ({trashed.length})
            </button>
            {showTrash && (
              <div style={{marginTop:10,border:"1px solid rgba(var(--tint),0.06)",borderRadius:10,overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:"rgba(var(--tint),0.03)"}}>
                      <th style={thStyle}>File</th>
                      <th style={thStyle}>Trashed</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trashed.map(entry => (
                      <tr key={entry.id}>
                        <td style={tdStyle}>
                          <div style={{fontWeight:500}}>{entry.name}</div>
                          <div style={{fontSize:10,color:"rgba(var(--tint),0.45)",fontFamily:"'Space Mono',monospace"}}>{entry.sp || "—"} · {entry.year || "—"}</div>
                        </td>
                        <td style={{...tdStyle,fontFamily:"'Space Mono',monospace",fontSize:11,color:"rgba(var(--tint),0.6)"}}>{fmtDate(entry.deletedAt)}</td>
                        <td style={tdStyle}>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                            <button onClick={() => setViewing(entry)} style={actionBtn("#3B82F6")}>👁 View</button>
                            <button onClick={() => onRestore(entry)} disabled={busyId === entry.id} style={actionBtn("#34D399", busyId === entry.id)}>↺ Restore</button>
                            <button onClick={() => onPurge(entry)} disabled={busyId === entry.id} style={actionBtn("#F87171", busyId === entry.id)}>✕ Delete forever</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>Upload workbooks</div>
        <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",marginBottom:16,lineHeight:1.6}}>
          Drag <strong>.xlsx</strong> files matching one of these naming patterns:
          <ul style={{margin:"8px 0 0",paddingLeft:18,display:"flex",flexDirection:"column",gap:4}}>
            <li>
              <code style={{fontFamily:"'Space Mono',monospace",color:"#34D399",fontSize:11}}>{"<SP> <YYYY> Sales Analysis by customer.xlsx"}</code>
              <span style={{color:"rgba(var(--tint),0.4)"}}> — yearly customer summary</span>
            </li>
            <li>
              <code style={{fontFamily:"'Space Mono',monospace",color:"#A855F7",fontSize:11}}>{"<SP> <YYYY> Stock Sales Analysis - Summary by Brand.xlsx"}</code>
              <span style={{color:"rgba(var(--tint),0.4)"}}> — yearly brand summary</span>
            </li>
            <li>
              <code style={{fontFamily:"'Space Mono',monospace",color:"#3B82F6",fontSize:11}}>{"Customer Invoice Listing <period>.xlsx"}</code>
              <span style={{color:"rgba(var(--tint),0.4)"}}> — monthly invoice detail (feeds weekly view)</span>
            </li>
          </ul>
        </div>

        <div
          ref={dropRef}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (dropRef.current) dropRef.current.style.borderColor = "rgba(232,99,59,0.6)"; }}
          onDragLeave={() => { if (dropRef.current) dropRef.current.style.borderColor = "rgba(var(--tint),0.1)"; }}
          onDrop={onDrop}
          style={{
            border:"2px dashed rgba(var(--tint),0.1)",borderRadius:12,padding:"40px 20px",
            textAlign:"center",cursor:"pointer",transition:"all 0.2s",background:"rgba(var(--tint),0.01)"
          }}>
          <div style={{fontSize:28,marginBottom:8,opacity:0.4}}>⤴</div>
          <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Drop xlsx files here</div>
          <div style={{fontSize:12,color:"rgba(var(--tint),0.4)"}}>or click to browse</div>
          <input ref={inputRef} type="file" accept=".xlsx" multiple style={{display:"none"}}
            onChange={(e) => addFiles([...e.target.files])} />
        </div>

        {selectedFiles.length > 0 && (
          <>
            {/* Action bar sits directly under the drop zone. It used to live below
                the file list, which pushed it off-screen with a long selection —
                so the one button that matters was invisible. */}
            <div style={{
              display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",
              marginTop:16,padding:"12px 14px",borderRadius:10,
              background:"rgba(232,99,59,0.08)",border:"1px solid rgba(232,99,59,0.28)",
            }}>
              <div style={{flex:"1 1 220px",fontSize:12,lineHeight:1.5}}>
                <strong style={{color:"var(--text)"}}>{validNames.length} file{validNames.length===1?"":"s"} ready</strong>
                <span style={{color:"rgba(var(--tint),0.65)"}}> — still on your computer, not uploaded yet</span>
                {invalidNames.length > 0 && (
                  <span style={{color:"#F87171"}}> · {invalidNames.length} skipped (filename doesn't match the pattern)</span>
                )}
              </div>
              <button
                onClick={onUploadClick}
                disabled={uploading || !validNames.length}
                style={{
                  background: uploading || !validNames.length ? "rgba(var(--tint),0.05)" : "#E8633B",
                  color: uploading || !validNames.length ? "rgba(var(--tint),0.3)" : "#fff",
                  border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,
                  cursor: uploading || !validNames.length ? "not-allowed" : "pointer",
                  fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",
                }}>
                {uploading ? "Uploading…" : `⤴ Upload ${validNames.length} file${validNames.length===1?"":"s"}`}
              </button>
              <button
                onClick={() => setSelectedFiles([])}
                disabled={uploading}
                style={{
                  background:"transparent",border:"1px solid rgba(var(--tint),0.15)",
                  color:"rgba(var(--tint),0.6)",borderRadius:8,padding:"9px 14px",fontSize:12,
                  cursor: uploading ? "not-allowed" : "pointer",fontFamily:"'DM Sans',sans-serif",
                }}>Clear</button>
            </div>

            {progress && (
              <div style={{marginTop:12}}>
                <div style={{fontSize:12,color:"rgba(var(--tint),0.6)",fontFamily:"'Space Mono',monospace",marginBottom:6}}>
                  [{progress.index + 1}/{progress.total}] uploading {progress.file}
                </div>
                <div style={{height:6,background:"rgba(var(--tint),0.06)",borderRadius:3,overflow:"hidden"}}>
                  <div style={{
                    width:`${Math.round((progress.index / Math.max(progress.total,1)) * 100)}%`,
                    height:"100%",background:"#E8633B",transition:"width 0.2s",
                  }} />
                </div>
              </div>
            )}

            <div style={{fontSize:11,color:"rgba(var(--tint),0.45)",margin:"14px 0 6px",textTransform:"uppercase",letterSpacing:1}}>
              Selected files
            </div>
            <div style={{maxHeight:240,overflowY:"auto",border:"1px solid rgba(var(--tint),0.04)",borderRadius:8}}>
              {selectedFiles.map(f => {
                const info = parseFilename(f.name);
                return (
                  <div key={f.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:"1px solid rgba(var(--tint),0.03)",fontSize:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                      <span style={{color: info ? "#34D399" : "#F87171",fontWeight:600,flexShrink:0}}>{info ? "✓" : "✗"}</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{f.name}</span>
                      {info && <span style={{color:"rgba(var(--tint),0.4)",fontSize:10,fontFamily:"'Space Mono',monospace",flexShrink:0}}>
                        {info.kind === "Customer Invoice Listing"
                          ? `Invoice · ${info.periodLabel || (info.year ?? "—")}`
                          : `${info.sp} · ${info.year}`}
                      </span>}
                    </div>
                    <button onClick={() => setSelectedFiles(prev => prev.filter(x => x.name !== f.name))} disabled={uploading} style={{background:"transparent",border:"none",color:"rgba(var(--tint),0.3)",cursor: uploading ? "not-allowed" : "pointer",fontSize:14,padding:"0 0 0 8px"}}>✕</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      <DataSourceStatus data={data} />

      <input ref={updateInputRef} type="file" accept=".xlsx" style={{display:"none"}} onChange={onUpdateFilePicked} />
      {viewing && <FilePreviewModal entry={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

// Coverage of the data loaded for this admin: SP x year with row counts.
function DataSourceStatus({ data }) {
  const rows = data.customers || [];
  const brandRows = data.brandSales || [];
  if (!rows.length) return null;
  const sps = [...new Set(rows.map(r => r.sp))].sort();
  const years = [...new Set(rows.map(r => r.year))].sort();
  const custByKey = new Map();
  rows.forEach(r => custByKey.set(`${r.sp}|${r.year}`, (custByKey.get(`${r.sp}|${r.year}`) || 0) + 1));
  const brandByKey = new Map();
  brandRows.forEach(r => brandByKey.set(`${r.sp}|${r.year}`, (brandByKey.get(`${r.sp}|${r.year}`) || 0) + 1));

  return (
    <Card>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:14,fontWeight:600}}>
          🗂️ Dataset coverage <span style={{color:"rgba(var(--tint),0.4)",fontWeight:400,fontSize:12}}>· {sps.length} salespeople × {years.length} years</span>
        </div>
        <div style={{fontSize:11,color:"rgba(var(--tint),0.5)"}}>each cell shows customer / brand-sale row count</div>
      </div>
      <div style={{overflow:"auto",border:"1px solid rgba(var(--tint),0.06)",borderRadius:10}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr style={{background:"rgba(var(--tint),0.03)"}}>
              <th style={thStyle}>Salesperson</th>
              {years.map(y => (
                <th key={y} style={{...thStyle,textAlign:"center",fontFamily:"'Space Mono',monospace"}}>{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sps.map(sp => (
              <tr key={sp} style={{borderTop:"1px solid rgba(var(--tint),0.05)"}}>
                <td style={{...tdStyle,fontWeight:600}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:8,height:8,borderRadius:2,background:"#E8633B"}} />
                    {sp}
                  </div>
                </td>
                {years.map(y => {
                  const c = custByKey.get(`${sp}|${y}`) || 0;
                  const b = brandByKey.get(`${sp}|${y}`) || 0;
                  const has = c > 0 || b > 0;
                  return (
                    <td key={y} style={{...tdStyle,textAlign:"center",color: has ? "var(--text)" : "rgba(var(--tint),0.25)"}}>
                      {has ? (
                        <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,lineHeight:1.3}}>
                          <div>{c.toLocaleString()}c</div>
                          <div style={{color:"rgba(var(--tint),0.55)"}}>{b.toLocaleString()}b</div>
                        </div>
                      ) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:10,fontSize:10,color:"rgba(var(--tint),0.45)",display:"flex",gap:14,flexWrap:"wrap"}}>
        <span>c = customer-year rows (monthly sales)</span>
        <span>b = brand-sale rows (per-customer × brand)</span>
      </div>
    </Card>
  );
}

function FilePreviewModal({ entry, onClose }) {
  const rows = Array.isArray(entry.rows) ? entry.rows : [];
  const cols = entry.kind === "customer"
    ? ["sp","year","customer","total",...MONTH_NAMES]
    : entry.kind === "invoice"
    ? ["date","invoice","customer","sp","amount"]
    : ["sp","year","customer","brand","amt","qty"];
  const getCell = (r, c) => {
    if (entry.kind === "customer" && MONTH_NAMES.includes(c)) return r.months?.[MONTH_NAMES.indexOf(c)];
    return r[c];
  };
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={(e) => e.stopPropagation()} style={{background:"var(--bg, #0A0A0F)",border:"1px solid rgba(var(--tint),0.1)",borderRadius:14,maxWidth:1200,width:"100%",maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid rgba(var(--tint),0.06)"}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:14,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{entry.name}</div>
            <div style={{fontSize:11,color:"rgba(var(--tint),0.5)",marginTop:3,fontFamily:"'Space Mono',monospace"}}>
              {entry.sp || "—"} · {entry.year || "—"} · {entry.kind} · {rows.length} rows
            </div>
          </div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:"rgba(var(--tint),0.6)",fontSize:20,cursor:"pointer",padding:"4px 10px"}}>✕</button>
        </div>
        <div style={{overflow:"auto",flex:1}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"'Space Mono',monospace"}}>
            <thead style={{position:"sticky",top:0,background:"rgba(15,15,20,0.95)",backdropFilter:"blur(8px)"}}>
              <tr>
                {cols.map(c => (
                  <th key={c} style={{textAlign:"left",padding:"8px 10px",borderBottom:"1px solid rgba(var(--tint),0.08)",color:"rgba(var(--tint),0.6)",fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,fontSize:10}}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 1000).map((r, i) => (
                <tr key={i} style={{borderBottom:"1px solid rgba(var(--tint),0.03)"}}>
                  {cols.map(c => {
                    const v = getCell(r, c);
                    const num = typeof v === "number";
                    return (
                      <td key={c} style={{padding:"6px 10px",textAlign: num ? "right" : "left",color: num && v === 0 ? "rgba(var(--tint),0.3)" : "rgba(var(--tint),0.85)"}}>
                        {num ? v.toLocaleString("en-MY",{maximumFractionDigits:2}) : (v ?? "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 1000 && (
            <div style={{padding:"10px 14px",fontSize:11,color:"rgba(var(--tint),0.4)",textAlign:"center"}}>
              Showing first 1000 of {rows.length} rows.
            </div>
          )}
          {!rows.length && (
            <div style={{padding:"40px 20px",fontSize:12,color:"rgba(var(--tint),0.5)",textAlign:"center"}}>
              No rows stored for this file.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
