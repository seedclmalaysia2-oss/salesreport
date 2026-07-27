import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, LabelList, ComposedChart, ReferenceLine } from "recharts";
import WeeklySalesCard from "./WeeklySalesCard.jsx";
// Admin-only panels. Only one account can open these, so there is no reason
// for everyone else to download them — and DataTab drags in the xlsx parser.
const DataTab = lazy(() => import("./DataTab.jsx"));
const AdminUsers = lazy(() => import("./AdminUsers.jsx"));

// Uploads used to be parsed into these keys while the dashboard ran open to
// everyone, and the cache took priority over the server's response. With
// per-rep scoping back on that cache is a leak: it predates RLS, so it holds
// the whole team's numbers and would render for whoever signs in on this
// browser. Clear it once, and never write it again — the backend is the only
// source of truth now.
const LEGACY_CACHE_KEYS = ["salesDashboardUserData", "salesDashboardFileRegistry"];

function purgeLegacyCache() {
  for (const k of LEGACY_CACHE_KEYS) {
    try { localStorage.removeItem(k); } catch {}
  }
}

// Layout breakpoints. The dashboard is inline-styled, so media queries can't
// reach most of it — this hook lets the same styles switch on viewport width.
function useMediaQuery(q) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(q).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(q);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    // Belt and braces: some embedded/preview browsers resize the viewport
    // without dispatching the media-query change event, which would leave the
    // layout stuck in whatever mode it first mounted in (e.g. after a phone
    // rotates). resize always fires.
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, [q]);
  return matches;
}

// Global rules that inline styles can't express: stop the page scrolling
// sideways on a phone, let wide tables scroll inside themselves, and keep
// tap targets from being cramped.
const RESPONSIVE_CSS = `
  html, body { max-width: 100%; overflow-x: hidden; }
  * { -webkit-tap-highlight-color: transparent; }
  .seed-scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .seed-tabs { scrollbar-width: none; }
  .seed-tabs::-webkit-scrollbar { display: none; }
  @keyframes seedspin { to { transform: rotate(360deg); } }
  @media (max-width: 768px) {
    .recharts-wrapper, .recharts-surface { max-width: 100% !important; }
    /* Wide data tables must scroll inside their own box. Without this they
       stretch the page and the whole dashboard scrolls sideways on a phone. */
    [data-seed-theme] table {
      display: block;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      max-width: 100%;
      font-size: 11px;
      white-space: nowrap;
    }
    [data-seed-theme] table thead, [data-seed-theme] table tbody { width: max-content; min-width: 100%; }

    /* Everything below is the CSS half of the responsive layout. The isMobile
       hook handles the same cases in JS, but a stylesheet rule keeps the phone
       layout correct even if React hasn't re-rendered after a rotate/resize —
       CSS re-evaluates on its own. !important is needed to beat inline styles. */
    [data-seed-theme] div[style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
    .seed-tabs { flex-wrap: nowrap !important; overflow-x: auto !important; }
  }
`;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const SALESPEOPLE_ORDER = ["Alan","Dino","Khen","Sakinah","Simon","Seed Malaysia"];
const YEARS_FALLBACK = [2022,2023,2024,2025,2026];

// A second, non-colour channel for the year-over-year lines. Colour alone can't
// carry identity (WCAG 1.4.1), and overlapping lines are the hardest case: the
// selected year stays solid so it still reads as the subject.
const YEAR_DASHES = ["6 3", "2 3", "10 4", "1 3", "8 3 2 3"];

// Texture as a second channel for the stacked bar charts, where reps sit in one
// column and colour is otherwise the only thing telling adjacent segments apart
// (WCAG 1.4.1). Each rep gets a signature weave layered over their fill, so a
// segment is identifiable in greyscale and under colour-blindness — and because
// the Bar's fill becomes the pattern, the chart legend swatch inherits the
// texture for free. Kept deliberately faint to respect the flat, calm surface.
const seriesSlug = (sp) => `seedpat-${String(sp).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const seriesFill = (colors, sp) => (colors[sp] ? `url(#${seriesSlug(sp)})` : "#888");

// relative luminance, to pick a texture overlay that reads on the rep's OWN fill
// (black on light colours, white on dark) rather than on the theme background.
function hexLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// One <pattern> per rep, keyed to SALESPEOPLE_ORDER so the weave is stable per
// person. Six textures: solid / fwd-diagonal / dots / back-diagonal / horizontal
// / crosshatch. Rendered into a document-scoped hidden <svg>; paint-server refs
// resolve across the whole document, so every chart can point at these ids.
function texturePaths(kind, ov) {
  const s = { stroke: ov, strokeWidth: 1.1, fill: "none", shapeRendering: "crispEdges" };
  switch (kind) {
    case "diag":   return <path d="M-1,1 L1,-1 M0,8 L8,0 M7,9 L9,7" {...s} />;
    case "back":   return <path d="M7,-1 L9,1 M0,0 L8,8 M-1,7 L1,9" {...s} />;
    case "dots":   return <><circle cx="2" cy="2" r="1" fill={ov} /><circle cx="6" cy="6" r="1" fill={ov} /></>;
    case "horiz":  return <path d="M0,2 L8,2 M0,6 L8,6" {...s} />;
    case "cross":  return <path d="M0,8 L8,0 M0,0 L8,8" {...s} />;
    default:       return null; // solid
  }
}
const TEXTURE_ORDER = ["solid", "diag", "dots", "back", "horiz", "cross"];

function ChartPatterns({ colors, order }) {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        {order.map((sp, i) => {
          const color = colors[sp];
          if (!color) return null;
          const ov = hexLum(color) > 0.45 ? "rgba(0,0,0,0.34)" : "rgba(255,255,255,0.45)";
          return (
            <pattern key={sp} id={seriesSlug(sp)} width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill={color} />
              {texturePaths(TEXTURE_ORDER[i % TEXTURE_ORDER.length], ov)}
            </pattern>
          );
        })}
      </defs>
    </svg>
  );
}

// Semantic status colours, per theme family — the same reason the series palette
// is split. The bright dark-theme values (#34D399 etc.) sit at ~2.3–3:1 on the
// light "sunlight" themes, so a headline number or a trend arrow was failing
// contrast exactly where daylight legibility matters most. The light variants
// are darkened to clear 4.5:1 on both #F1F5F9 and #FAF7F2 while holding their
// hue, and still give white text ≥5:1 so button fills work. ok=ahead,
// bad=behind, watch=near-target, info=neutral, accent=Signal Orange,
// qty=quantity charts, alt=incidental purple.
const STATUS_DARK = {
  ok: "#34D399", bad: "#F87171", watch: "#F59E0B", info: "#3B82F6",
  accent: "#E8633B", qty: "#10B981", alt: "#A855F7", region: "#EC4899",
};
const STATUS_LIGHT = {
  ok: "#177D58", bad: "#DD0606", watch: "#9A6204", info: "#0662F9",
  accent: "#CA3C12", qty: "#077D56", alt: "#9831FA", region: "#B31069",
};

// ============================================================
// Series palettes — one per theme family, and that split is deliberate.
//
// A single palette cannot serve both. Clearing WCAG 1.4.11's 3:1 against
// near-white (#F1F5F9) caps a colour's relative luminance at 0.265; clearing it
// against near-black (#0F172A) demands at least 0.135. Forcing six colours into
// that 0.13-wide band makes them near-identical in luminance, which is exactly
// what collapses them under colour-blind vision — the old single palette scored
// dE 6.1 (deuteranopia) and 3.4 (tritanopia) between reps, i.e. indistinguishable.
//
// Splitting per theme frees each set to use a wide luminance range, so the six
// separate by lightness as well as hue. Both sets were solver-optimised and
// verified: every colour clears 3:1 on its own backgrounds, and worst-case
// separation is dE >= 20 for normal/protanopia/deuteranopia and >= 15 for
// tritanopia (~1 in 10,000, and covered by the non-colour cues besides).
//
// Hues stay near each rep's original colour so people still recognise their own.
// Note none of these equal a status colour: identity and performance must never
// be readable as each other.
const SERIES_DARK = {
  "Alan": "#E28B59",
  "Dino": "#6890CD",
  "Khen": "#4DEDE0",
  "Sakinah": "#9A3DF0",
  "Simon": "#E0D046",
  "Seed Malaysia": "#D42F71",
};

const SERIES_LIGHT = {
  "Alan": "#E06711",
  "Dino": "#1832C6",
  "Khen": "#2A9C70",
  "Sakinah": "#C259E2",
  "Simon": "#5C5410",
  "Seed Malaysia": "#7C1968",
};

const fmt = (v) => {
  if (v >= 1000000) return `${(v/1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v/1000).toFixed(0)}K`;
  return v?.toFixed(0) ?? "0";
};

const fmtFull = (v) => `RM ${Number(v).toLocaleString("en-MY", {minimumFractionDigits:2, maximumFractionDigits:2})}`;

