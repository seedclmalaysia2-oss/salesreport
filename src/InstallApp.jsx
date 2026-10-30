// "Install app" in the dashboard header — same behaviour as the HR dashboard's
// button. Android / desktop Chrome get the real install prompt; iPhone Safari
// has none, so it shows the Add to Home Screen steps. Hidden once the app is
// already running from the home screen.

import { useEffect, useRef, useState } from "react";

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

function detectPlatform() {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac with touch.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

export default function InstallApp({ style }) {
  const [installed, setInstalled] = useState(isStandalone);
  const [open, setOpen] = useState(false);
  const platform = useRef(detectPlatform()).current;

  useEffect(() => {
    const onInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (installed) return null;

  const click = async () => {
    // Captured in main.jsx — Chrome fires it once, often before sign-in.
    const p = window.__seedInstallPrompt;
    if (p) {
      await p.prompt();
      const choice = await p.userChoice;
      window.__seedInstallPrompt = null;
      if (choice.outcome === "accepted") setInstalled(true);
      return;
    }
    setOpen(true);
  };

  const h3 = { fontSize: 13, fontWeight: 700, margin: "16px 0 6px", color: "var(--text)" };
  const ol = { margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: "rgba(var(--tint),0.85)" };
  const note = { fontSize: 12, color: "rgba(var(--tint),0.6)", marginTop: 12, lineHeight: 1.5 };

  return (
    <>
      <button type="button" onClick={click} title="Install the Sales dashboard as an app on this device" style={style}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(var(--tint),0.09)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(var(--tint),0.05)"; }}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" />
        </svg>
        Install app
      </button>
      {open && (
        <div onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Install the Sales app"
          style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--bg)",
              border: "1px solid rgba(var(--tint),0.14)", borderRadius: 16, padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              fontFamily: "'DM Sans',sans-serif" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Install the Sales app</div>
            {platform !== "android" && (
              <>
                <div style={h3}>iPhone or iPad (Safari)</div>
                <ol style={ol}>
                  <li>Open this site in <strong>Safari</strong> (not Chrome or another browser).</li>
                  <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
                  <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
                </ol>
              </>
            )}
            {platform !== "ios" && (
              <>
                <div style={h3}>Android (Chrome)</div>
                <ol style={ol}>
                  <li>Open this site in <strong>Chrome</strong>.</li>
                  <li>Tap the <strong>⋮</strong> menu at the top right.</li>
                  <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>), then <strong>Install</strong>.</li>
                </ol>
              </>
            )}
            {platform === "other" && <div style={note}>On a computer, Chrome and Edge show an install icon at the right of the address bar.</div>}
            <div style={note}>Open the app from your home screen, sign in once, then tap 🔔 Enable alerts on the weekly board to get the sales updates.</div>
            <button onClick={() => setOpen(false)}
              style={{ marginTop: 16, width: "100%", padding: "9px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13,
                background: "rgba(var(--tint),0.05)", border: "1px solid rgba(var(--tint),0.12)", color: "var(--text)", fontFamily: "'DM Sans',sans-serif" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
