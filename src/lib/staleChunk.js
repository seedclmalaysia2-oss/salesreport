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