const CustomTooltip = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{background:"var(--tooltip-bg)",border:"1px solid var(--tooltip-border)",borderRadius:8,padding:"10px 14px",fontSize:12,color:"var(--tooltip-text)",boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
      <div style={{fontWeight:600,marginBottom:6,color:"var(--text)",fontSize:13}}>{label}</div>
      {payload.map((p,i) => (
        <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:p.color}} />
          <span style={{opacity:0.7}}>{p.name}:</span>
          <span style={{fontWeight:600}}>{fmtFull(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

const KPI = ({label, value, sub, trend, color}) => (
  <div style={{background:"rgba(var(--tint),0.03)",border:"1px solid rgba(var(--tint),0.06)",borderRadius:12,padding:"20px 24px",flex:1,minWidth:180}}>
    <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:1.5,color:"rgba(var(--tint),0.4)",marginBottom:8,fontFamily:"'DM Sans',sans-serif"}}>{label}</div>
    {/* Falls back to the theme ink, not #fff — a white value is invisible on
        the Paper and Crisp light themes. */}
    <div style={{fontSize:28,fontWeight:700,color:color||"var(--text)",fontFamily:"'Space Mono',monospace",lineHeight:1.1}}>{value}</div>
    {sub && <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",marginTop:6}}>{sub}</div>}
    {trend !== undefined && (
      <div style={{fontSize:12,marginTop:6,color:trend>=0?"var(--st-ok)":"var(--st-bad)",fontWeight:600}}>
        {trend>=0?"▲":"▼"} {Math.abs(trend).toFixed(1)}% vs prev year
      </div>
    )}
  </div>
);

// role="tab" + roving tabindex so a screen reader announces the group as tabs
// with a selected state, and the arrow keys move between them (WAI-ARIA tabs
// pattern). Only the active tab is in the page tab-order; the container's
// onKeyDown owns arrow/Home/End navigation.
const TabButton = ({active, children, onClick, onKeyDown, accent, tabKey}) => (
  <button
    role="tab"
    id={`tab-${tabKey}`}
    aria-selected={active}
    aria-controls={`panel-${tabKey}`}
    tabIndex={active ? 0 : -1}
    onClick={onClick}
    onKeyDown={onKeyDown}
    style={{
      background: active ? (accent ? "rgba(52,211,153,0.15)" : "rgba(232,99,59,0.15)") : "transparent",
      color: active ? (accent ? "var(--st-ok)" : "var(--st-accent)") : "rgba(var(--tint),0.5)",
      border: active ? `1px solid ${accent ? "rgba(52,211,153,0.3)" : "rgba(232,99,59,0.3)"}` : "1px solid transparent",
      borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: active ? 600 : 400,
      cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans',sans-serif",
      letterSpacing: 0.3
    }}>{children}</button>
);

const Pill = ({label, active, onClick}) => (
  <button onClick={onClick} style={{
    background: active ? "var(--st-accent)" : "rgba(var(--tint),0.05)",
    color: active ? "#fff" : "rgba(var(--tint),0.5)",
    border: "none", borderRadius: 20, padding: "6px 16px", fontSize: 12, fontWeight: 600,
    cursor: "pointer", transition: "all 0.2s", fontFamily: "'Space Mono',monospace"
  }}>{label}</button>
);

const Card = ({children, style}) => (
  <div style={{background:"rgba(var(--tint),0.02)",border:"1px solid rgba(var(--tint),0.06)",borderRadius:14,padding:20,...style}}>
    {children}
  </div>
);

// ============================================================
// 5 color themes designed for readability + sustained-screen comfort.
// Each ships its full token set so charts (SVG-attr-based) work too.
// ============================================================
const THEMES = {
  slate: {
    series: SERIES_DARK,
    status: STATUS_DARK,
    name: "Slate", subtitle: "Soft dark · default", mode: "dark",
    swatch: ["#0F172A", "#1E293B", "#E2E8F0", "#FB923C"],
    bg: "#0F172A",
    text: "#F1F5F9",
    tintRgb: "226, 232, 240",
    chartTickFill: "rgba(226, 232, 240, 0.65)",
    chartTickFillDim: "rgba(226, 232, 240, 0.82)",
    chartGrid: "rgba(148, 163, 184, 0.18)",
    tooltipBg: "rgba(15, 23, 42, 0.97)",
    tooltipBorder: "rgba(148, 163, 184, 0.35)",
    tooltipText: "#F1F5F9",
    cellTrack: "rgba(148, 163, 184, 0.06)",
    heatmapBaseAlpha: 0.10,
  },
  midnight: {
    series: SERIES_DARK,
    status: STATUS_DARK,
    name: "Midnight", subtitle: "Deep ocean blue", mode: "dark",
    swatch: ["#0B1426", "#152843", "#BAE6FD", "#22D3EE"],
    bg: "#0B1426",
    text: "#E0F2FE",
    tintRgb: "186, 230, 253",
    chartTickFill: "rgba(186, 230, 253, 0.65)",
    chartTickFillDim: "rgba(186, 230, 253, 0.82)",
    chartGrid: "rgba(125, 211, 252, 0.16)",
    tooltipBg: "rgba(11, 20, 38, 0.97)",
    tooltipBorder: "rgba(125, 211, 252, 0.32)",
    tooltipText: "#E0F2FE",
    cellTrack: "rgba(186, 230, 253, 0.05)",
    heatmapBaseAlpha: 0.10,
  },
  paper: {
    series: SERIES_LIGHT,
    status: STATUS_LIGHT,
    name: "Paper", subtitle: "Warm cream", mode: "light",
    swatch: ["#FAF7F2", "#FFFFFF", "#1C1917", "#EA580C"],
    bg: "#FAF7F2",
    text: "#1C1917",
    tintRgb: "41, 37, 36",
    chartTickFill: "rgba(41, 37, 36, 0.68)",
    chartTickFillDim: "rgba(41, 37, 36, 0.85)",
    chartGrid: "rgba(41, 37, 36, 0.10)",
    tooltipBg: "rgba(255, 255, 255, 0.98)",
    tooltipBorder: "rgba(28, 25, 23, 0.18)",
    tooltipText: "#1C1917",
    cellTrack: "rgba(28, 25, 23, 0.06)",
    heatmapBaseAlpha: 0.05,
  },
  crisp: {
    series: SERIES_LIGHT,
    status: STATUS_LIGHT,
    name: "Crisp", subtitle: "Cool light · pro", mode: "light",
    swatch: ["#F1F5F9", "#FFFFFF", "#0F172A", "#0EA5E9"],
    bg: "#F1F5F9",
    text: "#0F172A",
    tintRgb: "30, 41, 59",
    chartTickFill: "rgba(30, 41, 59, 0.68)",
    chartTickFillDim: "rgba(30, 41, 59, 0.85)",
    chartGrid: "rgba(30, 41, 59, 0.10)",
    tooltipBg: "rgba(255, 255, 255, 0.98)",
    tooltipBorder: "rgba(30, 41, 59, 0.18)",
    tooltipText: "#0F172A",
    cellTrack: "rgba(30, 41, 59, 0.06)",
    heatmapBaseAlpha: 0.05,
  },
  carbon: {
    series: SERIES_DARK,
    status: STATUS_DARK,
    name: "Carbon", subtitle: "Max contrast", mode: "dark",
    swatch: ["#000000", "#0F0F0F", "#FFFFFF", "#FFD60A"],
    bg: "#000000",
    text: "#FFFFFF",
    tintRgb: "255, 255, 255",
    chartTickFill: "rgba(255, 255, 255, 0.75)",
    chartTickFillDim: "rgba(255, 255, 255, 0.92)",
    chartGrid: "rgba(255, 255, 255, 0.18)",
    tooltipBg: "rgba(0, 0, 0, 0.98)",
    tooltipBorder: "rgba(255, 255, 255, 0.35)",
    tooltipText: "#FFFFFF",
    cellTrack: "rgba(255, 255, 255, 0.06)",
    heatmapBaseAlpha: 0.12,
  },
};

function migrateThemeKey(stored) {
  if (stored && THEMES[stored]) return stored;
  if (stored === "light") return "paper";
  if (stored === "dark") return "slate";
  return "slate";
}

export default function Dashboard({ data: incomingData, user, brandsLoading, onLogout, onRefresh }) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const isNarrow = useMediaQuery("(max-width: 1100px)");
  // Recharts entrance animations are JS-driven, so the global CSS
  // reduced-motion reset can't reach them; gate them here instead. No effect
  // for the vast majority without the preference set.
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [tab, setTab] = useState("overview");
  // Ordered list of the tab keys actually shown (Data/Users are admin-only),
  // and the arrow-key handler that drives the WAI-ARIA tabs roving focus.
  const visibleTabKeys = [
    "overview","monthly","team","customers","yoy","drilldown",
    "brands","cohort","heatmap","targets",
    ...(user?.isAdmin ? ["data","users"] : []),
  ];
  const onTablistKeyDown = (e) => {
    const keys = visibleTabKeys;
    const i = keys.indexOf(tab);
    if (i < 0) return;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = keys[(i + 1) % keys.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = keys[(i - 1 + keys.length) % keys.length];
    else if (e.key === "Home") next = keys[0];
    else if (e.key === "End") next = keys[keys.length - 1];
    if (next) {
      e.preventDefault();
      setTab(next);
      // Focus follows selection. Every tab button is always in the DOM, and
      // programmatic focus ignores the roving tabindex, so we can focus the
      // target synchronously — no rAF/timeout dependency (rAF doesn't fire in
      // backgrounded/headless contexts, which would strand focus there).
      document.getElementById(`tab-${next}`)?.focus();
    }
  };
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedSP, setSelectedSP] = useState("All");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [topCustomersBySpView, setTopCustomersBySpView] = useState("grid");
  // "all" or a year in YEARS. Defaults to all-time so the existing view is
  // unchanged until the admin picks a year.
  const [topCustomersBySpYear, setTopCustomersBySpYear] = useState("all");
  const [themeKey, setThemeKey] = useState(() => {
    try { return migrateThemeKey(localStorage.getItem("seedTheme")); } catch { return "slate"; }
  });
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem("seedTheme", themeKey); } catch {} }, [themeKey]);

  // Active theme object. All tokens live here so Recharts gets resolved colors
  // (SVG fill/stroke don't read CSS vars) and inline styles can use CSS vars.
  const tk = THEMES[themeKey] || THEMES.slate;

  // Series colours follow the theme: each family has its own verified palette.
  const COLORS = tk.series;
  const PIE_COLORS = useMemo(() => Object.values(tk.series), [tk]);

  // Status colours also follow the theme (see STATUS_DARK/LIGHT). Chart fills
  // read STATUS.* directly (real hex, SVG-safe); CSS-only module-level helpers
  // read the --st-* custom properties emitted on the theme wrapper below.
  const STATUS = tk.status;

  // Whatever App hands us has already been filtered by RLS to this user's
  // scope, so it is the only thing we render. No local override.
  useEffect(() => { purgeLegacyCache(); }, []);
  // App only mounts Dashboard once data exists, so there is nothing to fall
  // back to here — importing the 2.5 MB snapshot just to satisfy a ?? was
  // what put the whole dataset in the initial bundle.
  const data = incomingData;

  // Make sure selectedYear is valid for the current data
  const YEARS = data.years && data.years.length ? data.years : YEARS_FALLBACK;
  const SALESPEOPLE = SALESPEOPLE_ORDER.filter(sp => (data.salespeople || []).includes(sp))
    .concat((data.salespeople || []).filter(sp => !SALESPEOPLE_ORDER.includes(sp)));

  useEffect(() => {
    if (!YEARS.includes(selectedYear)) {
      setSelectedYear(YEARS[YEARS.length - 1]);
    }
  }, [data]);

  const SUMMARY = data.summary || [];
  const TOP_CUSTOMERS = data.topCustomers || [];
  const CUSTOMERS = data.customers || [];
  const BRAND_SALES = data.brandSales || [];
  const TARGETS = data.targets || [];

  const yearTotals = useMemo(() => {
    const t = {};
    YEARS.forEach(y => { t[y] = 0; });
    SUMMARY.forEach(s => { t[s.year] = (t[s.year] || 0) + s.total; });
    return t;
  }, [data]);

  const currentYearTotal = yearTotals[selectedYear] || 0;
  const prevYearTotal = yearTotals[selectedYear - 1] || 0;
  const yoyChange = prevYearTotal > 0 ? ((currentYearTotal - prevYearTotal) / prevYearTotal) * 100 : 0;

  const annualQtyBySpYear = useMemo(() => {
    const m = new Map();
    BRAND_SALES.forEach(r => {
      const key = `${r.sp}|${r.year}`;
      m.set(key, (m.get(key) || 0) + (r.qty || 0));
    });
    return m;
  }, [data]);

  const monthlyQtyData = useMemo(() => {
    return MONTH_NAMES.map((m, i) => {
      const row = { month: m };
      const filtered = selectedSP === "All" ? SUMMARY : SUMMARY.filter(s => s.sp === selectedSP);
      const inYear = filtered.filter(s => s.year === selectedYear);
      let total = 0;
      inYear.forEach(s => {
        const annualQty = annualQtyBySpYear.get(`${s.sp}|${s.year}`) || 0;
        const proportion = s.total > 0 ? s.months[i] / s.total : 0;
        const v = Math.round(annualQty * proportion);
        row[s.sp] = v;
        total += v;
      });
      row.total = total;
      return row;
    }).filter((_, i) => {
      const allMonthsThisYear = SUMMARY.filter(s => s.year === selectedYear);
      if (!allMonthsThisYear.length) return true;
      const futureMonthEmpty = !allMonthsThisYear.some(s => s.months[i] > 0);
      if (futureMonthEmpty) {
        const anyLater = allMonthsThisYear.some(s => s.months.slice(i).some(v => v > 0));
        return anyLater;
      }
      return true;
    });
  }, [selectedYear, selectedSP, data, annualQtyBySpYear]);

  const monthlyData = useMemo(() => {
    const targetSp = selectedSP === "All" ? "_TEAM" : selectedSP;
    return MONTH_NAMES.map((m, i) => {
      const row = { month: m };
      const filtered = selectedSP === "All" ? SUMMARY : SUMMARY.filter(s => s.sp === selectedSP);
      filtered.filter(s => s.year === selectedYear).forEach(s => {
        row[s.sp] = s.months[i];
      });
      row.total = filtered.filter(s => s.year === selectedYear).reduce((acc, s) => acc + s.months[i], 0);
      const t = TARGETS.find(t => t.year === selectedYear && t.month === i + 1 && t.sp === targetSp);
      row.target = t ? t.target : 0;
      return row;
    }).filter((_, i) => {
      const allMonthsThisYear = SUMMARY.filter(s => s.year === selectedYear);
      if (!allMonthsThisYear.length) return true;
      const futureMonthEmpty = !allMonthsThisYear.some(s => s.months[i] > 0);
      if (futureMonthEmpty) {
        const anyLater = allMonthsThisYear.some(s => s.months.slice(i).some(v => v > 0));
        return anyLater;
      }
      return true;
    });
  }, [selectedYear, selectedSP, data]);

  const annualTarget = useMemo(() => {
    const targetSp = selectedSP === "All" ? "_TEAM" : selectedSP;
    return TARGETS
      .filter(t => t.year === selectedYear && t.sp === targetSp)
      .reduce((a, t) => a + t.target, 0);
  }, [selectedYear, selectedSP, data]);

  const ytd = useMemo(() => {
    const summary = SUMMARY.filter(s => s.year === selectedYear);
    if (!summary.length) return { actual: 0, target: 0, lastMonth: 0 };
    let lastMonth = 0;
    for (let i = 11; i >= 0; i--) {
      if (summary.some(s => s.months[i] > 0)) { lastMonth = i + 1; break; }
    }
    let actual = 0;
    if (selectedSP === "All") {
      summary.forEach(s => { for (let i = 0; i < lastMonth; i++) actual += s.months[i]; });
    } else {
      const s = summary.find(d => d.sp === selectedSP);
      if (s) for (let i = 0; i < lastMonth; i++) actual += s.months[i];
    }
    const targetSp = selectedSP === "All" ? "_TEAM" : selectedSP;
    let target = 0;
    TARGETS.filter(t => t.year === selectedYear && t.sp === targetSp && t.month <= lastMonth)
      .forEach(t => { target += t.target; });
    return { actual, target, lastMonth };
  }, [selectedYear, selectedSP, data]);

  const ytdAchievement = ytd.target > 0 ? (ytd.actual / ytd.target) * 100 : 0;
  const annualAchievement = annualTarget > 0 ? (currentYearTotal / annualTarget) * 100 : 0;

  const yearCompData = useMemo(() => {
    return YEARS.map(y => {
      const row = { year: y.toString() };
      SALESPEOPLE.forEach(sp => {
        const s = SUMMARY.find(d => d.sp === sp && d.year === y);
        row[sp] = s ? s.total : 0;
      });
      row.total = SALESPEOPLE.reduce((acc, sp) => acc + (row[sp] || 0), 0);
      return row;
    });
  }, [data]);

  const spPerformance = useMemo(() => {
    return SALESPEOPLE.map(sp => {
      const curr = SUMMARY.find(s => s.sp === sp && s.year === selectedYear);
      const prev = SUMMARY.find(s => s.sp === sp && s.year === selectedYear - 1);
      const total = curr?.total || 0;
      const prevTotal = prev?.total || 0;
      const change = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : (total > 0 ? 100 : 0);
      const activeMonths = curr ? curr.months.filter(m => m > 0).length : 0;
      const avgMonthly = activeMonths > 0 ? total / activeMonths : 0;
      return { sp, total, prevTotal, change, customers: curr?.customers || 0, avgMonthly, activeMonths };
    }).sort((a, b) => b.total - a.total);
  }, [selectedYear, data]);

  const pieData = useMemo(() => {
    return spPerformance.filter(s => s.total > 0).map(s => ({
      name: s.sp, value: s.total
    }));
  }, [spPerformance]);

  const topSP = spPerformance[0];

  const customerIndex = useMemo(() => {
    const map = new Map();
    CUSTOMERS.forEach(r => {
      let e = map.get(r.customer);
      if (!e) {
        e = { customer: r.customer, total: 0, perYear: {}, perSP: new Set(), monthsByYear: {} };
        map.set(r.customer, e);
      }
      e.total += r.total;
      e.perYear[r.year] = (e.perYear[r.year] || 0) + r.total;
      if (r.total > 0) e.perSP.add(r.sp);
      e.monthsByYear[r.year] = e.monthsByYear[r.year] || [0,0,0,0,0,0,0,0,0,0,0,0];
      r.months.forEach((v, i) => { e.monthsByYear[r.year][i] += v; });
    });
    const arr = [...map.values()].map(e => {
      const perSP = [...e.perSP];
      // Customers served (in any year) by "Seed Malaysia" are export/overseas accounts.
      const region = perSP.includes("Seed Malaysia") ? "Overseas" : "Local";
      return { ...e, perSP, region };
    });
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [data]);

  const topLocalCustomers = useMemo(
    () => customerIndex.filter(c => c.region === "Local").slice(0, 20),
    [customerIndex]
  );
  const topOverseasCustomers = useMemo(
    () => customerIndex.filter(c => c.region === "Overseas").slice(0, 20),
    [customerIndex]
  );

  const topCustomersBySP = useMemo(() => {
    const out = {};
    // "all" sums every year in the dataset; a specific year narrows to that
    // year's customer rows only. Uses the SP's monthly-total column, so a
    // year with only Q1 data still ranks that quarter's largest customers.
    const yearFilter = topCustomersBySpYear === "all"
      ? () => true
      : (r) => r.year === topCustomersBySpYear;
    SALESPEOPLE.forEach(sp => {
      const map = new Map();
      CUSTOMERS.filter(r => r.sp === sp && r.total > 0 && yearFilter(r)).forEach(r => {
        map.set(r.customer, (map.get(r.customer) || 0) + r.total);
      });
      out[sp] = [...map.entries()]
        .map(([customer, total]) => ({ customer, total: Math.round(total * 100) / 100 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
    });
    return out;
  }, [data, topCustomersBySpYear]);

  const filteredCustomerList = useMemo(() => {
    if (!customerSearch) return customerIndex.slice(0, 200);
    const q = customerSearch.toLowerCase();
    return customerIndex.filter(c => c.customer.toLowerCase().includes(q)).slice(0, 200);
  }, [customerIndex, customerSearch]);

  const activeCustomer = useMemo(() => {
    if (!selectedCustomer) return customerIndex[0];
    return customerIndex.find(c => c.customer === selectedCustomer) || customerIndex[0];
  }, [customerIndex, selectedCustomer]);

  const customerMonthlyData = useMemo(() => {
    if (!activeCustomer) return [];
    return MONTH_NAMES.map((m, i) => {
      const row = { month: m };
      YEARS.forEach(y => {
        row[y] = activeCustomer.monthsByYear[y]?.[i] || 0;
      });
      return row;
    });
  }, [activeCustomer, data]);

  const customerYearTotals = useMemo(() => {
    if (!activeCustomer) return [];
    return YEARS.map(y => ({ year: y.toString(), total: activeCustomer.perYear[y] || 0 }));
  }, [activeCustomer, data]);

  const customerTopBrandsByAmt = useMemo(() => {
    if (!activeCustomer) return [];
    const m = new Map();
    BRAND_SALES.filter(r => r.customer === activeCustomer.customer).forEach(r => {
      const e = m.get(r.brand) || { amt: 0, qty: 0 };
      e.amt += r.amt; e.qty += r.qty || 0;
      m.set(r.brand, e);
    });
    return [...m.entries()]
      .map(([brand, v]) => ({ brand, amt: v.amt, qty: v.qty }))
      .sort((a, b) => b.amt - a.amt)
      .slice(0, 12);
  }, [activeCustomer, data]);

  const customerTopBrandsByQty = useMemo(() => {
    if (!activeCustomer) return [];
    const m = new Map();
    BRAND_SALES.filter(r => r.customer === activeCustomer.customer).forEach(r => {
      const e = m.get(r.brand) || { amt: 0, qty: 0 };
      e.amt += r.amt; e.qty += r.qty || 0;
      m.set(r.brand, e);
    });
    return [...m.entries()]
      .map(([brand, v]) => ({ brand, amt: v.amt, qty: v.qty }))
      .filter(x => x.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 12);
  }, [activeCustomer, data]);

  const brandYearTotals = useMemo(() => {
    const m = new Map();
    BRAND_SALES.filter(r => r.year === selectedYear && (selectedSP === "All" || r.sp === selectedSP)).forEach(r => {
      const e = m.get(r.brand) || { amt: 0, qty: 0 };
      e.amt += r.amt; e.qty += r.qty || 0;
      m.set(r.brand, e);
    });
    return [...m.entries()]
      .map(([brand, v]) => ({ brand, amt: v.amt, qty: v.qty }))
      .sort((a, b) => b.amt - a.amt);
  }, [selectedYear, selectedSP, data]);

  const brandYearTotalsByQty = useMemo(() => {
    return [...brandYearTotals].filter(x => x.qty > 0).sort((a, b) => b.qty - a.qty);
  }, [brandYearTotals]);

  const brandSPBreakdown = useMemo(() => {
    const top = brandYearTotals.slice(0, 15);
    return top.map(b => {
      const row = { brand: b.brand };
      SALESPEOPLE.forEach(sp => { row[sp] = 0; });
      BRAND_SALES.filter(r => r.year === selectedYear && r.brand === b.brand).forEach(r => {
        row[r.sp] = (row[r.sp] || 0) + r.amt;
      });
      return row;
    });
  }, [selectedYear, brandYearTotals, data]);

  const top8BrandNames = useMemo(() => {
    const all = new Map();
    BRAND_SALES.forEach(r => { all.set(r.brand, (all.get(r.brand) || 0) + r.amt); });
    return [...all.entries()].sort((a,b) => b[1]-a[1]).slice(0,8).map(([b]) => b);
  }, [data]);

  const brandYoY = useMemo(() => {
    return YEARS.map(y => {
      const row = { year: y.toString() };
      top8BrandNames.forEach(b => { row[b] = 0; });
      BRAND_SALES.filter(r => r.year === y && top8BrandNames.includes(r.brand)).forEach(r => {
        row[r.brand] = (row[r.brand] || 0) + r.amt;
      });
      return row;
    });
  }, [top8BrandNames, data]);

  const cohort = useMemo(() => {
    const inSet = (sp, year) => {
      const set = new Map();
      CUSTOMERS.filter(r => r.year === year && r.total > 0 && (sp === "All" || r.sp === sp))
        .forEach(r => set.set(r.customer, (set.get(r.customer) || 0) + r.total));
      return set;
    };
    const curr = inSet(selectedSP, selectedYear);
    const prev = inSet(selectedSP, selectedYear - 1);
    const newC = [], retainedC = [], lostC = [];
    curr.forEach((v, k) => {
      if (prev.has(k)) retainedC.push({ customer: k, total: v, prevTotal: prev.get(k) });
      else newC.push({ customer: k, total: v });
    });
    prev.forEach((v, k) => {
      if (!curr.has(k)) lostC.push({ customer: k, prevTotal: v });
    });
    newC.sort((a, b) => b.total - a.total);
    retainedC.sort((a, b) => b.total - a.total);
    lostC.sort((a, b) => b.prevTotal - a.prevTotal);
    return {
      new: newC,
      retained: retainedC,
      lost: lostC,
      newRevenue: newC.reduce((a, c) => a + c.total, 0),
      retainedRevenue: retainedC.reduce((a, c) => a + c.total, 0),
      lostRevenue: lostC.reduce((a, c) => a + c.prevTotal, 0),
    };
  }, [selectedSP, selectedYear, data]);

  const heatmap = useMemo(() => {
    const scope = BRAND_SALES.filter(r => r.year === selectedYear && (selectedSP === "All" || r.sp === selectedSP));

    // Top 12 customers ranked by amount
    const custMap = new Map();
    scope.forEach(r => custMap.set(r.customer, (custMap.get(r.customer) || 0) + r.amt));
    const topCust = [...custMap.entries()].sort((a,b) => b[1]-a[1]).slice(0,12).map(([c]) => c);

    // Top 12 brands ranked by amount
    const brandMap = new Map();
    scope.forEach(r => brandMap.set(r.brand, (brandMap.get(r.brand) || 0) + r.amt));
    const topBrand = [...brandMap.entries()].sort((a,b) => b[1]-a[1]).slice(0,12).map(([b]) => b);

    const gridAmt = topCust.map(() => topBrand.map(() => 0));
    const gridQty = topCust.map(() => topBrand.map(() => 0));
    scope.forEach(r => {
      const ci = topCust.indexOf(r.customer);
      const bi = topBrand.indexOf(r.brand);
      if (ci >= 0 && bi >= 0) {
        gridAmt[ci][bi] += r.amt;
        gridQty[ci][bi] += r.qty || 0;
      }
    });
    let maxAmt = 0, maxQty = 0;
    gridAmt.forEach(row => row.forEach(v => { if (v > maxAmt) maxAmt = v; }));
    gridQty.forEach(row => row.forEach(v => { if (v > maxQty) maxQty = v; }));
    return { customers: topCust, brands: topBrand, gridAmt, gridQty, maxAmt, maxQty };
  }, [selectedSP, selectedYear, data]);

  return (
    <div data-seed-theme={themeKey} style={{
      minHeight:"100vh",
      background:"var(--bg)",
      color:"var(--text)",
      fontFamily:"'Inter','DM Sans',system-ui,sans-serif",
      fontWeight: 450,
      padding:"0 0 60px 0",
    }}>
      <style>{`
        [data-seed-theme="${themeKey}"] {
          --bg: ${tk.bg};
          --text: ${tk.text};
          --tint: ${tk.tintRgb};
          --st-ok: ${tk.status.ok};
          --st-bad: ${tk.status.bad};
          --st-watch: ${tk.status.watch};
          --st-info: ${tk.status.info};
          --st-accent: ${tk.status.accent};
          --st-region: ${tk.status.region};
          --tooltip-bg: ${tk.tooltipBg};
          --tooltip-border: ${tk.tooltipBorder};
          --tooltip-text: ${tk.tooltipText};
        }
        [data-seed-theme] input::placeholder { color: rgba(${tk.tintRgb}, 0.5); }
        [data-seed-theme] input, [data-seed-theme] button, [data-seed-theme] table { color: inherit; }
        ${RESPONSIVE_CSS}
      `}</style>

      {/* Document-scoped series textures for the stacked charts. Re-rendered per
          theme so the pattern base colours track the active series palette. */}
      <ChartPatterns colors={COLORS} order={SALESPEOPLE_ORDER} />

      <div style={{
        background:"linear-gradient(135deg, rgba(232,99,59,0.08) 0%, rgba(59,130,246,0.05) 100%)",
        borderBottom:"1px solid rgba(var(--tint),0.06)",
        padding: isMobile ? "18px 14px 14px" : "28px 32px 20px",
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
          <div>
            <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:2,color:"rgba(var(--tint),0.35)",marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
              <span>SEED Malaysia</span>
              {user?.isAdmin && (
                <span style={{padding:"2px 8px",background:"rgba(232,99,59,0.15)",color:STATUS.accent,borderRadius:10,fontSize:10,letterSpacing:0.5}}>ADMIN</span>
              )}
            </div>
            <h1 style={{fontSize:26,fontWeight:700,margin:0,letterSpacing:-0.5,color:"var(--text)"}}>
              Sales Performance Dashboard
            </h1>
            <div style={{fontSize:13,color:"rgba(var(--tint),0.4)",marginTop:4}}>
              {YEARS[0]} – {YEARS[YEARS.length-1]} ·{" "}
              {user?.canViewAll
                ? `All teams · ${(data.salespeople || []).length} salespeople`
                : `Restricted to ${user?.sp ?? "your data"}`}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {YEARS.map(y => <Pill key={y} label={y} active={y===selectedYear} onClick={()=>setSelectedYear(y)} />)}
            </div>
            <div style={{position:"relative"}}>
              <button
                onClick={() => setThemePickerOpen(o => !o)}
                title="Choose color theme"
                style={{
                  background:"rgba(var(--tint),0.05)",
                  border:"1px solid rgba(var(--tint),0.12)",
                  color:"var(--text)",
                  borderRadius:20,
                  padding:"6px 14px",
                  fontSize:13,
                  fontWeight:600,
                  cursor:"pointer",
                  fontFamily:"'Inter',sans-serif",
                  display:"flex",
                  alignItems:"center",
                  gap:8,
                }}>
                <span style={{display:"inline-flex",gap:2}}>
                  {tk.swatch.map((c,i) => (
                    <span key={i} style={{width:6,height:14,borderRadius:1,background:c,border:"1px solid rgba(var(--tint),0.1)"}} />
                  ))}
                </span>
                {tk.name}
                <span style={{fontSize:10,opacity:0.5}}>▼</span>
              </button>
              {themePickerOpen && (
                <>
                  <div onClick={() => setThemePickerOpen(false)} style={{position:"fixed",inset:0,zIndex:50}} />
                  <div style={{
                    position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:51,
                    background:"var(--bg)",
                    border:"1px solid rgba(var(--tint),0.18)",
                    borderRadius:14,
                    padding:8,
                    width:300,
                    boxShadow:"0 12px 40px rgba(0,0,0,0.5)",
                  }}>
                    <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1.5,color:"rgba(var(--tint),0.55)",padding:"6px 8px 10px"}}>
                      Choose color theme
                    </div>
                    {Object.entries(THEMES).map(([key, t]) => {
                      const active = themeKey === key;
                      return (
                        <button
                          key={key}
                          onClick={() => { setThemeKey(key); setThemePickerOpen(false); }}
                          style={{
                            display:"flex",alignItems:"center",gap:10,
                            width:"100%",padding:"10px 10px",marginBottom:4,
                            background: active ? "rgba(var(--tint),0.08)" : "transparent",
                            border: active ? "1px solid rgba(var(--tint),0.18)" : "1px solid transparent",
                            color:"var(--text)",borderRadius:10,cursor:"pointer",textAlign:"left",
                            fontFamily:"'Inter',sans-serif",
                          }}
                          onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(var(--tint),0.04)"; }}
                          onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                          <span style={{display:"inline-flex",gap:3,flexShrink:0}}>
                            {t.swatch.map((c,i) => (
                              <span key={i} style={{width:14,height:34,borderRadius:3,background:c,border:"1px solid rgba(var(--tint),0.12)"}} />
                            ))}
                          </span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{t.name}</div>
                            <div style={{fontSize:11,color:"rgba(var(--tint),0.55)"}}>{t.subtitle}</div>
                          </div>
                          {active && <span style={{color:STATUS.accent,fontSize:14}}>●</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {user && (
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 12px 6px 8px",background:"rgba(var(--tint),0.04)",border:"1px solid rgba(var(--tint),0.08)",borderRadius:20}}>
                <div style={{
                  width:26,height:26,borderRadius:"50%",
                  background: user.isAdmin ? "linear-gradient(135deg,#E8633B,#F59E0B)" : (COLORS[user.sp] || STATUS.info),
                  color:"var(--text)",display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:11,fontWeight:700,fontFamily:"'Space Mono',monospace"
                }}>{(user.sp || "?")[0]?.toUpperCase()}</div>
                <div style={{display:"flex",flexDirection:"column",gap:0,lineHeight:1.1}}>
                  <div style={{fontSize:12,fontWeight:600}}>{user.isAdmin ? "Admin" : user.sp}</div>
                  {user.email && <div style={{fontSize:10,color:"rgba(var(--tint),0.4)"}}>{user.email}</div>}
                </div>
                {onLogout && (
                  <button onClick={onLogout} style={{
                    marginLeft:4,padding:"4px 10px",fontSize:11,fontWeight:600,
                    background:"transparent",border:"1px solid rgba(var(--tint),0.1)",
                    color:"rgba(var(--tint),0.6)",borderRadius:14,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"
                  }}>Sign out</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* On a phone these 11 tabs wrapped into a wall of buttons that pushed
            the content off screen; scroll them in one row instead. */}
        <div className="seed-tabs" role="tablist" aria-label="Dashboard views" aria-orientation="horizontal"
          onKeyDown={onTablistKeyDown} style={{
          display:"flex", gap:4, marginTop: isMobile ? 14 : 20,
          flexWrap: isMobile ? "nowrap" : "wrap",
          overflowX: isMobile ? "auto" : "visible",
          WebkitOverflowScrolling: "touch",
          paddingBottom: isMobile ? 4 : 0,
        }}>
          <TabButton tabKey="overview" active={tab==="overview"} onClick={()=>setTab("overview")}>Overview</TabButton>
          <TabButton tabKey="targets" active={tab==="targets"} onClick={()=>setTab("targets")}>🎯 Targets</TabButton>
          <TabButton tabKey="monthly" active={tab==="monthly"} onClick={()=>setTab("monthly")}>Monthly Trends</TabButton>
          <TabButton tabKey="team" active={tab==="team"} onClick={()=>setTab("team")}>Team Analysis</TabButton>
          <TabButton tabKey="customers" active={tab==="customers"} onClick={()=>setTab("customers")}>Top Customers</TabButton>
          <TabButton tabKey="yoy" active={tab==="yoy"} onClick={()=>setTab("yoy")}>Year-over-Year</TabButton>
          <TabButton tabKey="drilldown" active={tab==="drilldown"} onClick={()=>setTab("drilldown")}>Customer Drill-down</TabButton>
          <TabButton tabKey="brands" active={tab==="brands"} onClick={()=>setTab("brands")}>Brand Performance</TabButton>
          <TabButton tabKey="cohort" active={tab==="cohort"} onClick={()=>setTab("cohort")}>New vs Lost</TabButton>
          <TabButton tabKey="heatmap" active={tab==="heatmap"} onClick={()=>setTab("heatmap")}>Customer × Brand</TabButton>
          {user?.isAdmin && (
            <TabButton tabKey="data" active={tab==="data"} onClick={()=>setTab("data")} accent>Data ⤴</TabButton>
          )}
          {user?.isAdmin && (
            <TabButton tabKey="users" active={tab==="users"} onClick={()=>setTab("users")}>👤 Users</TabButton>
          )}
        </div>
      </div>

      {/* The active view is the tab's panel, labelled by its tab button. No
          tabIndex: every panel holds focusable controls, so per WAI-ARIA the
          panel itself shouldn't be a tab stop (and shouldn't take the ring). */}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}
        style={{padding: isMobile ? "16px 12px" : "24px 32px", maxWidth:1280, margin:"0 auto"}}>

        {/* The brand rows are ~24k and load after the page is already usable.
            Say so on the tabs that need them rather than showing empty charts. */}
        {brandsLoading && ["brands","heatmap","drilldown","monthly"].includes(tab) && (
          <div style={{
            display:"flex",alignItems:"center",gap:10,marginBottom:16,
            padding:"9px 14px",borderRadius:10,fontSize:12,
            background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.25)",color:STATUS.info,
          }}>
            <span style={{
              width:12,height:12,borderRadius:"50%",flexShrink:0,
              border:"2px solid rgba(59,130,246,0.25)",borderTopColor:STATUS.info,
              animation:"seedspin 0.8s linear infinite",
            }} />
            Loading brand-level rows — this chart fills in shortly.
          </div>
        )}

        {tab === "overview" && (
          <>
            <WeeklySalesCard
              weeklySales={data.weeklySales || []}
              targets={TARGETS}
              isAdmin={!!user?.isAdmin}
              onUploaded={onRefresh}
              onRefresh={onRefresh}
              seriesColors={COLORS}
            />
            <div style={{display:"flex",gap:16,marginBottom:28,flexWrap:"wrap"}}>
              <KPI label="Total Revenue" value={`RM ${fmt(currentYearTotal)}`} sub={`${selectedYear}`} trend={selectedYear>YEARS[0]?yoyChange:undefined} color={STATUS.accent} />
              {annualTarget > 0 ? (
                <KPI
                  label="YTD vs Target"
                  value={`${ytdAchievement.toFixed(0)}%`}
                  sub={`RM ${fmt(ytd.actual)} of RM ${fmt(ytd.target)} (Jan–${MONTH_NAMES[Math.max(ytd.lastMonth-1,0)] || "Dec"})`}
                  color={ytdAchievement >= 100 ? STATUS.ok : ytdAchievement >= 90 ? STATUS.watch : STATUS.bad}
                />
              ) : (
                <KPI label="Top Performer" value={topSP?.sp || "—"} sub={`RM ${fmt(topSP?.total||0)}`} color={STATUS.info} />
              )}
              <KPI label="Annual Target" value={annualTarget > 0 ? `RM ${fmt(annualTarget)}` : "—"} sub={annualTarget > 0 ? `${annualAchievement.toFixed(0)}% achieved` : "no target set"} color={STATUS.info} />
              <KPI label="Active Teams" value={spPerformance.filter(s=>s.total>0).length} sub={`of ${SALESPEOPLE.length} teams`} color={STATUS.qty} />
              <KPI label="Avg Monthly" value={`RM ${fmt(currentYearTotal / Math.max(SUMMARY.find(s => s.year === selectedYear)?.months.filter(m => m > 0).length || 12, 1))}`} sub="active months" color={STATUS.alt} />
            </div>

            <div style={{display:"grid",gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",gap:20,marginBottom:24}}>
              <Card>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                  <div style={{fontSize:14,fontWeight:600}}>Monthly Revenue vs Target — {selectedYear}</div>
                  {annualTarget > 0 && (
                    <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"rgba(var(--tint),0.5)"}}>
                      <span style={{display:"inline-block",width:14,height:2,borderTop:"2px dashed #94A3B8"}}></span>
                      target
                    </div>
                  )}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={monthlyData}>
                    <defs>
                      <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={STATUS.accent} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={STATUS.accent} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                    <XAxis dataKey="month" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                    <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area isAnimationActive={!reduceMotion} type="monotone" dataKey="total" stroke={STATUS.accent} fill="url(#totalGrad)" strokeWidth={2} name="Actual" />
                    {annualTarget > 0 && (
                      <Line isAnimationActive={!reduceMotion} type="monotone" dataKey="target" stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Target" />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>📦 Monthly Quantity — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyQtyData}>
                    <defs>
                      <linearGradient id="qtyGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={STATUS.qty} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={STATUS.qty} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                    <XAxis dataKey="month" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                    <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
                    <Tooltip formatter={(v) => `${v.toLocaleString()} units`} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                    <Area isAnimationActive={!reduceMotion} type="monotone" dataKey="total" stroke={STATUS.qty} fill="url(#qtyGrad)" strokeWidth={2} name="Quantity" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <div style={{display:"grid",gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",gap:20,marginBottom:24}}>
              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Revenue by Team — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie isAnimationActive={!reduceMotion} data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} dataKey="value" paddingAngle={3} stroke="none">
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[pieData[i]?.name] || PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                    <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Quantity by Team — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={spPerformance.filter(s => s.total > 0).map(s => {
                        const aq = annualQtyBySpYear.get(`${s.sp}|${selectedYear}`) || 0;
                        return { name: s.sp, value: aq };
                      }).filter(d => d.value > 0)}
                      cx="50%" cy="50%" innerRadius={55} outerRadius={95} dataKey="value" paddingAngle={3} stroke="none">
                      {spPerformance.filter(s => s.total > 0).map((s, i) => <Cell key={i} fill={COLORS[s.sp] || PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `${v.toLocaleString()} units`} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                    <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <Card>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Team Performance Summary — {selectedYear}</div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid rgba(var(--tint),0.08)"}}>
                      {["Rank","Team","Revenue","Avg/Month","Customers","YoY Change"].map(h => (
                        <th key={h} style={{padding:"10px 14px",textAlign:"left",color:"rgba(var(--tint),0.4)",fontWeight:500,fontSize:11,textTransform:"uppercase",letterSpacing:1}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {spPerformance.filter(s=>s.total>0).map((s, i) => (
                      <tr key={s.sp} style={{borderBottom:"1px solid rgba(var(--tint),0.04)"}}>
                        <td style={{padding:"12px 14px"}}>
                          <span style={{
                            display:"inline-flex",alignItems:"center",justifyContent:"center",
                            width:24,height:24,borderRadius:"50%",fontSize:11,fontWeight:700,
                            background:i===0?"rgba(232,99,59,0.2)":i===1?"rgba(59,130,246,0.15)":i===2?"rgba(16,185,129,0.15)":"rgba(var(--tint),0.05)",
                            color:i===0?STATUS.accent:i===1?STATUS.info:i===2?STATUS.qty:"rgba(var(--tint),0.5)"
                          }}>{i+1}</span>
                        </td>
                        <td style={{padding:"12px 14px",fontWeight:600}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{width:10,height:10,borderRadius:3,background:COLORS[s.sp] || "#888"}} />
                            {s.sp}
                          </div>
                        </td>
                        <td style={{padding:"12px 14px",fontFamily:"'Space Mono',monospace",fontWeight:600}}>{fmtFull(s.total)}</td>
                        <td style={{padding:"12px 14px",fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.6)"}}>{fmtFull(s.avgMonthly)}</td>
                        <td style={{padding:"12px 14px",textAlign:"center"}}>{s.customers}</td>
                        <td style={{padding:"12px 14px"}}>
                          {s.prevTotal > 0 ? (
                            <span style={{
                              padding:"3px 10px",borderRadius:12,fontSize:11,fontWeight:600,
                              background:s.change>=0?"rgba(52,211,153,0.15)":"rgba(248,113,113,0.15)",
                              color:s.change>=0?STATUS.ok:STATUS.bad
                            }}>
                              {s.change>=0?"▲":"▼"} {Math.abs(s.change).toFixed(1)}%
                            </span>
                          ) : <span style={{color:"rgba(var(--tint),0.3)",fontSize:11}}>N/A</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {tab === "monthly" && (
          <>
            <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:12,color:"rgba(var(--tint),0.4)",marginRight:8}}>Filter:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            <Card style={{marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>💰 Monthly Revenue Breakdown — {selectedYear}</div>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                  <XAxis dataKey="month" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                  <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                  {selectedSP === "All" ? (
                    <>
                      {SALESPEOPLE.filter(sp => SUMMARY.some(s => s.sp === sp && s.year === selectedYear && s.total > 0)).map((sp, idx, arr) => (
                        <Bar isAnimationActive={!reduceMotion} key={sp} dataKey={sp} stackId="a" fill={seriesFill(COLORS, sp)} radius={idx === arr.length - 1 ? [3,3,0,0] : [0,0,0,0]}>
                          {idx === arr.length - 1 && (
                            <LabelList
                              dataKey="total"
                              position="top"
                              formatter={(v) => v > 0 ? fmt(v) : ""}
                              fill={tk.text}
                              fontSize={11}
                              fontFamily="'Space Mono',monospace"
                            />
                          )}
                        </Bar>
                      ))}
                    </>
                  ) : (
                    <Bar isAnimationActive={!reduceMotion} dataKey={selectedSP} fill={COLORS[selectedSP] || "#888"} radius={[4,4,0,0]}>
                      <LabelList
                        dataKey={selectedSP}
                        position="top"
                        formatter={(v) => v > 0 ? fmt(v) : ""}
                        fill={tk.text}
                        fontSize={11}
                        fontFamily="'Space Mono',monospace"
                      />
                    </Bar>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card style={{marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>📦 Monthly Quantity Breakdown — {selectedYear}</div>
              <div style={{fontSize:11,color:"rgba(var(--tint),0.4)",marginBottom:12}}>
                Derived per (SP, year) by apportioning annual brand-level quantity across months in proportion to monthly revenue.
              </div>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={monthlyQtyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                  <XAxis dataKey="month" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                  <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip
                    contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}}
                    labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}}
                    itemStyle={{color:tk.tooltipText}}
                    formatter={(v, name) => [`${v.toLocaleString()} units`, name]}
                  />
                  <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                  {selectedSP === "All" ? (
                    <>
                      {SALESPEOPLE.filter(sp => SUMMARY.some(s => s.sp === sp && s.year === selectedYear && s.total > 0)).map((sp, idx, arr) => (
                        <Bar isAnimationActive={!reduceMotion} key={sp} dataKey={sp} stackId="qty" fill={seriesFill(COLORS, sp)} radius={idx === arr.length - 1 ? [3,3,0,0] : [0,0,0,0]}>
                          {idx === arr.length - 1 && (
                            <LabelList dataKey="total" position="top" formatter={(v) => v > 0 ? v.toLocaleString() : ""} fill={tk.text} fontSize={11} fontFamily="'Space Mono',monospace" />
                          )}
                        </Bar>
                      ))}
                    </>
                  ) : (
                    <Bar isAnimationActive={!reduceMotion} dataKey={selectedSP} fill={COLORS[selectedSP] || "#888"} radius={[4,4,0,0]}>
                      <LabelList dataKey={selectedSP} position="top" formatter={(v) => v > 0 ? v.toLocaleString() : ""} fill={tk.text} fontSize={11} fontFamily="'Space Mono',monospace" />
                    </Bar>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>
                Monthly Trend Across Years {selectedSP !== "All" ? `— ${selectedSP}` : "— All Teams"}
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={MONTH_NAMES.map((m, i) => {
                  const row = {month: m};
                  YEARS.forEach(y => {
                    const filtered = selectedSP === "All" ? SUMMARY.filter(s => s.year === y) : SUMMARY.filter(s => s.sp === selectedSP && s.year === y);
                    row[y] = filtered.reduce((acc, s) => acc + s.months[i], 0);
                  });
                  return row;
                })}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                  <XAxis dataKey="month" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                  <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                  {YEARS.map((y, i) => (
                    <Line isAnimationActive={!reduceMotion} key={y} type="monotone" dataKey={y} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={y===selectedYear?3:1.5} strokeDasharray={y===selectedYear?undefined:YEAR_DASHES[i % YEAR_DASHES.length]} dot={false} name={y.toString()} opacity={y===selectedYear?1:0.55} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </>
        )}

        {tab === "team" && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(min(340px,100%), 1fr))",gap:16}}>
            {SALESPEOPLE.map(sp => {
              const spData = SUMMARY.filter(s => s.sp === sp).sort((a,b) => a.year - b.year);
              return (
                <Card key={sp}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <div style={{width:12,height:12,borderRadius:4,background:COLORS[sp] || "#888"}} />
                    <div style={{fontSize:16,fontWeight:700}}>{sp}</div>
                  </div>
                  <div style={{fontSize:22,fontWeight:700,fontFamily:"'Space Mono',monospace",color:COLORS[sp] || "#888",marginBottom:4}}>
                    {fmtFull(spData.find(s => s.year === selectedYear)?.total || 0)}
                  </div>
                  <div style={{fontSize:11,color:"rgba(var(--tint),0.4)",marginBottom:14}}>{selectedYear} Revenue</div>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={spData.map(s => ({year: s.year.toString(), total: s.total}))}>
                      <XAxis dataKey="year" tick={{fill:tk.chartTickFill,fontSize:10}} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                      <Bar isAnimationActive={!reduceMotion} dataKey="total" fill={COLORS[sp] || "#888"} radius={[3,3,0,0]} opacity={0.8} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              );
            })}
          </div>
        )}

        {tab === "customers" && (
          <>
            <div style={{display:"flex",gap:16,marginBottom:24,flexWrap:"wrap"}}>
              <KPI label="Local Customers" value={customerIndex.filter(c => c.region === "Local").length.toLocaleString()} sub={`RM ${fmt(customerIndex.filter(c => c.region === "Local").reduce((a,c) => a + c.total, 0))} all-time`} color={STATUS.info} />
              <KPI label="Overseas / Export" value={customerIndex.filter(c => c.region === "Overseas").length.toLocaleString()} sub={`RM ${fmt(customerIndex.filter(c => c.region === "Overseas").reduce((a,c) => a + c.total, 0))} all-time`} color={STATUS.region} />
              <KPI label="Local : Overseas" value={`${((customerIndex.filter(c => c.region === "Local").reduce((a,c) => a + c.total, 0) / Math.max(customerIndex.reduce((a,c) => a + c.total, 0), 1)) * 100).toFixed(0)}% / ${((customerIndex.filter(c => c.region === "Overseas").reduce((a,c) => a + c.total, 0) / Math.max(customerIndex.reduce((a,c) => a + c.total, 0), 1)) * 100).toFixed(0)}%`} sub="of all-time revenue" color={STATUS.qty} />
            </div>

            <div style={{display:"grid",gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",gap:20}}>
              <Card>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                  <div style={{fontSize:14,fontWeight:600}}>🇲🇾 Top 20 Local — All Time</div>
                  <div style={{fontSize:11,color:"rgba(var(--tint),0.4)"}}>{YEARS[0]}–{YEARS[YEARS.length-1]}</div>
                </div>
                {topLocalCustomers.length === 0 ? (
                  <div style={{padding:"60px 0",textAlign:"center",color:"rgba(var(--tint),0.4)"}}>No local customers in dataset.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(topLocalCustomers.length * 28, 200)}>
                    <BarChart data={topLocalCustomers} layout="vertical" margin={{left:140, right:70}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                      <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                      <YAxis type="category" dataKey="customer" tick={{fill:tk.chartTickFillDim,fontSize:11}} axisLine={false} width={135} />
                      <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                      <Bar isAnimationActive={!reduceMotion} dataKey="total" name="Total Sales" radius={[0,4,4,0]}>
                        {topLocalCustomers.map((_, i) => <Cell key={i} fill={STATUS.info} opacity={1 - i * 0.035} />)}
                        <LabelList dataKey="total" position="right" formatter={(v) => fmt(v)} fill={tk.text} fontSize={11} fontFamily="'Space Mono',monospace" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <Card>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                  <div style={{fontSize:14,fontWeight:600}}>🌏 Top 20 Overseas / Export — All Time</div>
                  <div style={{fontSize:11,color:"rgba(var(--tint),0.4)"}}>served by Seed Malaysia</div>
                </div>
                {topOverseasCustomers.length === 0 ? (
                  <div style={{padding:"60px 0",textAlign:"center",color:"rgba(var(--tint),0.4)"}}>No overseas customers in dataset.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(topOverseasCustomers.length * 28, 200)}>
                    <BarChart data={topOverseasCustomers} layout="vertical" margin={{left:140, right:70}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                      <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                      <YAxis type="category" dataKey="customer" tick={{fill:tk.chartTickFillDim,fontSize:11}} axisLine={false} width={135} />
                      <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                      <Bar isAnimationActive={!reduceMotion} dataKey="total" name="Total Sales" radius={[0,4,4,0]}>
                        {topOverseasCustomers.map((_, i) => <Cell key={i} fill={STATUS.region} opacity={1 - i * 0.035} />)}
                        <LabelList dataKey="total" position="right" formatter={(v) => fmt(v)} fill={tk.text} fontSize={11} fontFamily="'Space Mono',monospace" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>
            <div style={{marginTop:14,fontSize:11,color:"rgba(var(--tint),0.35)",textAlign:"center"}}>
              * Customers served by the <strong style={{color:"rgba(var(--tint),0.5)"}}>Seed Malaysia</strong> team in any year are classified as Overseas/Export. All others are Local.
            </div>

            <div style={{marginTop:32,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
              <div style={{fontSize:15,fontWeight:700,color:"rgba(var(--tint),0.9)"}}>Top 10 Customers by Sales Team</div>
              <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                {/* Year picker — All time by default, or any year in the
                    dataset. Recomputes the top-10 per rep from just that
                    year's customer rows. */}
                <div style={{display:"inline-flex",background:"rgba(var(--tint),0.04)",border:"1px solid rgba(var(--tint),0.06)",borderRadius:8,padding:2,flexWrap:"wrap"}}>
                  {[{key:"all",label:"All time"}, ...YEARS.map(y => ({key:y,label:String(y)}))].map(opt => {
                    const active = topCustomersBySpYear === opt.key;
                    return (
                      <button key={opt.key} onClick={() => setTopCustomersBySpYear(opt.key)} style={{
                        background: active ? "rgba(232,99,59,0.2)" : "transparent",
                        color:      active ? STATUS.accent : "rgba(var(--tint),0.55)",
                        border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,
                        fontWeight: active ? 700 : 500, cursor:"pointer",
                        fontFamily:"'DM Sans',sans-serif",
                      }}>{opt.label}</button>
                    );
                  })}
                </div>
                <div style={{display:"inline-flex",background:"rgba(var(--tint),0.04)",border:"1px solid rgba(var(--tint),0.06)",borderRadius:8,padding:2}}>
                  <button onClick={()=>setTopCustomersBySpView("grid")} style={{
                    background: topCustomersBySpView === "grid" ? "rgba(232,99,59,0.2)" : "transparent",
                    color: topCustomersBySpView === "grid" ? STATUS.accent : "rgba(var(--tint),0.5)",
                    border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"
                  }}>▦ Grid</button>
                  <button onClick={()=>setTopCustomersBySpView("list")} style={{
                    background: topCustomersBySpView === "list" ? "rgba(232,99,59,0.2)" : "transparent",
                    color: topCustomersBySpView === "list" ? STATUS.accent : "rgba(var(--tint),0.5)",
                    border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"
                  }}>≡ List</button>
                </div>
                <div style={{fontSize:11,color:"rgba(var(--tint),0.4)"}}>
                  {topCustomersBySpYear === "all"
                    ? `All-time · ${YEARS[0]}–${YEARS[YEARS.length-1]}`
                    : `Year ${topCustomersBySpYear}`}
                </div>
              </div>
            </div>

            {topCustomersBySpView === "grid" && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(min(380px,100%), 1fr))",gap:16}}>
                {SALESPEOPLE.map(sp => {
                  const list = topCustomersBySP[sp] || [];
                  const spTotal = list.reduce((a, c) => a + c.total, 0);
                  return (
                    <Card key={sp}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{width:12,height:12,borderRadius:4,background:COLORS[sp] || "#888"}} />
                          <div style={{fontSize:14,fontWeight:700}}>{sp}</div>
                        </div>
                        <div style={{fontSize:11,color:"rgba(var(--tint),0.4)"}}>top 10</div>
                      </div>
                      <div style={{fontSize:11,color:"rgba(var(--tint),0.45)",marginBottom:14,fontFamily:"'Space Mono',monospace"}}>
                        Top-10 contribution: {fmtFull(spTotal)}
                      </div>
                      {list.length === 0 ? (
                        <div style={{padding:"40px 0",textAlign:"center",color:"rgba(var(--tint),0.3)",fontSize:12}}>No customers in dataset</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(list.length * 30, 220)}>
                          <BarChart data={list} layout="vertical" margin={{left:115, right: 60}}>
                            <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                            <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:10}} axisLine={false} tickFormatter={fmt} />
                            <YAxis type="category" dataKey="customer" tick={{fill:tk.chartTickFillDim,fontSize:10}} axisLine={false} width={110} />
                            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                            <Bar isAnimationActive={!reduceMotion} dataKey="total" fill={COLORS[sp] || "#888"} radius={[0,3,3,0]}>
                              <LabelList dataKey="total" position="right" formatter={(v) => fmt(v)} fill={tk.text} fontSize={11} fontFamily="'Space Mono',monospace" />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {topCustomersBySpView === "list" && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(min(420px,100%), 1fr))",gap:16}}>
                {SALESPEOPLE.map(sp => {
                  const list = topCustomersBySP[sp] || [];
                  const spTotal = list.reduce((a, c) => a + c.total, 0);
                  const maxVal = list[0]?.total || 1;
                  return (
                    <Card key={sp}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{width:12,height:12,borderRadius:4,background:COLORS[sp] || "#888"}} />
                          <div style={{fontSize:14,fontWeight:700}}>{sp}</div>
                        </div>
                        <div style={{fontSize:11,color:"rgba(var(--tint),0.4)"}}>top {list.length}</div>
                      </div>
                      <div style={{fontSize:11,color:"rgba(var(--tint),0.45)",marginBottom:14,fontFamily:"'Space Mono',monospace"}}>
                        Top-10 contribution: {fmtFull(spTotal)}
                      </div>
                      {list.length === 0 ? (
                        <div style={{padding:"40px 0",textAlign:"center",color:"rgba(var(--tint),0.3)",fontSize:12}}>No customers in dataset</div>
                      ) : (
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                          <tbody>
                            {list.map((c, i) => {
                              const pct = (c.total / maxVal) * 100;
                              return (
                                <tr key={c.customer} style={{borderBottom: i === list.length - 1 ? "none" : "1px solid rgba(var(--tint),0.04)"}}>
                                  <td style={{padding:"8px 8px 8px 0",width:24,color:"rgba(var(--tint),0.4)",fontSize:11,fontFamily:"'Space Mono',monospace",verticalAlign:"top"}}>
                                    {String(i + 1).padStart(2, "0")}
                                  </td>
                                  <td style={{padding:"8px 8px",verticalAlign:"top"}}>
                                    <div style={{color:"rgba(var(--tint),0.9)",marginBottom:4,fontWeight:500}}>{c.customer}</div>
                                    <div style={{height:4,background:"rgba(var(--tint),0.05)",borderRadius:2,overflow:"hidden"}}>
                                      <div style={{width:`${pct}%`,height:"100%",background:COLORS[sp] || "#888",opacity:0.7,transition:"width 0.3s"}} />
                                    </div>
                                  </td>
                                  <td style={{padding:"8px 0",fontFamily:"'Space Mono',monospace",fontSize:12,color:"rgba(var(--tint),0.85)",fontWeight:600,whiteSpace:"nowrap",verticalAlign:"top",textAlign:"right"}}>
                                    {fmtFull(c.total)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === "yoy" && (
          <>
            <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:12,color:"rgba(var(--tint),0.4)",marginRight:8}}>View:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            <Card style={{marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>
                {selectedSP === "All" ? "Annual Revenue by Team" : `Annual Revenue — ${selectedSP}`}
              </div>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={yearCompData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                  <XAxis dataKey="year" tick={{fill:tk.chartTickFill,fontSize:12}} axisLine={false} />
                  <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                  <Tooltip content={<CustomTooltip />} />
                  {selectedSP === "All" && <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />}
                  {selectedSP === "All" ? (
                    SALESPEOPLE.map(sp => (
                      <Bar isAnimationActive={!reduceMotion} key={sp} dataKey={sp} fill={COLORS[sp] || "#888"} radius={[2,2,0,0]} />
                    ))
                  ) : (
                    <Bar isAnimationActive={!reduceMotion} dataKey={selectedSP} fill={COLORS[selectedSP] || "#888"} radius={[3,3,0,0]}>
                      <LabelList
                        dataKey={selectedSP}
                        position="top"
                        formatter={(v) => v > 0 ? fmt(v) : ""}
                        fill={tk.text}
                        fontSize={12}
                        fontFamily="'Space Mono',monospace"
                      />
                    </Bar>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card style={{marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>
                {selectedSP === "All" ? "Total Company Revenue Trend" : `Revenue Trend — ${selectedSP}`}
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={yearCompData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                  <XAxis dataKey="year" tick={{fill:tk.chartTickFill,fontSize:12}} axisLine={false} />
                  <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                  <Tooltip content={<CustomTooltip />} />
                  {selectedSP === "All" ? (
                    <Line isAnimationActive={!reduceMotion} type="monotone" dataKey="total" stroke={STATUS.accent} strokeWidth={3} dot={{r:5,fill:STATUS.accent}} name="Total Revenue">
                      <LabelList
                        dataKey="total"
                        position="top"
                        offset={12}
                        formatter={(v) => v > 0 ? fmt(v) : ""}
                        fill={tk.text}
                        fontSize={11}
                        fontFamily="'Space Mono',monospace"
                      />
                    </Line>
                  ) : (
                    <Line isAnimationActive={!reduceMotion} type="monotone" dataKey={selectedSP} stroke={COLORS[selectedSP] || "#888"} strokeWidth={3} dot={{r:5,fill:COLORS[selectedSP] || "#888"}} name={selectedSP}>
                      <LabelList
                        dataKey={selectedSP}
                        position="top"
                        offset={12}
                        formatter={(v) => v > 0 ? fmt(v) : ""}
                        fill={tk.text}
                        fontSize={11}
                        fontFamily="'Space Mono',monospace"
                      />
                    </Line>
                  )}
                </LineChart>
              </ResponsiveContainer>
              <div style={{fontSize:11,color:"rgba(var(--tint),0.35)",marginTop:10,textAlign:"center"}}>
                * Partial-year data is included as recorded
              </div>
            </Card>

            {selectedSP === "All" && (
              <>
                <div style={{marginTop:24,marginBottom:14,fontSize:14,fontWeight:600}}>YoY by Sales Team</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(min(280px,100%), 1fr))",gap:16}}>
                  {SALESPEOPLE.map(sp => {
                    const spYears = YEARS.map(y => {
                      const s = SUMMARY.find(d => d.sp === sp && d.year === y);
                      return { year: y.toString(), total: s?.total || 0 };
                    });
                    const spTotal = spYears.reduce((a,b) => a + b.total, 0);
                    const last = spYears[spYears.length - 1].total;
                    const prev = spYears[spYears.length - 2]?.total || 0;
                    const yoy = prev > 0 ? ((last - prev) / prev) * 100 : 0;
                    return (
                      <Card key={sp}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{width:12,height:12,borderRadius:4,background:COLORS[sp] || "#888"}} />
                            <div style={{fontSize:14,fontWeight:700}}>{sp}</div>
                          </div>
                          {prev > 0 && (
                            <span style={{
                              padding:"3px 8px",borderRadius:10,fontSize:10,fontWeight:600,
                              background:yoy>=0?"rgba(52,211,153,0.15)":"rgba(248,113,113,0.15)",
                              color:yoy>=0?STATUS.ok:STATUS.bad
                            }}>
                              {yoy>=0?"▲":"▼"} {Math.abs(yoy).toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <div style={{fontSize:11,color:"rgba(var(--tint),0.4)",marginBottom:12,fontFamily:"'Space Mono',monospace"}}>
                          5-yr total: {fmtFull(spTotal)}
                        </div>
                        <ResponsiveContainer width="100%" height={140}>
                          <BarChart data={spYears} margin={{top:18,right:8,bottom:0,left:0}}>
                            <XAxis dataKey="year" tick={{fill:tk.chartTickFill,fontSize:10}} axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                            <Bar isAnimationActive={!reduceMotion} dataKey="total" fill={COLORS[sp] || "#888"} radius={[3,3,0,0]} opacity={0.85}>
                              <LabelList dataKey="total" position="top" formatter={(v) => v > 0 ? fmt(v) : ""} fill={tk.text} fontSize={9} fontFamily="'Space Mono',monospace" />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {tab === "drilldown" && (
          <div style={{display:"grid",gridTemplateColumns: isNarrow ? "1fr" : "320px 1fr",gap:20}}>
            <Card>
              <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Customers ({customerIndex.length.toLocaleString()})</div>
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search customer…"
                style={{
                  width:"100%",boxSizing:"border-box",padding:"8px 12px",
                  background:"rgba(var(--tint),0.04)",border:"1px solid rgba(var(--tint),0.08)",
                  color:"var(--text)",borderRadius:8,fontSize:13,marginBottom:12,outline:"none"
                }}
              />
              <div style={{maxHeight:560,overflowY:"auto"}}>
                {filteredCustomerList.map(c => (
                  <button
                    key={c.customer}
                    onClick={() => setSelectedCustomer(c.customer)}
                    style={{
                      display:"flex",justifyContent:"space-between",alignItems:"center",
                      width:"100%",padding:"8px 10px",marginBottom:2,
                      background: activeCustomer?.customer === c.customer ? "rgba(232,99,59,0.15)" : "transparent",
                      border: activeCustomer?.customer === c.customer ? "1px solid rgba(232,99,59,0.3)" : "1px solid transparent",
                      color:"var(--text)",borderRadius:6,cursor:"pointer",fontSize:12,textAlign:"left"
                    }}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,marginRight:8}}>{c.customer}</span>
                    <span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"rgba(var(--tint),0.5)"}}>{fmt(c.total)}</span>
                  </button>
                ))}
              </div>
            </Card>

            <div>
              {activeCustomer && (
                <>
                  <Card style={{marginBottom:16}}>
                    <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:1.5,color:"rgba(var(--tint),0.4)",marginBottom:6}}>Customer</div>
                    <div style={{fontSize:24,fontWeight:700,marginBottom:8}}>{activeCustomer.customer}</div>
                    <div style={{display:"flex",gap:24,flexWrap:"wrap",fontSize:13,color:"rgba(var(--tint),0.7)"}}>
                      <div><span style={{color:"rgba(var(--tint),0.4)"}}>Total all time:</span> <span style={{fontFamily:"'Space Mono',monospace",fontWeight:600,color:STATUS.accent}}>{fmtFull(activeCustomer.total)}</span></div>
                      <div><span style={{color:"rgba(var(--tint),0.4)"}}>Active years:</span> {Object.keys(activeCustomer.perYear).filter(y => activeCustomer.perYear[y] > 0).length}</div>
                      <div>
                        <span style={{color:"rgba(var(--tint),0.4)"}}>Served by:</span>{" "}
                        {activeCustomer.perSP.map(sp => (
                          <span key={sp} style={{display:"inline-flex",alignItems:"center",gap:4,marginRight:8}}>
                            <span style={{width:8,height:8,borderRadius:2,background:COLORS[sp] || "#888",display:"inline-block"}} />
                            {sp}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Card>

                  <Card style={{marginBottom:16}}>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>Monthly Revenue by Year</div>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={customerMonthlyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                        <XAxis dataKey="month" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                        <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                        {YEARS.map((y, i) => (
                          <Line isAnimationActive={!reduceMotion} key={y} type="monotone" dataKey={y} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2} dot={false} name={y.toString()} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <div style={{display:"grid",gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",gap:16}}>
                    <Card>
                      <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>Annual Total</div>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={customerYearTotals}>
                          <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                          <XAxis dataKey="year" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                          <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                          <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                          <Bar isAnimationActive={!reduceMotion} dataKey="total" fill={STATUS.accent} radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>
                    <Card>
                      <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>💰 Top Brands by Revenue</div>
                      {customerTopBrandsByAmt.length === 0 ? (
                        <div style={{color:"rgba(var(--tint),0.4)",fontSize:13,padding:"40px 0",textAlign:"center"}}>No brand revenue for this customer</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(customerTopBrandsByAmt.length * 22, 220)}>
                          <BarChart data={customerTopBrandsByAmt} layout="vertical" margin={{left:80, right:60}}>
                            <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                            <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                            <YAxis type="category" dataKey="brand" tick={{fill:tk.chartTickFillDim,fontSize:11}} axisLine={false} width={75} />
                            <Tooltip formatter={(v, name, props) => [`${fmtFull(v)}  (${(props.payload.qty || 0).toLocaleString()} units)`, "Revenue"]} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                            <Bar isAnimationActive={!reduceMotion} dataKey="amt" fill={STATUS.accent} radius={[0,3,3,0]}>
                              <LabelList dataKey="amt" position="right" formatter={(v) => fmt(v)} fill={tk.text} fontSize={10} fontFamily="'Space Mono',monospace" />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </Card>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr",gap:16,marginTop:16}}>
                    <Card>
                      <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>📦 Top Brands by Quantity</div>
                      {customerTopBrandsByQty.length === 0 ? (
                        <div style={{color:"rgba(var(--tint),0.4)",fontSize:13,padding:"40px 0",textAlign:"center"}}>No quantity data for this customer</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(customerTopBrandsByQty.length * 22, 220)}>
                          <BarChart data={customerTopBrandsByQty} layout="vertical" margin={{left:80, right:60}}>
                            <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                            <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
                            <YAxis type="category" dataKey="brand" tick={{fill:tk.chartTickFillDim,fontSize:11}} axisLine={false} width={75} />
                            <Tooltip formatter={(v, name, props) => [`${v.toLocaleString()} units  (${fmtFull(props.payload.amt || 0)})`, "Quantity"]} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                            <Bar isAnimationActive={!reduceMotion} dataKey="qty" fill={STATUS.qty} radius={[0,3,3,0]}>
                              <LabelList dataKey="qty" position="right" formatter={(v) => v.toLocaleString()} fill={tk.text} fontSize={10} fontFamily="'Space Mono',monospace" />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </Card>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "brands" && (
          <>
            <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:12,color:"rgba(var(--tint),0.4)",marginRight:8}}>Filter by SP:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            <div style={{display:"flex",gap:16,marginBottom:24,flexWrap:"wrap"}}>
              <KPI label="Total Brands" value={brandYearTotals.length} sub={`${selectedYear} · ${selectedSP === "All" ? "all teams" : selectedSP}`} color={STATUS.accent} />
              <KPI label="Top Brand (Revenue)" value={brandYearTotals[0]?.brand || "—"} sub={`RM ${fmt(brandYearTotals[0]?.amt || 0)}`} color={STATUS.info} />
              <KPI label="Top Brand (Qty)" value={brandYearTotalsByQty[0]?.brand || "—"} sub={`${(brandYearTotalsByQty[0]?.qty || 0).toLocaleString()} pcs/boxes`} color={STATUS.qty} />
              <KPI label="Total Brand Revenue" value={`RM ${fmt(brandYearTotals.reduce((a,b) => a+b.amt, 0))}`} sub={`${selectedYear}`} color={STATUS.alt} />
              <KPI label="Total Quantity" value={brandYearTotals.reduce((a,b) => a+(b.qty||0), 0).toLocaleString()} sub="units sold" color={STATUS.watch} />
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(min(420px,100%), 1fr))",gap:20,marginBottom:20}}>
              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>💰 Top 20 Brands by Revenue — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={520}>
                  <BarChart data={brandYearTotals.slice(0,20)} layout="vertical" margin={{left:90, right:80}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                    <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                    <YAxis type="category" dataKey="brand" tick={{fill:tk.chartTickFillDim,fontSize:11}} axisLine={false} width={85} />
                    <Tooltip
                      formatter={(v, name, props) => [`${fmtFull(v)}  (${(props.payload.qty || 0).toLocaleString()} units)`, "Revenue"]}
                      contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}} itemStyle={{color:tk.tooltipText}} />
                    <Bar isAnimationActive={!reduceMotion} dataKey="amt" radius={[0,4,4,0]}>
                      {brandYearTotals.slice(0,20).map((_, i) => <Cell key={i} fill={STATUS.accent} opacity={1 - i * 0.025} />)}
                      <LabelList dataKey="amt" position="right" formatter={(v) => fmt(v)} fill={tk.text} fontSize={11} fontFamily="'Space Mono',monospace" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>📦 Top 20 Brands by Quantity — {selectedYear}</div>
                {brandYearTotalsByQty.length === 0 ? (
                  <div style={{padding:"60px 0",textAlign:"center",color:"rgba(var(--tint),0.4)"}}>No quantity data for this scope.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={520}>
                    <BarChart data={brandYearTotalsByQty.slice(0,20)} layout="vertical" margin={{left:90, right:80}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                      <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
                      <YAxis type="category" dataKey="brand" tick={{fill:tk.chartTickFillDim,fontSize:11}} axisLine={false} width={85} />
                      <Tooltip
                        formatter={(v, name, props) => [`${v.toLocaleString()} units  (${fmtFull(props.payload.amt || 0)})`, "Quantity"]}
                        contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}}
                        labelStyle={{color:tk.text,fontWeight:600,marginBottom:4}}
                        itemStyle={{color:tk.tooltipText}} />
                      <Bar isAnimationActive={!reduceMotion} dataKey="qty" radius={[0,4,4,0]}>
                        {brandYearTotalsByQty.slice(0,20).map((_, i) => <Cell key={i} fill={STATUS.qty} opacity={1 - i * 0.025} />)}
                        <LabelList dataKey="qty" position="right" formatter={(v) => v.toLocaleString()} fill={tk.text} fontSize={11} fontFamily="'Space Mono',monospace" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            <div style={{display:"grid",gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",gap:20}}>
              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Top 15 Brands by Team — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={380}>
                  <BarChart data={brandSPBreakdown} layout="vertical" margin={{left:80}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                    <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:10}} axisLine={false} tickFormatter={fmt} />
                    <YAxis type="category" dataKey="brand" tick={{fill:tk.chartTickFillDim,fontSize:10}} axisLine={false} width={75} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                    {SALESPEOPLE.map(sp => <Bar isAnimationActive={!reduceMotion} key={sp} dataKey={sp} stackId="x" fill={seriesFill(COLORS, sp)} />)}
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Top 8 Brands — Year over Year</div>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={brandYoY}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                    <XAxis dataKey="year" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                    <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:10}}>{v}</span>} />
                    {top8BrandNames.map((b, i) => (
                      <Line isAnimationActive={!reduceMotion} key={b} type="monotone" dataKey={b} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </>
        )}

        {tab === "cohort" && (
          <>
            <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:12,color:"rgba(var(--tint),0.4)",marginRight:8}}>SP:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            <div style={{fontSize:13,color:"rgba(var(--tint),0.5)",marginBottom:16}}>
              Comparing <strong style={{color:"var(--text)"}}>{selectedYear}</strong> vs <strong style={{color:"var(--text)"}}>{selectedYear-1}</strong>
              {" "} · scope: <strong style={{color:"var(--text)"}}>{selectedSP === "All" ? "all teams" : selectedSP}</strong>
            </div>

            <div style={{display:"flex",gap:16,marginBottom:24,flexWrap:"wrap"}}>
              <KPI label="New Customers" value={cohort.new.length} sub={`RM ${fmt(cohort.newRevenue)} revenue`} color={STATUS.ok} />
              <KPI label="Retained" value={cohort.retained.length} sub={`RM ${fmt(cohort.retainedRevenue)} revenue`} color={STATUS.info} />
              <KPI label="Lost" value={cohort.lost.length} sub={`RM ${fmt(cohort.lostRevenue)} prior revenue`} color={STATUS.bad} />
              <KPI label="Net Customer Δ" value={cohort.new.length - cohort.lost.length} sub={cohort.new.length > cohort.lost.length ? "growth" : "decline"} color={cohort.new.length >= cohort.lost.length ? STATUS.ok : STATUS.bad} />
            </div>

            <div style={{display:"grid",gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(min(240px,100%), 1fr))",gap:16}}>
              {[
                { title: "🟢 New", color: STATUS.ok, list: cohort.new, valueKey: "total", valueLabel: `${selectedYear} revenue` },
                { title: "🔵 Retained", color: STATUS.info, list: cohort.retained, valueKey: "total", valueLabel: `${selectedYear} revenue` },
                { title: "🔴 Lost", color: STATUS.bad, list: cohort.lost, valueKey: "prevTotal", valueLabel: `${selectedYear-1} revenue` },
              ].map(col => (
                <Card key={col.title}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <div style={{fontSize:14,fontWeight:600,color:col.color}}>{col.title}</div>
                    <div style={{fontSize:11,color:"rgba(var(--tint),0.4)"}}>{col.list.length} customers</div>
                  </div>
                  <div style={{fontSize:10,color:"rgba(var(--tint),0.35)",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{col.valueLabel}</div>
                  <div style={{
                    maxHeight:480,
                    overflowY:"auto",
                    // Reserve a fixed gutter for the scrollbar so it doesn't
                    // overlap the right-aligned revenue amounts. scrollbar-
                    // gutter handles it on modern browsers; the paddingRight
                    // is the fallback for anything that ignores the gutter.
                    scrollbarGutter:"stable",
                    paddingRight:6,
                  }}>
                    {col.list.length === 0 && <div style={{color:"rgba(var(--tint),0.3)",fontSize:13,padding:"20px 0"}}>None</div>}
                    {col.list.slice(0, 50).map((c) => (
                      <div key={c.customer} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"6px 0",borderBottom:"1px solid rgba(var(--tint),0.04)",fontSize:12}}>
                        <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.customer}</span>
                        <span style={{fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.7)",flexShrink:0,textAlign:"right",minWidth:44}}>{fmt(c[col.valueKey])}</span>
                      </div>
                    ))}
                    {col.list.length > 50 && <div style={{fontSize:11,color:"rgba(var(--tint),0.3)",paddingTop:8}}>+ {col.list.length - 50} more</div>}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {tab === "heatmap" && (
          <>
            <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:12,color:"rgba(var(--tint),0.4)",marginRight:8}}>SP:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            {heatmap.customers.length === 0 ? (
              <Card>
                <div style={{padding:"40px 0",textAlign:"center",color:"rgba(var(--tint),0.4)"}}>
                  No brand-level data for this scope.
                </div>
              </Card>
            ) : (
              <>
                <Card style={{marginBottom:20}}>
                  <div style={{fontSize:14,fontWeight:600,marginBottom:6,color:STATUS.accent}}>💰 Revenue heatmap — Top 12 × Top 12 — {selectedYear}</div>
                  <div style={{fontSize:12,color:"rgba(var(--tint),0.4)",marginBottom:16}}>Cell intensity = RM revenue. Hover for exact values (revenue + quantity).</div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{borderCollapse:"separate",borderSpacing:2,fontSize:11}}>
                      <thead>
                        <tr>
                          <th style={{padding:"6px 10px",textAlign:"left",color:"rgba(var(--tint),0.4)",fontWeight:500,minWidth:200}}>Customer ↓ / Brand →</th>
                          {heatmap.brands.map(b => (
                            <th key={b} style={{padding:"6px 4px",color:"rgba(var(--tint),0.6)",fontWeight:500,fontSize:10,minWidth:60,textAlign:"center"}}>
                              <div style={{transform:"rotate(-30deg)",transformOrigin:"left bottom",whiteSpace:"nowrap",height:60,marginTop:30}}>{b}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {heatmap.customers.map((c, ci) => (
                          <tr key={c}>
                            <td style={{padding:"6px 10px",color:"rgba(var(--tint),0.85)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200}}>{c}</td>
                            {heatmap.brands.map((b, bi) => {
                              const v = heatmap.gridAmt[ci][bi];
                              const q = heatmap.gridQty[ci][bi];
                              const intensity = heatmap.maxAmt > 0 ? v / heatmap.maxAmt : 0;
                              const bg = v === 0 ? "rgba(var(--tint),0.02)" : `rgba(232,99,59,${0.1 + intensity * 0.85})`;
                              return (
                                <td key={b} title={`${c} × ${b}\nRevenue: ${fmtFull(v)}\nQuantity: ${q.toLocaleString()} units`} style={{
                                  padding:"6px 4px",background:bg,borderRadius:4,textAlign:"center",
                                  fontFamily:"'Space Mono',monospace",fontSize:10,
                                  color: intensity > 0.4 ? "#fff" : "rgba(var(--tint),0.5)",cursor:"default"
                                }}>
                                  {v > 0 ? fmt(v) : "·"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card>
                  <div style={{fontSize:14,fontWeight:600,marginBottom:6,color:STATUS.qty}}>📦 Quantity heatmap — same Top 12 × Top 12 — {selectedYear}</div>
                  <div style={{fontSize:12,color:"rgba(var(--tint),0.4)",marginBottom:16}}>Cell intensity = units sold. Same axes as the revenue grid above for direct comparison.</div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{borderCollapse:"separate",borderSpacing:2,fontSize:11}}>
                      <thead>
                        <tr>
                          <th style={{padding:"6px 10px",textAlign:"left",color:"rgba(var(--tint),0.4)",fontWeight:500,minWidth:200}}>Customer ↓ / Brand →</th>
                          {heatmap.brands.map(b => (
                            <th key={b} style={{padding:"6px 4px",color:"rgba(var(--tint),0.6)",fontWeight:500,fontSize:10,minWidth:60,textAlign:"center"}}>
                              <div style={{transform:"rotate(-30deg)",transformOrigin:"left bottom",whiteSpace:"nowrap",height:60,marginTop:30}}>{b}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {heatmap.customers.map((c, ci) => (
                          <tr key={c}>
                            <td style={{padding:"6px 10px",color:"rgba(var(--tint),0.85)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200}}>{c}</td>
                            {heatmap.brands.map((b, bi) => {
                              const q = heatmap.gridQty[ci][bi];
                              const v = heatmap.gridAmt[ci][bi];
                              const intensity = heatmap.maxQty > 0 ? q / heatmap.maxQty : 0;
                              const bg = q === 0 ? "rgba(var(--tint),0.02)" : `rgba(16,185,129,${0.1 + intensity * 0.85})`;
                              return (
                                <td key={b} title={`${c} × ${b}\nQuantity: ${q.toLocaleString()} units\nRevenue: ${fmtFull(v)}`} style={{
                                  padding:"6px 4px",background:bg,borderRadius:4,textAlign:"center",
                                  fontFamily:"'Space Mono',monospace",fontSize:10,
                                  color: intensity > 0.4 ? "#fff" : "rgba(var(--tint),0.5)",cursor:"default"
                                }}>
                                  {q > 0 ? q.toLocaleString() : "·"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
          </>
        )}

        {tab === "targets" && (
          <>
            <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:12,color:"rgba(var(--tint),0.4)",marginRight:8}}>Scope:</span>
              <Pill label="Team total" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            {annualTarget === 0 ? (
              <Card>
                <div style={{padding:"40px 0",textAlign:"center",color:"rgba(var(--tint),0.5)"}}>
                  No target set for {selectedSP === "All" ? "team" : selectedSP} in {selectedYear}.
                </div>
              </Card>
            ) : (
              <>
                <div style={{display:"flex",gap:16,marginBottom:24,flexWrap:"wrap"}}>
                  <KPI label="Annual Target" value={`RM ${fmt(annualTarget)}`} sub={`${selectedSP === "All" ? "team" : selectedSP} · ${selectedYear}`} color={STATUS.info} />
                  <KPI label="YTD Actual" value={`RM ${fmt(ytd.actual)}`} sub={ytd.lastMonth ? `Jan–${MONTH_NAMES[ytd.lastMonth-1]}` : "no data"} color={STATUS.accent} />
                  <KPI label="YTD Target" value={`RM ${fmt(ytd.target)}`} sub={ytd.lastMonth ? `Jan–${MONTH_NAMES[ytd.lastMonth-1]}` : "—"} color="#94A3B8" />
                  <KPI
                    label="YTD Achievement"
                    value={`${ytdAchievement.toFixed(1)}%`}
                    sub={ytd.actual >= ytd.target ? `▲ RM ${fmt(ytd.actual - ytd.target)} above target` : `▼ RM ${fmt(ytd.target - ytd.actual)} below target`}
                    color={ytdAchievement >= 100 ? STATUS.ok : ytdAchievement >= 90 ? STATUS.watch : STATUS.bad}
                  />
                </div>

                <Card style={{marginBottom:20}}>
                  <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>
                    Monthly Actual vs Target — {selectedYear}
                  </div>
                  <ResponsiveContainer width="100%" height={360}>
                    <ComposedChart data={MONTH_NAMES.map((m, i) => {
                      const targetSp = selectedSP === "All" ? "_TEAM" : selectedSP;
                      const t = TARGETS.find(x => x.year === selectedYear && x.month === i + 1 && x.sp === targetSp);
                      const target = t ? t.target : 0;
                      let actual = 0;
                      const summary = SUMMARY.filter(s => s.year === selectedYear);
                      if (selectedSP === "All") summary.forEach(s => actual += s.months[i]);
                      else { const s = summary.find(d => d.sp === selectedSP); if (s) actual = s.months[i]; }
                      return { month: m, actual, target, gap: actual - target };
                    })}>
                      <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                      <XAxis dataKey="month" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                      <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                      <Bar isAnimationActive={!reduceMotion} dataKey="actual" fill={STATUS.accent} radius={[3,3,0,0]} name="Actual">
                        <LabelList dataKey="actual" position="top" formatter={(v) => v > 0 ? fmt(v) : ""} fill={tk.text} fontSize={10} fontFamily="'Space Mono',monospace" />
                      </Bar>
                      <Line isAnimationActive={!reduceMotion} type="monotone" dataKey="target" stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 5" dot={{r:4,fill:"#94A3B8"}} name="Target" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Card>

                <Card>
                  <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Monthly Achievement Breakdown</div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead>
                        <tr style={{borderBottom:"1px solid rgba(var(--tint),0.08)"}}>
                          {["Month","Target","Actual","Gap","Achievement"].map(h => (
                            <th key={h} style={{padding:"10px 14px",textAlign:"left",color:"rgba(var(--tint),0.4)",fontWeight:500,fontSize:11,textTransform:"uppercase",letterSpacing:1}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {MONTH_NAMES.map((m, i) => {
                          const targetSp = selectedSP === "All" ? "_TEAM" : selectedSP;
                          const t = TARGETS.find(x => x.year === selectedYear && x.month === i + 1 && x.sp === targetSp);
                          const target = t ? t.target : 0;
                          let actual = 0;
                          const summary = SUMMARY.filter(s => s.year === selectedYear);
                          if (selectedSP === "All") summary.forEach(s => actual += s.months[i]);
                          else { const s = summary.find(d => d.sp === selectedSP); if (s) actual = s.months[i]; }
                          if (target === 0 && actual === 0) return null;
                          const gap = actual - target;
                          const pct = target > 0 ? (actual / target) * 100 : 0;
                          const color = pct >= 100 ? STATUS.ok : pct >= 90 ? STATUS.watch : pct > 0 ? STATUS.bad : "rgba(var(--tint),0.3)";
                          return (
                            <tr key={m} style={{borderBottom:"1px solid rgba(var(--tint),0.04)"}}>
                              <td style={{padding:"10px 14px",fontWeight:600}}>{m}</td>
                              <td style={{padding:"10px 14px",fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.6)"}}>{fmtFull(target)}</td>
                              <td style={{padding:"10px 14px",fontFamily:"'Space Mono',monospace",fontWeight:600}}>{actual > 0 ? fmtFull(actual) : "—"}</td>
                              <td style={{padding:"10px 14px",fontFamily:"'Space Mono',monospace",color:gap >= 0 ? STATUS.ok : STATUS.bad}}>
                                {actual > 0 ? `${gap >= 0 ? "+" : ""}${fmtFull(gap)}` : "—"}
                              </td>
                              <td style={{padding:"10px 14px"}}>
                                {actual > 0 && target > 0 ? (
                                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                                    <div style={{width:120,height:6,background:"rgba(var(--tint),0.06)",borderRadius:3,overflow:"hidden"}}>
                                      <div style={{width:`${Math.min(pct,150)}%`,height:"100%",background:color,transition:"width 0.3s"}} />
                                    </div>
                                    <span style={{fontFamily:"'Space Mono',monospace",fontWeight:600,color,fontSize:12}}>{pct.toFixed(0)}%</span>
                                  </div>
                                ) : <span style={{color:"rgba(var(--tint),0.3)",fontSize:11}}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {selectedSP === "All" && user?.canViewAll && (
                  <Card style={{marginTop:20}}>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Per-Rep Achievement — {selectedYear}</div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead>
                        <tr style={{borderBottom:"1px solid rgba(var(--tint),0.08)"}}>
                          {["Rep","Annual Target","YTD Actual","YTD Target","Achievement"].map(h => (
                            <th key={h} style={{padding:"10px 14px",textAlign:"left",color:"rgba(var(--tint),0.4)",fontWeight:500,fontSize:11,textTransform:"uppercase",letterSpacing:1}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SALESPEOPLE.map(sp => {
                          const repTargets = TARGETS.filter(t => t.year === selectedYear && t.sp === sp);
                          const annT = repTargets.reduce((a, t) => a + t.target, 0);
                          if (annT === 0) return null;
                          const summary = SUMMARY.find(s => s.sp === sp && s.year === selectedYear);
                          let ytdA = 0, ytdT = 0;
                          if (summary) {
                            for (let i = 0; i < ytd.lastMonth; i++) ytdA += summary.months[i];
                          }
                          repTargets.filter(t => t.month <= ytd.lastMonth).forEach(t => { ytdT += t.target; });
                          const pct = ytdT > 0 ? (ytdA / ytdT) * 100 : 0;
                          const color = pct >= 100 ? STATUS.ok : pct >= 90 ? STATUS.watch : pct > 0 ? STATUS.bad : "rgba(var(--tint),0.3)";
                          return (
                            <tr key={sp} style={{borderBottom:"1px solid rgba(var(--tint),0.04)"}}>
                              <td style={{padding:"10px 14px",fontWeight:600}}>
                                <div style={{display:"flex",alignItems:"center",gap:8}}>
                                  <div style={{width:10,height:10,borderRadius:3,background:COLORS[sp] || "#888"}} />
                                  {sp}
                                </div>
                              </td>
                              <td style={{padding:"10px 14px",fontFamily:"'Space Mono',monospace"}}>{fmtFull(annT)}</td>
                              <td style={{padding:"10px 14px",fontFamily:"'Space Mono',monospace",fontWeight:600}}>{fmtFull(ytdA)}</td>
                              <td style={{padding:"10px 14px",fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.6)"}}>{fmtFull(ytdT)}</td>
                              <td style={{padding:"10px 14px"}}>
                                <div style={{display:"flex",alignItems:"center",gap:8}}>
                                  <div style={{width:120,height:6,background:"rgba(var(--tint),0.06)",borderRadius:3,overflow:"hidden"}}>
                                    <div style={{width:`${Math.min(pct,150)}%`,height:"100%",background:color}} />
                                  </div>
                                  <span style={{fontFamily:"'Space Mono',monospace",fontWeight:600,color,fontSize:12}}>{pct.toFixed(0)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{marginTop:14,fontSize:11,color:"rgba(var(--tint),0.4)",textAlign:"center"}}>
                      * Per-rep targets are derived from each rep's prior-year contribution share applied to the team monthly target.
                    </div>
                  </Card>
                )}
              </>
            )}
          </>
        )}

        {/* Guarded here as well as in the tab bar: hiding a button is not a
            control. Both panels also read through RLS / an admin-only function,
            so a non-admin who forced this state client-side still sees nothing. */}
        {tab === "data" && (user?.isAdmin
          ? <Suspense fallback={<Card><div style={{fontSize:13,color:"rgba(var(--tint),0.5)"}}>Loading file manager…</div></Card>}>
              <DataTab user={user} data={data} onRefresh={onRefresh} />
            </Suspense>
          : <Card><div style={{fontSize:13,color:"rgba(var(--tint),0.5)"}}>Admins only.</div></Card>
        )}

        {tab === "users" && (user?.isAdmin
          ? <Suspense fallback={<Card><div style={{fontSize:13,color:"rgba(var(--tint),0.5)"}}>Loading users…</div></Card>}>
              <AdminUsers user={user} />
            </Suspense>
          : <Card><div style={{fontSize:13,color:"rgba(var(--tint),0.5)"}}>Admins only.</div></Card>
        )}

      </div>

      <div style={{textAlign:"center",fontSize:11,color:"rgba(var(--tint),0.2)",padding:"40px 0 20px",fontFamily:"'Space Mono',monospace"}}>
        SEED Malaysia Sales Dashboard · {CUSTOMERS.length.toLocaleString()} customer-year rows · {BRAND_SALES.length.toLocaleString()} brand-sale rows · signed in as {user?.email || "—"}
      </div>
    </div>
  );
}
