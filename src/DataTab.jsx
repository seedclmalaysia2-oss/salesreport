// Data tab — admin-only file library.
//
// Uploaded workbooks live in the private 'data-files' bucket with a row in
// public.data_files. They are for admins only; regular users never see this
// tab and RLS returns them nothing from data_files or the bucket even if they
// call the API directly. This component is only ever rendered for an admin
// (Dashboard gates it), but nothing here is load-bearing for security — the
// database is.

import { useState, useEffect, useMemo, useRef } from "react";
import { parseFile, parseFilename } from "./lib/parseXlsx.js";
import {
  listFiles, uploadFile, replaceFile,
  softDeleteFile, restoreFile, purgeFile, downloadUrl,
} from "./lib/files.js";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtSize(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function detectedLabel(kind) {
  return kind === "customer" ? "Sales Analysis · Customer" : "Stock Sales · Brand";
}

function fmtDate(ts) {
  return ts
    ? new Date(ts).toLocaleString("en-MY", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "—";
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

export default function DataTab({ data }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [showTrash, setShowTrash] = useState(false);

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
      setFiles(await listFiles());
      setError(null);
    } catch (e) {
      setError(`Could not load files: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

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
    await refresh();
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
      setFiles(prev => prev.map(f => (f.id === updated.id ? updated : f)));
      setNotice(`"${updated.name}" replaced.`);
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
      <div style={{display:"flex",gap:16,marginBottom:24,flexWrap:"wrap"}}>
        <KPI label="Uploaded files" value={active.length} sub="admin-only · not visible to users" color="#E8633B" />
        <KPI label="Customer-year rows" value={data.customers?.length.toLocaleString() ?? "0"} sub="loaded into the dashboard" color="#34D399" />
        <KPI label="Brand-sale rows" value={data.brandSales?.length.toLocaleString() ?? "0"} sub={`across ${(data.brands || []).length} brands`} color="#A855F7" />
        <KPI label="Years covered" value={(data.years || []).join(", ") || "—"} sub={`${(data.salespeople || []).length} salespeople`} color="#3B82F6" />
      </div>

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
                {active.map(entry => (
                  <tr key={entry.id}>
                    <td style={{...tdStyle,maxWidth:280}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                        <span style={{color: entry.kind === "customer" ? "#34D399" : "#A855F7",fontSize:14,marginTop:1,flexShrink:0}}>📄</span>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:260}}>{entry.name}</div>
                          <div style={{fontSize:10,color:"rgba(var(--tint),0.45)",fontFamily:"'Space Mono',monospace",marginTop:2}}>
                            {entry.sp || "—"} · {entry.year || "—"} · {entry.rowCount} rows
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{display:"inline-block",padding:"3px 10px",borderRadius:6,background:`${entry.kind === "customer" ? "#34D399" : "#A855F7"}15`,color: entry.kind === "customer" ? "#34D399" : "#A855F7",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
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
        <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",marginBottom:16,lineHeight:1.5}}>
          Drag <strong>.xlsx</strong> files matching the naming pattern:<br/>
          <code style={{fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.7)",fontSize:11}}>{"<SP> <YYYY> Sales Analysis by customer.xlsx"}</code> &nbsp;or&nbsp;
          <code style={{fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.7)",fontSize:11}}>{"<SP> <YYYY> Stock Sales Analysis - Summary by Brand.xlsx"}</code>
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
                      {info && <span style={{color:"rgba(var(--tint),0.4)",fontSize:10,fontFamily:"'Space Mono',monospace",flexShrink:0}}>{info.sp} · {info.year}</span>}
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
