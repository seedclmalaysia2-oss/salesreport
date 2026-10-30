// After a deploy, a tab that was already open still runs the previous build,
// whose lazily-loaded chunks (e.g. files-<hash>.js) no longer exist on the
// server — so the next dynamic import fails with "Failed to fetch dynamically
// imported module". The fix is simply loading the new build, so do that once
// rather than surfacing a confusing error.

const STALE_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;
const KEY = "seed:staleChunkReloadAt";

export function isStaleChunkError(err) {
  return STALE_RE.test(String(err?.message || err || ""));
}

// Reload at most once a minute, so a genuinely missing chunk can't loop.
// Returns true when a reload was started.
export function reloadForNewBuild() {
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
  if (Date.now() - last < 60_000) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
  window.location.reload();
  return true;
}

// The entry script this tab is running, e.g. "/assets/index-IBsLN-Wy.js".
function currentEntry() {
  const el = document.querySelector('script[type="module"][src*="/assets/index-"]');
  return el ? new URL(el.src, location.href).pathname : null;
}

async function latestEntry() {
  const r = await fetch("/", { cache: "no-store" });
  if (!r.ok) return null;
  return (await r.text()).match(/\/assets\/index-[^"']+\.js/)?.[0] || null;
}

// A tab (or an installed Home-Screen app) left open keeps running the build it
// started with — a rep can sit on yesterday's version for days. Check for a
// newer deploy whenever the app comes back to the foreground and every 10
// minutes:
//   • returning to the app → reload straight into the new build (nothing is
//     mid-edit at that moment);
//   • while in use → show a small "New version — Reload" bar instead, so an
//     upload in progress is never interrupted.
export function watchForNewBuild() {
  const running = currentEntry();
  if (!running) return; // dev server — nothing to compare
  let bar = null;
  const showBar = () => {
    if (bar) return;
    bar = document.createElement("button");
    bar.textContent = "↻ New version of the dashboard available — tap to reload";
    bar.style.cssText =
      "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2000;" +
      "padding:10px 16px;border-radius:10px;border:none;cursor:pointer;" +
      "background:#E8633B;color:#fff;font:600 13px 'DM Sans',sans-serif;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:calc(100vw - 32px)";
    bar.onclick = () => location.reload();
    document.body.appendChild(bar);
  };
  const check = async (returning) => {
    try {
      const latest = await latestEntry();
      if (!latest || latest === running) return;
      if (returning) location.reload();
      else showBar();
    } catch { /* offline — try again later */ }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check(true);
  });
  setInterval(() => check(false), 10 * 60 * 1000);
}
