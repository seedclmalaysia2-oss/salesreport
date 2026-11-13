import { useEffect, useState } from "react";

// The running build label in the header ("202611 build 00184", from api/build.js)
// with a refresh button beside it. "test build" on a preview deployment, under
// `vite dev`, or when the lookup fails. The refresh is a full reload, so a phone
// that has kept the dashboard open picks up a newer build as well as fresh figures.
export default function BuildLabel() {
  const [label, setLabel] = useState(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let live = true;
    fetch("/api/build", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && typeof j?.label === "string") setLabel(j.label); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6,minWidth:0}}>
      <span style={{
        fontSize:11,color:"rgba(var(--tint),0.62)",fontFamily:"'Space Mono',monospace",
        letterSpacing:0.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
      }}>{label || "test build"}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        aria-label="Refresh the page"
        title="Refresh"
        style={{
          width:28,height:28,flex:"none",borderRadius:"50%",padding:0,
          display:"inline-grid",placeItems:"center",
          background:"rgba(var(--tint),0.05)",
          border:"1px solid rgba(var(--tint),0.12)",
          color:"var(--text)",cursor:"pointer",
          transition:"background 200ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(var(--tint),0.09)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(var(--tint),0.05)"; }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>
  );
}
