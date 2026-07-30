// Single source of truth for the light/dark mode decision.
//
// The Dashboard owns the full token map (THEMES in Dashboard.jsx) because its
// charts need resolved hex values that CSS vars can't reach. But the mode
// *decision* — which of the two modes is active right now — lives here so the
// pre-auth full-screen states (login, loading, errors in App.jsx / LoginScreen)
// agree with the Dashboard instead of hardcoding dark. Two modes only:
//   • dark  → Slate  (the documented default)
//   • light → Crisp  (the strongest-daylight option)

export const DARK_KEY = "slate";
export const LIGHT_KEY = "crisp";

// Follow the device's setting when the user hasn't chosen one.
export function prefersLightScheme() {
  try {
    return typeof window !== "undefined" && !!window.matchMedia
      && window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch { return false; }
}

// Fold any legacy theme key onto the two current modes so a returning user
// never lands on a theme that no longer exists: Paper → Crisp (both light),
// Midnight/Carbon → Slate (both dark). Returns null for an unrecognised or
// empty value so the caller can fall back to the system setting.
export function migrateThemeKey(stored) {
  if (stored === LIGHT_KEY || stored === "paper" || stored === "light") return LIGHT_KEY;
  if (stored === DARK_KEY || stored === "midnight" || stored === "carbon" || stored === "dark") return DARK_KEY;
  return null;
}

// The theme key to use right now: a saved manual choice wins; with nothing
// saved, follow the phone's light/dark setting. Read at render time by the
// pre-auth screens (they're transient, so no live OS listener is needed).
export function resolveThemeKey() {
  let stored = null;
  try { stored = localStorage.getItem("seedTheme"); } catch {}
  return migrateThemeKey(stored) || (prefersLightScheme() ? LIGHT_KEY : DARK_KEY);
}

// Minimal palette for the pre-auth full-screen states. Mirrors the Dashboard's
// Slate / Crisp backgrounds and ink so sign-in matches the app the user lands
// in. Muted values are kept dark enough on light to clear WCAG AA for the small
// labels they carry (the daylight requirement in PRODUCT.md). `accent` uses the
// light-theme signal-orange variant (#CA3C12) on light so white text on the
// primary button clears contrast, per DESIGN.md's Daylight Rule.
export const SCREEN_THEME = {
  [DARK_KEY]: {
    mode: "dark",
    bg: "#0F172A",
    ink: "#F1F5F9",
    sub: "rgba(241,245,249,0.6)",
    label: "rgba(241,245,249,0.45)",
    eyebrow: "rgba(241,245,249,0.35)",
    cardBg: "rgba(241,245,249,0.02)",
    cardBorder: "rgba(241,245,249,0.08)",
    inputBg: "rgba(241,245,249,0.04)",
    inputBorder: "rgba(241,245,249,0.10)",
    track: "rgba(241,245,249,0.08)",
    link: "rgba(241,245,249,0.6)",
    shadow: "0 20px 60px rgba(0,0,0,0.5)",
    accent: "#E8633B",
    accentDisabled: "rgba(232,99,59,0.5)",
    warn: "#F59E0B",
    bad: "#F87171",
    ok: "#34D399",
  },
  [LIGHT_KEY]: {
    mode: "light",
    bg: "#F1F5F9",
    ink: "#0F172A",
    sub: "rgba(15,23,42,0.65)",
    label: "rgba(15,23,42,0.6)",
    eyebrow: "rgba(15,23,42,0.45)",
    cardBg: "rgba(255,255,255,0.85)",
    cardBorder: "rgba(15,23,42,0.10)",
    inputBg: "rgba(15,23,42,0.03)",
    inputBorder: "rgba(15,23,42,0.14)",
    track: "rgba(15,23,42,0.08)",
    link: "rgba(15,23,42,0.6)",
    shadow: "0 20px 60px rgba(15,23,42,0.15)",
    accent: "#CA3C12",
    accentDisabled: "rgba(202,60,18,0.45)",
    warn: "#9A6204",
    bad: "#DD0606",
    ok: "#177D58",
  },
};

export function resolveScreenTheme() {
  return SCREEN_THEME[resolveThemeKey()] || SCREEN_THEME[DARK_KEY];
}
