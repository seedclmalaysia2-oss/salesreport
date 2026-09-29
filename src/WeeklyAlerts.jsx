// Per-user Web Push opt-in, shown in the weekly board header. Each rep enables
// alerts once on their own phone. Self-manages its state from the real push
// subscription so it always reflects reality (on / off / blocked / iOS needs
// install). Renders nothing on browsers that can't do push, or before the
// admin has configured the VAPID key.

import { useEffect, useState } from "react";
import { pushStatus, enablePush, disablePush } from "./lib/push.js";

export default function WeeklyAlertsButton() {
  const [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const refresh = () => pushStatus().then(setStatus).catch(() => setStatus("unsupported"));
  useEffect(() => { refresh(); }, []);

  // Nothing to show if the platform can't do push or it isn't set up yet.
  if (status === "loading" || status === "unsupported" || status === "unconfigured") return null;

  const on = status === "enabled";

  const handle = async () => {
    setNote(null);
    if (status === "needs-install") {
      setNote("On iPhone: tap Share → Add to Home Screen, open the app from your Home Screen, then enable alerts here.");
      return;
    }
    if (status === "denied") {
      setNote("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.");
      return;
    }
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setNote("Weekly alerts turned off on this device.");
      } else {
        await enablePush();
        setNote("You're set — you'll get a push when the weekly report is sent.");
      }
      await refresh();
    } catch (e) {
      setNote(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = on ? "Alerts on"
    : status === "denied" ? "Alerts blocked"
    : status === "needs-install" ? "Get alerts"
    : "Enable alerts";

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <button
        onClick={handle}
        disabled={busy}
        aria-pressed={on}
        title={on ? "Weekly push alerts are on for this device — click to turn off" : "Get a push notification when the weekly report is sent"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          borderRadius: 8, padding: "8px 15px", fontSize: 13, fontWeight: 600,
          cursor: busy ? "wait" : "pointer", fontFamily: "'DM Sans',sans-serif",
          whiteSpace: "nowrap", lineHeight: 1, transition: "background 0.15s, border-color 0.15s",
          background: on ? "color-mix(in srgb, var(--st-ok) 15%, transparent)" : "color-mix(in srgb, var(--st-info) 10%, transparent)",
          color: on ? "var(--st-ok)" : "var(--st-info)",
          border: `1px solid color-mix(in srgb, ${on ? "var(--st-ok)" : "var(--st-info)"} 35%, transparent)`,
        }}>
        <span style={{ fontSize: 13, lineHeight: 1 }}>{on ? "🔔" : "🔕"}</span> {label}
      </button>
      {note && (
        <span style={{ fontSize: 11, color: "rgba(var(--tint),0.7)", lineHeight: 1.45, maxWidth: 260 }}>{note}</span>
      )}
    </span>
  );
}
