import { useEffect, useState } from "react";
import markUrl from "./assets/seed-mark.png";

// HR-standard welcome / loading screen: the SEED lens badge spinning inside a
// turning ring, greeting the signed-in user by name while their data loads.
// Shown post-auth (we already know who they are) in place of the generic
// LoadingScreen. Mirrors the house standard used across SEED's dashboards.
//
// Brand: deep navy field (#0D1F4A), white lens badge, SEED blue (#006FBA).
// `name` is the person; `stage` is the current load step (kept subtle).
const NAVY = "#0D1F4A";
const BLUE = "#006FBA";
const COMPANY = "SEED CONTACT LENS (M) SDN BHD";

export default function WelcomeScreen({ name, stage }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const display = (name || "").toString().trim().toUpperCase() || "WELCOME";

  return (
    <div style={{
      minHeight: "100vh", width: "100%",
      background: `radial-gradient(120% 90% at 50% 18%, #163163 0%, ${NAVY} 46%, #081635 100%)`,
      color: "#fff", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans','Inter',system-ui,sans-serif", textAlign: "center",
      padding: "40px 24px", boxSizing: "border-box",
    }}>
      <style>{`
        @keyframes seedring { to { transform: rotate(360deg); } }
        @keyframes seedfade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes seeddim { 0%,100% { opacity:.45 } 50% { opacity:.9 } }
      `}</style>

      {/* Lens loader: white SEED badge inside a turning ring */}
      <div style={{ position: "relative", width: 168, height: 168, marginBottom: 30 }}>
        <svg width="168" height="168" viewBox="0 0 168 168"
          style={{ position: "absolute", inset: 0, animation: "seedring 1.15s linear infinite" }}>
          <defs>
            <linearGradient id="seedArc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={BLUE} stopOpacity="0" />
              <stop offset="1" stopColor="#4FA8E0" stopOpacity="1" />
            </linearGradient>
          </defs>
          <circle cx="84" cy="84" r="79" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
          <circle cx="84" cy="84" r="79" fill="none" stroke="url(#seedArc)" strokeWidth="4"
            strokeLinecap="round" strokeDasharray="150 500" />
        </svg>
        {/* White lens badge with the stacked SEED logo */}
        <div style={{
          position: "absolute", inset: 14, borderRadius: "50%", background: "#fff",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          boxShadow: "0 10px 40px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(13,31,74,0.05)", gap: 3,
        }}>
          <img src={markUrl} alt="" width="40" height="64" style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 26, fontWeight: 800, color: NAVY, letterSpacing: 1.5, lineHeight: 1 }}>SEED</div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: BLUE, letterSpacing: 3, textTransform: "lowercase" }}>contact lens</div>
        </div>
      </div>

      <div style={{ animation: "seedfade .5s ease both" }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>
          Welcome back
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1.15, marginBottom: 10, color: "#fff" }}>
          {display}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 1.2, color: "#7FB6E6", marginBottom: 2 }}>
          {COMPANY}
        </div>
      </div>

      {/* subtle loading line */}
      <div style={{ marginTop: 26, minHeight: 18, fontSize: 12, color: "rgba(255,255,255,0.5)", animation: "seeddim 1.8s ease-in-out infinite" }}>
        {stage || "Loading your dashboard…"}
      </div>
      {elapsed >= 8 && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 8, maxWidth: 300, lineHeight: 1.6 }}>
          Still working — a slow connection can make the first load take a little longer.
        </div>
      )}

      {/* Powered-by footer */}
      <div style={{ position: "absolute", bottom: 26, display: "flex", alignItems: "center", gap: 7,
        fontSize: 10.5, letterSpacing: 1.5, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: BLUE }} />
        Powered by SEEDCLMALAYSIA
      </div>
    </div>
  );
}
