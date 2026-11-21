import InstallApp from "./InstallApp.jsx";
import { useBuildLabel } from "./BuildLabel.jsx";
import logoUrl from "./assets/seed-logo.png";
import "./topbar.css";

// The SEED top navigation (house standard, first built for SEED MY HR on
// 2026-11-21 after the wholesale portal's bar; see the HR repo's seed-app-icon
// skill). One full-width row: logo, app pill, build badge, refresh and theme on
// the left; the year and the app-wide links in the middle; who is signed in
// and the exit icon at the right end.

function initials(name) {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function TopBar({ user, years, selectedYear, onYear, themeMode, onToggleTheme, onLogout }) {
  const build = useBuildLabel();
  const name = user?.name || (user?.isAdmin ? "Admin" : user?.sp) || user?.email || "";
  const role = user?.isAdmin ? "Admin" : user?.canUpload ? "Uploader" : user?.sp ? `Sales · ${user.sp}` : "Sales";
  const dark = themeMode === "dark";

  return (
    <header className="tb">
      <div className="tb-left">
        <a className="tb-brand" href="/" aria-label="Sales dashboard">
          <img className="tb-logo" src={logoUrl} alt="" />
        </a>
        <span className="tb-pill">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 6-6" /></svg>
          Sales
        </span>
        <span className="tb-build">{build || "test build"}</span>
        <button type="button" className="tb-icon" onClick={() => window.location.reload()} aria-label="Refresh the page" title="Refresh">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
        </button>
        <button type="button" className="tb-icon" onClick={onToggleTheme}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
          {dark ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
          )}
        </button>
      </div>

      <nav className="tb-nav" aria-label="Top bar">
        <div className="tb-years" role="group" aria-label="Year">
          {years.map(y => (
            <button key={y} type="button" className="tb-link" aria-pressed={y === selectedYear} onClick={() => onYear(y)}>{y}</button>
          ))}
        </div>
        <InstallApp className="tb-link" />
        <a className="tb-link" href="https://seedclmalaysiastore.com" title="Back to the SEED CL Malaysia hub">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
          </svg>
          SEED CL HUB
        </a>
      </nav>

      <div className="tb-right">
        {user && (
          <div className="tb-who" aria-label="Signed in as">
            <span className="tb-avatar" aria-hidden="true">{initials(name)}</span>
            <span className="tb-who-text">
              <span className="tb-name" title={user.email || name}>{name}</span>
              <span className="tb-role">{role}</span>
            </span>
          </div>
        )}
        {onLogout && (
          <button type="button" className="tb-exit" onClick={onLogout} aria-label="Sign out" title="Sign out">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
