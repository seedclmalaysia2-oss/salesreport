import { useState, useMemo, useEffect, useRef } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, LabelList, ComposedChart, ReferenceLine } from "recharts";
import bakedData from "./data.json";
import { buildDataFromFiles, parseFile, parseFilename, aggregate } from "./lib/parseXlsx.js";
import WeeklySalesCard from "./WeeklySalesCard.jsx";

const STORAGE_KEY = "salesDashboardUserData";
const FILES_KEY = "salesDashboardFileRegistry";

function loadFileRegistry() {
  try {
    const raw = localStorage.getItem(FILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFileRegistry(reg) {
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(reg));
    return null;
  } catch (e) {
    return e.message || String(e);
  }
}

function recomputeFromRegistry(registry) {
  const active = registry.filter(e => !e.deletedAt);
  const customerRows = [];
  const brandRows = [];
  for (const e of active) {
    if (e.kind === "customer" && Array.isArray(e.rows)) customerRows.push(...e.rows);
    else if (e.kind === "brand" && Array.isArray(e.rows)) brandRows.push(...e.rows);
  }
  return aggregate(customerRows, brandRows);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBlob(b64, type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type });
}

function fmtSize(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function detectedLabel(kind) {
  return kind === "customer" ? "Sales Analysis · Customer" : "Stock Sales · Brand";
}

function slidesFedFor(kind) {
  return kind === "customer"
    ? ["Overview", "Customer Trends", "Top Customers", "Monthly", "YoY", "Targets"]
    : ["Brand Performance", "Quantity Charts"];
}

function downloadEntry(entry) {
  if (!entry.bytes) {
    alert("Original file bytes not stored for this entry. Re-upload to enable Save.");
    return;
  }
  const blob = base64ToBlob(entry.bytes);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = entry.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const SALESPEOPLE_ORDER = ["Alan","Dino","Khen","Sakinah","Simon","Seed Malaysia"];
const YEARS_FALLBACK = [2022,2023,2024,2025,2026];

const COLORS = {
  "Alan": "#E8633B",
  "Dino": "#3B82F6",
  "Khen": "#10B981",
  "Sakinah": "#A855F7",
  "Simon": "#F59E0B",
  "Seed Malaysia": "#EC4899",
};

const PIE_COLORS = ["#E8633B","#3B82F6","#10B981","#A855F7","#F59E0B","#EC4899","#6366F1","#14B8A6","#F43F5E","#84CC16"];

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
    <div style={{fontSize:28,fontWeight:700,color:color||"#fff",fontFamily:"'Space Mono',monospace",lineHeight:1.1}}>{value}</div>
    {sub && <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",marginTop:6}}>{sub}</div>}
    {trend !== undefined && (
      <div style={{fontSize:12,marginTop:6,color:trend>=0?"#34D399":"#F87171",fontWeight:600}}>
        {trend>=0?"▲":"▼"} {Math.abs(trend).toFixed(1)}% vs prev year
      </div>
    )}
  </div>
);

const TabButton = ({active, children, onClick, accent}) => (
  <button onClick={onClick} style={{
    background: active ? (accent ? "rgba(52,211,153,0.15)" : "rgba(232,99,59,0.15)") : "transparent",
    color: active ? (accent ? "#34D399" : "#E8633B") : "rgba(var(--tint),0.5)",
    border: active ? `1px solid ${accent ? "rgba(52,211,153,0.3)" : "rgba(232,99,59,0.3)"}` : "1px solid transparent",
    borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: active ? 600 : 400,
    cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans',sans-serif",
    letterSpacing: 0.3
  }}>{children}</button>
);

const Pill = ({label, active, onClick}) => (
  <button onClick={onClick} style={{
    background: active ? "#E8633B" : "rgba(var(--tint),0.05)",
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

function loadStoredData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data?.summary) return null;
    return parsed; // { data, meta }
  } catch (e) {
    console.warn("Failed to load stored data", e);
    return null;
  }
}

// ============================================================
// 5 color themes designed for readability + sustained-screen comfort.
// Each ships its full token set so charts (SVG-attr-based) work too.
// ============================================================
const THEMES = {
  slate: {
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

export default function Dashboard({ data: incomingData, user, onLogout, onRefresh }) {
  const [tab, setTab] = useState("overview");
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedSP, setSelectedSP] = useState("All");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [topCustomersBySpView, setTopCustomersBySpView] = useState("grid");
  const [themeKey, setThemeKey] = useState(() => {
    try { return migrateThemeKey(localStorage.getItem("seedTheme")); } catch { return "slate"; }
  });
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem("seedTheme", themeKey); } catch {} }, [themeKey]);

  // Active theme object. All tokens live here so Recharts gets resolved colors
  // (SVG fill/stroke don't read CSS vars) and inline styles can use CSS vars.
  const tk = THEMES[themeKey] || THEMES.slate;

  // Data source: localStorage upload > prop from App > baked-in fallback
  const [stored, setStored] = useState(() => loadStoredData());
  const data = stored?.data ?? incomingData ?? bakedData;
  const isUploaded = !!stored;

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
    SALESPEOPLE.forEach(sp => {
      const map = new Map();
      CUSTOMERS.filter(r => r.sp === sp && r.total > 0).forEach(r => {
        map.set(r.customer, (map.get(r.customer) || 0) + r.total);
      });
      out[sp] = [...map.entries()]
        .map(([customer, total]) => ({ customer, total: Math.round(total * 100) / 100 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
    });
    return out;
  }, [data]);

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
          --tooltip-bg: ${tk.tooltipBg};
          --tooltip-border: ${tk.tooltipBorder};
          --tooltip-text: ${tk.tooltipText};
        }
        [data-seed-theme] input::placeholder { color: rgba(${tk.tintRgb}, 0.5); }
        [data-seed-theme] input, [data-seed-theme] button, [data-seed-theme] table { color: inherit; }
      `}</style>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div style={{
        background:"linear-gradient(135deg, rgba(232,99,59,0.08) 0%, rgba(59,130,246,0.05) 100%)",
        borderBottom:"1px solid rgba(var(--tint),0.06)",
        padding:"28px 32px 20px",
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
          <div>
            <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:2,color:"rgba(var(--tint),0.35)",marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
              <span>SEED Malaysia</span>
              {isUploaded && (
                <span style={{padding:"2px 8px",background:"rgba(52,211,153,0.15)",color:"#34D399",borderRadius:10,fontSize:10,letterSpacing:0.5}}>UPLOADED DATA</span>
              )}
            </div>
            <h1 style={{fontSize:26,fontWeight:700,margin:0,letterSpacing:-0.5,color:"var(--text)"}}>
              Sales Performance Dashboard
            </h1>
            <div style={{fontSize:13,color:"rgba(var(--tint),0.4)",marginTop:4}}>
              {YEARS[0]} – {YEARS[YEARS.length-1]} ·{" "}
              {isUploaded
                ? `${stored.meta?.fileCount ?? "?"} workbooks uploaded ${stored.meta?.parsedAt ? `· ${new Date(stored.meta.parsedAt).toLocaleString()}` : ""}`
                : "Live data from baked-in workbooks"}
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
                          {active && <span style={{color:"#E8633B",fontSize:14}}>●</span>}
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
                  background: user.isAdmin ? "linear-gradient(135deg,#E8633B,#F59E0B)" : (COLORS[user.sp] || "#3B82F6"),
                  color:"var(--text)",display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:11,fontWeight:700,fontFamily:"'Space Mono',monospace"
                }}>{(user.sp || "?")[0]?.toUpperCase()}</div>
                <div style={{display:"flex",flexDirection:"column",gap:0,lineHeight:1.1}}>
                  <div style={{fontSize:12,fontWeight:600}}>{user.isAdmin ? "Admin" : user.sp}</div>
                  <div style={{fontSize:10,color:"rgba(var(--tint),0.4)"}}>{user.email}</div>
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

        <div style={{display:"flex",gap:4,marginTop:20,flexWrap:"wrap"}}>
          <TabButton active={tab==="overview"} onClick={()=>setTab("overview")}>Overview</TabButton>
          <TabButton active={tab==="monthly"} onClick={()=>setTab("monthly")}>Monthly Trends</TabButton>
          <TabButton active={tab==="team"} onClick={()=>setTab("team")}>Team Analysis</TabButton>
          <TabButton active={tab==="customers"} onClick={()=>setTab("customers")}>Top Customers</TabButton>
          <TabButton active={tab==="yoy"} onClick={()=>setTab("yoy")}>Year-over-Year</TabButton>
          <TabButton active={tab==="drilldown"} onClick={()=>setTab("drilldown")}>Customer Drill-down</TabButton>
          <TabButton active={tab==="brands"} onClick={()=>setTab("brands")}>Brand Performance</TabButton>
          <TabButton active={tab==="cohort"} onClick={()=>setTab("cohort")}>New vs Lost</TabButton>
          <TabButton active={tab==="heatmap"} onClick={()=>setTab("heatmap")}>Customer × Brand</TabButton>
          <TabButton active={tab==="targets"} onClick={()=>setTab("targets")}>🎯 Targets</TabButton>
          <TabButton active={tab==="data"} onClick={()=>setTab("data")} accent>Data ⤴</TabButton>
        </div>
      </div>

      <div style={{padding:"24px 32px",maxWidth:1280,margin:"0 auto"}}>

        {tab === "overview" && (
          <>
            <WeeklySalesCard
              weeklySales={data.weeklySales || []}
              targets={TARGETS}
              isAdmin={!!user?.isAdmin}
              onUploaded={onRefresh}
            />
            <div style={{display:"flex",gap:16,marginBottom:28,flexWrap:"wrap"}}>
              <KPI label="Total Revenue" value={`RM ${fmt(currentYearTotal)}`} sub={`${selectedYear}`} trend={selectedYear>YEARS[0]?yoyChange:undefined} color="#E8633B" />
              {annualTarget > 0 ? (
                <KPI
                  label="YTD vs Target"
                  value={`${ytdAchievement.toFixed(0)}%`}
                  sub={`RM ${fmt(ytd.actual)} of RM ${fmt(ytd.target)} (Jan–${MONTH_NAMES[Math.max(ytd.lastMonth-1,0)] || "Dec"})`}
                  color={ytdAchievement >= 100 ? "#34D399" : ytdAchievement >= 90 ? "#F59E0B" : "#F87171"}
                />
              ) : (
                <KPI label="Top Performer" value={topSP?.sp || "—"} sub={`RM ${fmt(topSP?.total||0)}`} color="#3B82F6" />
              )}
              <KPI label="Annual Target" value={annualTarget > 0 ? `RM ${fmt(annualTarget)}` : "—"} sub={annualTarget > 0 ? `${annualAchievement.toFixed(0)}% achieved` : "no target set"} color="#3B82F6" />
              <KPI label="Active Teams" value={spPerformance.filter(s=>s.total>0).length} sub={`of ${SALESPEOPLE.length} teams`} color="#10B981" />
              <KPI label="Avg Monthly" value={`RM ${fmt(currentYearTotal / Math.max(SUMMARY.find(s => s.year === selectedYear)?.months.filter(m => m > 0).length || 12, 1))}`} sub="active months" color="#A855F7" />
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:24}}>
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
                        <stop offset="5%" stopColor="#E8633B" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#E8633B" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                    <XAxis dataKey="month" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                    <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="total" stroke="#E8633B" fill="url(#totalGrad)" strokeWidth={2} name="Actual" />
                    {annualTarget > 0 && (
                      <Line type="monotone" dataKey="target" stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Target" />
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
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                    <XAxis dataKey="month" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                    <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
                    <Tooltip formatter={(v) => `${v.toLocaleString()} units`} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                    <Area type="monotone" dataKey="total" stroke="#10B981" fill="url(#qtyGrad)" strokeWidth={2} name="Quantity" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:24}}>
              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Revenue by Team — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} dataKey="value" paddingAngle={3} stroke="none">
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[pieData[i]?.name] || PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
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
                    <Tooltip formatter={(v) => `${v.toLocaleString()} units`} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
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
                            color:i===0?"#E8633B":i===1?"#3B82F6":i===2?"#10B981":"rgba(var(--tint),0.5)"
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
                              color:s.change>=0?"#34D399":"#F87171"
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
                        <Bar key={sp} dataKey={sp} stackId="a" fill={COLORS[sp] || "#888"} radius={idx === arr.length - 1 ? [3,3,0,0] : [0,0,0,0]}>
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
                    <Bar dataKey={selectedSP} fill={COLORS[selectedSP] || "#888"} radius={[4,4,0,0]}>
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
                    formatter={(v, name) => [`${v.toLocaleString()} units`, name]}
                  />
                  <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                  {selectedSP === "All" ? (
                    <>
                      {SALESPEOPLE.filter(sp => SUMMARY.some(s => s.sp === sp && s.year === selectedYear && s.total > 0)).map((sp, idx, arr) => (
                        <Bar key={sp} dataKey={sp} stackId="qty" fill={COLORS[sp] || "#888"} radius={idx === arr.length - 1 ? [3,3,0,0] : [0,0,0,0]}>
                          {idx === arr.length - 1 && (
                            <LabelList dataKey="total" position="top" formatter={(v) => v > 0 ? v.toLocaleString() : ""} fill={tk.text} fontSize={11} fontFamily="'Space Mono',monospace" />
                          )}
                        </Bar>
                      ))}
                    </>
                  ) : (
                    <Bar dataKey={selectedSP} fill={COLORS[selectedSP] || "#888"} radius={[4,4,0,0]}>
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
                    <Line key={y} type="monotone" dataKey={y} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={y===selectedYear?3:1.5} dot={false} name={y.toString()} opacity={y===selectedYear?1:0.5} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </>
        )}

        {tab === "team" && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))",gap:16}}>
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
                      <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                      <Bar dataKey="total" fill={COLORS[sp] || "#888"} radius={[3,3,0,0]} opacity={0.8} />
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
              <KPI label="Local Customers" value={customerIndex.filter(c => c.region === "Local").length.toLocaleString()} sub={`RM ${fmt(customerIndex.filter(c => c.region === "Local").reduce((a,c) => a + c.total, 0))} all-time`} color="#3B82F6" />
              <KPI label="Overseas / Export" value={customerIndex.filter(c => c.region === "Overseas").length.toLocaleString()} sub={`RM ${fmt(customerIndex.filter(c => c.region === "Overseas").reduce((a,c) => a + c.total, 0))} all-time`} color="#EC4899" />
              <KPI label="Local : Overseas" value={`${((customerIndex.filter(c => c.region === "Local").reduce((a,c) => a + c.total, 0) / Math.max(customerIndex.reduce((a,c) => a + c.total, 0), 1)) * 100).toFixed(0)}% / ${((customerIndex.filter(c => c.region === "Overseas").reduce((a,c) => a + c.total, 0) / Math.max(customerIndex.reduce((a,c) => a + c.total, 0), 1)) * 100).toFixed(0)}%`} sub="of all-time revenue" color="#10B981" />
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
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
                      <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                      <Bar dataKey="total" name="Total Sales" radius={[0,4,4,0]}>
                        {topLocalCustomers.map((_, i) => <Cell key={i} fill="#3B82F6" opacity={1 - i * 0.035} />)}
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
                      <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                      <Bar dataKey="total" name="Total Sales" radius={[0,4,4,0]}>
                        {topOverseasCustomers.map((_, i) => <Cell key={i} fill="#EC4899" opacity={1 - i * 0.035} />)}
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
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{display:"inline-flex",background:"rgba(var(--tint),0.04)",border:"1px solid rgba(var(--tint),0.06)",borderRadius:8,padding:2}}>
                  <button onClick={()=>setTopCustomersBySpView("grid")} style={{
                    background: topCustomersBySpView === "grid" ? "rgba(232,99,59,0.2)" : "transparent",
                    color: topCustomersBySpView === "grid" ? "#E8633B" : "rgba(var(--tint),0.5)",
                    border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"
                  }}>▦ Grid</button>
                  <button onClick={()=>setTopCustomersBySpView("list")} style={{
                    background: topCustomersBySpView === "list" ? "rgba(232,99,59,0.2)" : "transparent",
                    color: topCustomersBySpView === "list" ? "#E8633B" : "rgba(var(--tint),0.5)",
                    border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"
                  }}>≡ List</button>
                </div>
                <div style={{fontSize:11,color:"rgba(var(--tint),0.4)"}}>All-time · {YEARS[0]}–{YEARS[YEARS.length-1]}</div>
              </div>
            </div>

            {topCustomersBySpView === "grid" && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(380px, 1fr))",gap:16}}>
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
                            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                            <Bar dataKey="total" fill={COLORS[sp] || "#888"} radius={[0,3,3,0]}>
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
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(420px, 1fr))",gap:16}}>
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
                      <Bar key={sp} dataKey={sp} fill={COLORS[sp] || "#888"} radius={[2,2,0,0]} />
                    ))
                  ) : (
                    <Bar dataKey={selectedSP} fill={COLORS[selectedSP] || "#888"} radius={[3,3,0,0]}>
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
                    <Line type="monotone" dataKey="total" stroke="#E8633B" strokeWidth={3} dot={{r:5,fill:"#E8633B"}} name="Total Revenue">
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
                    <Line type="monotone" dataKey={selectedSP} stroke={COLORS[selectedSP] || "#888"} strokeWidth={3} dot={{r:5,fill:COLORS[selectedSP] || "#888"}} name={selectedSP}>
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
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))",gap:16}}>
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
                              color:yoy>=0?"#34D399":"#F87171"
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
                            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                            <Bar dataKey="total" fill={COLORS[sp] || "#888"} radius={[3,3,0,0]} opacity={0.85}>
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
          <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:20}}>
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
                      <div><span style={{color:"rgba(var(--tint),0.4)"}}>Total all time:</span> <span style={{fontFamily:"'Space Mono',monospace",fontWeight:600,color:"#E8633B"}}>{fmtFull(activeCustomer.total)}</span></div>
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
                          <Line key={y} type="monotone" dataKey={y} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2} dot={false} name={y.toString()} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                    <Card>
                      <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>Annual Total</div>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={customerYearTotals}>
                          <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} />
                          <XAxis dataKey="year" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} />
                          <YAxis tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                          <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                          <Bar dataKey="total" fill="#E8633B" radius={[3,3,0,0]} />
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
                            <Tooltip formatter={(v, name, props) => [`${fmtFull(v)}  (${(props.payload.qty || 0).toLocaleString()} units)`, "Revenue"]} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                            <Bar dataKey="amt" fill="#E8633B" radius={[0,3,3,0]}>
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
                            <Tooltip formatter={(v, name, props) => [`${v.toLocaleString()} units  (${fmtFull(props.payload.amt || 0)})`, "Quantity"]} contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                            <Bar dataKey="qty" fill="#10B981" radius={[0,3,3,0]}>
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
              <KPI label="Total Brands" value={brandYearTotals.length} sub={`${selectedYear} · ${selectedSP === "All" ? "all teams" : selectedSP}`} color="#E8633B" />
              <KPI label="Top Brand (Revenue)" value={brandYearTotals[0]?.brand || "—"} sub={`RM ${fmt(brandYearTotals[0]?.amt || 0)}`} color="#3B82F6" />
              <KPI label="Top Brand (Qty)" value={brandYearTotalsByQty[0]?.brand || "—"} sub={`${(brandYearTotalsByQty[0]?.qty || 0).toLocaleString()} pcs/boxes`} color="#10B981" />
              <KPI label="Total Brand Revenue" value={`RM ${fmt(brandYearTotals.reduce((a,b) => a+b.amt, 0))}`} sub={`${selectedYear}`} color="#A855F7" />
              <KPI label="Total Quantity" value={brandYearTotals.reduce((a,b) => a+(b.qty||0), 0).toLocaleString()} sub="units sold" color="#F59E0B" />
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(420px, 1fr))",gap:20,marginBottom:20}}>
              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>💰 Top 20 Brands by Revenue — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={520}>
                  <BarChart data={brandYearTotals.slice(0,20)} layout="vertical" margin={{left:90, right:80}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                    <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:11}} axisLine={false} tickFormatter={fmt} />
                    <YAxis type="category" dataKey="brand" tick={{fill:tk.chartTickFillDim,fontSize:11}} axisLine={false} width={85} />
                    <Tooltip
                      formatter={(v, name, props) => [`${fmtFull(v)}  (${(props.payload.qty || 0).toLocaleString()} units)`, "Revenue"]}
                      contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                    <Bar dataKey="amt" radius={[0,4,4,0]}>
                      {brandYearTotals.slice(0,20).map((_, i) => <Cell key={i} fill="#E8633B" opacity={1 - i * 0.025} />)}
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
                        contentStyle={{background:tk.tooltipBg,border:`1px solid ${tk.tooltipBorder}`,borderRadius:8,fontSize:12,color:tk.tooltipText}} />
                      <Bar dataKey="qty" radius={[0,4,4,0]}>
                        {brandYearTotalsByQty.slice(0,20).map((_, i) => <Cell key={i} fill="#10B981" opacity={1 - i * 0.025} />)}
                        <LabelList dataKey="qty" position="right" formatter={(v) => v.toLocaleString()} fill={tk.text} fontSize={11} fontFamily="'Space Mono',monospace" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Top 15 Brands by Team — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={380}>
                  <BarChart data={brandSPBreakdown} layout="vertical" margin={{left:80}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tk.chartGrid} horizontal={false} />
                    <XAxis type="number" tick={{fill:tk.chartTickFill,fontSize:10}} axisLine={false} tickFormatter={fmt} />
                    <YAxis type="category" dataKey="brand" tick={{fill:tk.chartTickFillDim,fontSize:10}} axisLine={false} width={75} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend formatter={(v) => <span style={{color:"rgba(var(--tint),0.7)",fontSize:11}}>{v}</span>} />
                    {SALESPEOPLE.map(sp => <Bar key={sp} dataKey={sp} stackId="x" fill={COLORS[sp] || "#888"} />)}
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
                      <Line key={b} type="monotone" dataKey={b} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2} dot={false} />
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
              <KPI label="New Customers" value={cohort.new.length} sub={`RM ${fmt(cohort.newRevenue)} revenue`} color="#34D399" />
              <KPI label="Retained" value={cohort.retained.length} sub={`RM ${fmt(cohort.retainedRevenue)} revenue`} color="#3B82F6" />
              <KPI label="Lost" value={cohort.lost.length} sub={`RM ${fmt(cohort.lostRevenue)} prior revenue`} color="#F87171" />
              <KPI label="Net Customer Δ" value={cohort.new.length - cohort.lost.length} sub={cohort.new.length > cohort.lost.length ? "growth" : "decline"} color={cohort.new.length >= cohort.lost.length ? "#34D399" : "#F87171"} />
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
              {[
                { title: "🟢 New", color: "#34D399", list: cohort.new, valueKey: "total", valueLabel: `${selectedYear} revenue` },
                { title: "🔵 Retained", color: "#3B82F6", list: cohort.retained, valueKey: "total", valueLabel: `${selectedYear} revenue` },
                { title: "🔴 Lost", color: "#F87171", list: cohort.lost, valueKey: "prevTotal", valueLabel: `${selectedYear-1} revenue` },
              ].map(col => (
                <Card key={col.title}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <div style={{fontSize:14,fontWeight:600,color:col.color}}>{col.title}</div>
                    <div style={{fontSize:11,color:"rgba(var(--tint),0.4)"}}>{col.list.length} customers</div>
                  </div>
                  <div style={{fontSize:10,color:"rgba(var(--tint),0.35)",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{col.valueLabel}</div>
                  <div style={{maxHeight:480,overflowY:"auto"}}>
                    {col.list.length === 0 && <div style={{color:"rgba(var(--tint),0.3)",fontSize:13,padding:"20px 0"}}>None</div>}
                    {col.list.slice(0, 50).map((c, i) => (
                      <div key={c.customer} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(var(--tint),0.04)",fontSize:12}}>
                        <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginRight:8}}>{c.customer}</span>
                        <span style={{fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.7)"}}>{fmt(c[col.valueKey])}</span>
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
                  <div style={{fontSize:14,fontWeight:600,marginBottom:6,color:"#E8633B"}}>💰 Revenue heatmap — Top 12 × Top 12 — {selectedYear}</div>
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
                  <div style={{fontSize:14,fontWeight:600,marginBottom:6,color:"#10B981"}}>📦 Quantity heatmap — same Top 12 × Top 12 — {selectedYear}</div>
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
                  <KPI label="Annual Target" value={`RM ${fmt(annualTarget)}`} sub={`${selectedSP === "All" ? "team" : selectedSP} · ${selectedYear}`} color="#3B82F6" />
                  <KPI label="YTD Actual" value={`RM ${fmt(ytd.actual)}`} sub={ytd.lastMonth ? `Jan–${MONTH_NAMES[ytd.lastMonth-1]}` : "no data"} color="#E8633B" />
                  <KPI label="YTD Target" value={`RM ${fmt(ytd.target)}`} sub={ytd.lastMonth ? `Jan–${MONTH_NAMES[ytd.lastMonth-1]}` : "—"} color="#94A3B8" />
                  <KPI
                    label="YTD Achievement"
                    value={`${ytdAchievement.toFixed(1)}%`}
                    sub={ytd.actual >= ytd.target ? `▲ RM ${fmt(ytd.actual - ytd.target)} above target` : `▼ RM ${fmt(ytd.target - ytd.actual)} below target`}
                    color={ytdAchievement >= 100 ? "#34D399" : ytdAchievement >= 90 ? "#F59E0B" : "#F87171"}
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
                      <Bar dataKey="actual" fill="#E8633B" radius={[3,3,0,0]} name="Actual">
                        <LabelList dataKey="actual" position="top" formatter={(v) => v > 0 ? fmt(v) : ""} fill={tk.text} fontSize={10} fontFamily="'Space Mono',monospace" />
                      </Bar>
                      <Line type="monotone" dataKey="target" stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 5" dot={{r:4,fill:"#94A3B8"}} name="Target" />
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
                          const color = pct >= 100 ? "#34D399" : pct >= 90 ? "#F59E0B" : pct > 0 ? "#F87171" : "rgba(var(--tint),0.3)";
                          return (
                            <tr key={m} style={{borderBottom:"1px solid rgba(var(--tint),0.04)"}}>
                              <td style={{padding:"10px 14px",fontWeight:600}}>{m}</td>
                              <td style={{padding:"10px 14px",fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.6)"}}>{fmtFull(target)}</td>
                              <td style={{padding:"10px 14px",fontFamily:"'Space Mono',monospace",fontWeight:600}}>{actual > 0 ? fmtFull(actual) : "—"}</td>
                              <td style={{padding:"10px 14px",fontFamily:"'Space Mono',monospace",color:gap >= 0 ? "#34D399" : "#F87171"}}>
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

                {selectedSP === "All" && user?.isAdmin && (
                  <Card style={{marginTop:20}}>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Per-Rep Achievement — {selectedYear} (admin view)</div>
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
                          const color = pct >= 100 ? "#34D399" : pct >= 90 ? "#F59E0B" : pct > 0 ? "#F87171" : "rgba(var(--tint),0.3)";
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

        {tab === "data" && (
          <DataTab
            currentSource={isUploaded ? "uploaded" : "baked"}
            currentMeta={stored?.meta}
            onApply={(payload) => setStored(payload)}
            onReset={() => setStored(null)}
            data={data}
          />
        )}

      </div>

      <div style={{textAlign:"center",fontSize:11,color:"rgba(var(--tint),0.2)",padding:"40px 0 20px",fontFamily:"'Space Mono',monospace"}}>
        SEED Malaysia Sales Dashboard · {CUSTOMERS.length.toLocaleString()} customer-year rows · {BRAND_SALES.length.toLocaleString()} brand-sale rows · {isUploaded ? "uploaded data" : "baked-in data"}
      </div>
    </div>
  );
}

function DataTab({ currentSource, currentMeta, onApply, onReset, data }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [registry, setRegistry] = useState(() => loadFileRegistry());
  const [viewing, setViewing] = useState(null); // entry being previewed
  const [showTrash, setShowTrash] = useState(false);
  const dropRef = useRef(null);
  const inputRef = useRef(null);
  const updateInputRef = useRef(null);
  const updateTargetRef = useRef(null); // id of entry being updated

  const persistRegistry = (next) => {
    setRegistry(next);
    const err = saveFileRegistry(next);
    if (err) setError(`Registry save failed (localStorage limit?): ${err}`);
    return next;
  };

  // After registry changes, recompute aggregated data and apply to dashboard
  const applyRegistryToDashboard = (next) => {
    const active = next.filter(e => !e.deletedAt);
    if (!active.length) {
      // No active files → revert to baked-in
      localStorage.removeItem(STORAGE_KEY);
      onReset();
      return;
    }
    const aggregated = recomputeFromRegistry(next);
    const payload = {
      data: aggregated,
      meta: {
        fileCount: active.length,
        parsedAt: Date.now(),
        customerFiles: active.filter(e => e.kind === "customer").length,
        brandFiles: active.filter(e => e.kind === "brand").length,
      },
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      setError(`Saved registry but aggregate cache failed: ${e.message}`);
    }
    onApply(payload);
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropRef.current) dropRef.current.style.borderColor = "rgba(var(--tint),0.1)";
    const files = [...e.dataTransfer.files].filter(f => f.name.endsWith(".xlsx"));
    addFiles(files);
  };

  const addFiles = (files) => {
    setSelectedFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const additions = files.filter(f => !existing.has(f.name));
      return [...prev, ...additions];
    });
    setResults(null);
    setError(null);
  };

  const removeFile = (name) => {
    setSelectedFiles(prev => prev.filter(f => f.name !== name));
  };

  const clearFiles = () => {
    setSelectedFiles([]);
    setResults(null);
    setError(null);
  };

  const onParseClick = async () => {
    if (!selectedFiles.length) return;
    setParsing(true);
    setError(null);
    setResults(null);
    setProgress({ index: 0, total: selectedFiles.length, file: "starting…" });
    try {
      const { data: parsed, fileResults } = await buildDataFromFiles(selectedFiles, (p) => setProgress(p));
      setResults({ parsed, fileResults });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setParsing(false);
      setProgress(null);
    }
  };

  const applyResults = async () => {
    if (!results?.fileResults) return;
    const ok = results.fileResults.filter(r => r.ok);
    if (!ok.length) return;
    const now = Date.now();
    // Build a lookup of the original File objects to grab size + bytes
    const fileByName = new Map(selectedFiles.map(f => [f.name, f]));
    const byName = new Map(registry.map(e => [e.name, e]));
    for (const r of ok) {
      const src = fileByName.get(r.file);
      let bytes = null;
      let sizeBytes = src?.size ?? 0;
      if (src) {
        try {
          const buf = await src.arrayBuffer();
          bytes = arrayBufferToBase64(buf);
        } catch {
          bytes = null;
        }
      }
      byName.set(r.file, {
        id: byName.get(r.file)?.id ?? `f_${now}_${Math.random().toString(36).slice(2, 8)}`,
        name: r.file,
        sp: r.sp,
        year: r.year,
        kind: r.kind,
        rowCount: r.rowCount,
        rows: r.rows,
        sizeBytes,
        bytes,
        parsedAt: now,
        deletedAt: null,
      });
    }
    const next = [...byName.values()];
    // Try persisting with bytes; if it overflows, drop bytes and retry.
    let err = saveFileRegistry(next);
    if (err) {
      const slim = next.map(e => ({ ...e, bytes: null }));
      err = saveFileRegistry(slim);
      if (!err) {
        setRegistry(slim);
        setError("Saved file metadata but original bytes were dropped (localStorage too full to keep originals). Save/download won't work for these.");
        applyRegistryToDashboard(slim);
        setSelectedFiles([]);
        setResults(null);
        return;
      }
      setError(`Registry save failed: ${err}`);
    }
    setRegistry(next);
    applyRegistryToDashboard(next);
    setSelectedFiles([]);
    setResults(null);
  };

  const onResetClick = () => {
    if (!confirm("Discard ALL uploaded files (active and trashed) and revert to the baked-in dataset?")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(FILES_KEY);
    setRegistry([]);
    onReset();
  };

  const onViewFile = (entry) => setViewing(entry);

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
    const target = registry.find(r => r.id === targetId);
    if (!target) return;
    setParsing(true);
    setError(null);
    try {
      const res = await parseFile(file);
      if (!res.ok) {
        setError(`Update failed: ${res.error}`);
        return;
      }
      let bytes = null;
      try {
        const buf = await file.arrayBuffer();
        bytes = arrayBufferToBase64(buf);
      } catch {
        bytes = null;
      }
      // Replace this entry's rows/metadata; keep id. Use new filename in case user renamed.
      const next = registry.map(r => r.id === targetId ? {
        ...r,
        name: res.file,
        sp: res.sp,
        year: res.year,
        kind: res.kind,
        rowCount: res.rowCount,
        rows: res.rows,
        sizeBytes: file.size || 0,
        bytes,
        parsedAt: Date.now(),
        deletedAt: null,
      } : r);
      let err = saveFileRegistry(next);
      if (err) {
        const slim = next.map(r => r.id === targetId ? { ...r, bytes: null } : r);
        err = saveFileRegistry(slim);
        if (!err) {
          setRegistry(slim);
          setError("Updated but original bytes dropped (localStorage full). Download won't work for this entry.");
          applyRegistryToDashboard(slim);
          return;
        }
        setError(`Update save failed: ${err}`);
        return;
      }
      setRegistry(next);
      applyRegistryToDashboard(next);
    } catch (err) {
      setError(`Update failed: ${err.message || err}`);
    } finally {
      setParsing(false);
    }
  };

  const onDeleteFile = (entry) => {
    if (!confirm(`Move "${entry.name}" to trash? You can restore it later.`)) return;
    const next = registry.map(r => r.id === entry.id ? { ...r, deletedAt: Date.now() } : r);
    persistRegistry(next);
    applyRegistryToDashboard(next);
  };

  const onRestoreFile = (entry) => {
    const next = registry.map(r => r.id === entry.id ? { ...r, deletedAt: null } : r);
    persistRegistry(next);
    applyRegistryToDashboard(next);
  };

  const onPurgeFile = (entry) => {
    if (!confirm(`Permanently delete "${entry.name}"? This cannot be undone.`)) return;
    const next = registry.filter(r => r.id !== entry.id);
    persistRegistry(next);
  };

  const onEmptyTrash = () => {
    const trashed = registry.filter(r => r.deletedAt);
    if (!trashed.length) return;
    if (!confirm(`Permanently delete ${trashed.length} trashed file${trashed.length===1?"":"s"}? This cannot be undone.`)) return;
    persistRegistry(registry.filter(r => !r.deletedAt));
  };

  const validNames = selectedFiles.filter(f => parseFilename(f.name));
  const invalidNames = selectedFiles.filter(f => !parseFilename(f.name));
  const okResults = results?.fileResults.filter(r => r.ok) ?? [];
  const errResults = results?.fileResults.filter(r => !r.ok) ?? [];
  const totalCustomerRows = okResults.filter(r => r.kind === "customer").reduce((a, r) => a + r.rowCount, 0);
  const totalBrandRows = okResults.filter(r => r.kind === "brand").reduce((a, r) => a + r.rowCount, 0);

  return (
    <>
      <div style={{display:"flex",gap:16,marginBottom:24,flexWrap:"wrap"}}>
        <KPI label="Current Source" value={currentSource === "uploaded" ? "Uploaded" : "Baked-in"} sub={currentSource === "uploaded" && currentMeta ? `${currentMeta.fileCount} files · ${new Date(currentMeta.parsedAt).toLocaleString()}` : "src/data.json"} color={currentSource === "uploaded" ? "#34D399" : "#3B82F6"} />
        <KPI label="Customer-year rows" value={data.customers?.length.toLocaleString() ?? "0"} sub="loaded into the dashboard" color="#E8633B" />
        <KPI label="Brand-sale rows" value={data.brandSales?.length.toLocaleString() ?? "0"} sub={`across ${(data.brands || []).length} brands`} color="#A855F7" />
        <KPI label="Years covered" value={(data.years || []).join(", ")} sub={`${(data.salespeople || []).length} salespeople`} color="#10B981" />
      </div>

      <Card style={{marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>Upload new workbooks</div>
        <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",marginBottom:16,lineHeight:1.5}}>
          Drag <strong>.xlsx</strong> files matching the naming pattern:<br/>
          <code style={{fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.7)",fontSize:11}}>{"<SP> <YYYY> Sales Analysis by customer.xlsx"}</code> &nbsp;or&nbsp;
          <code style={{fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.7)",fontSize:11}}>{"<SP> <YYYY> Stock Sales Analysis - Summary by Brand.xlsx"}</code><br/>
          Uploads are parsed in your browser and saved to localStorage. They <strong>replace</strong> the baked-in dataset until you reset.
        </div>

        <div
          ref={dropRef}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (dropRef.current) dropRef.current.style.borderColor = "rgba(232,99,59,0.6)"; }}
          onDragLeave={() => { if (dropRef.current) dropRef.current.style.borderColor = "rgba(var(--tint),0.1)"; }}
          onDrop={onDrop}
          style={{
            border:"2px dashed rgba(var(--tint),0.1)",
            borderRadius:12,
            padding:"40px 20px",
            textAlign:"center",
            cursor:"pointer",
            transition:"all 0.2s",
            background:"rgba(var(--tint),0.01)"
          }}
        >
          <div style={{fontSize:28,marginBottom:8,opacity:0.4}}>⤴</div>
          <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Drop xlsx files here</div>
          <div style={{fontSize:12,color:"rgba(var(--tint),0.4)"}}>or click to browse</div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            multiple
            style={{display:"none"}}
            onChange={(e) => addFiles([...e.target.files])}
          />
        </div>

        {selectedFiles.length > 0 && (
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:16,marginBottom:8}}>
              <div style={{fontSize:12,color:"rgba(var(--tint),0.6)"}}>
                <strong style={{color:"var(--text)"}}>{selectedFiles.length}</strong> file{selectedFiles.length===1?"":"s"} selected
                {validNames.length !== selectedFiles.length && <span style={{color:"#F87171"}}> · {invalidNames.length} invalid name{invalidNames.length===1?"":"s"}</span>}
              </div>
              <button onClick={clearFiles} style={{background:"transparent",border:"none",color:"rgba(var(--tint),0.4)",fontSize:11,cursor:"pointer",textDecoration:"underline"}}>clear</button>
            </div>
            <div style={{maxHeight:240,overflowY:"auto",border:"1px solid rgba(var(--tint),0.04)",borderRadius:8}}>
              {selectedFiles.map(f => {
                const info = parseFilename(f.name);
                return (
                  <div key={f.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:"1px solid rgba(var(--tint),0.03)",fontSize:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                      <span style={{color: info ? "#34D399" : "#F87171",fontWeight:600,flexShrink:0}}>{info ? "✓" : "✗"}</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{f.name}</span>
                      {info && <span style={{color:"rgba(var(--tint),0.4)",fontSize:10,fontFamily:"'Space Mono',monospace",flexShrink:0}}>{info.sp} · {info.year} · {info.kind === "Sales Analysis by customer" ? "customer" : "brand"}</span>}
                    </div>
                    <button onClick={() => removeFile(f.name)} style={{background:"transparent",border:"none",color:"rgba(var(--tint),0.3)",cursor:"pointer",fontSize:14,padding:"0 0 0 8px"}}>✕</button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div style={{display:"flex",gap:10,marginTop:16,flexWrap:"wrap"}}>
          <button
            onClick={onParseClick}
            disabled={parsing || !validNames.length}
            style={{
              background: parsing || !validNames.length ? "rgba(var(--tint),0.05)" : "#E8633B",
              color: parsing || !validNames.length ? "rgba(var(--tint),0.3)" : "#fff",
              border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:600,
              cursor: parsing || !validNames.length ? "not-allowed" : "pointer",
              fontFamily:"'DM Sans',sans-serif"
            }}>
            {parsing ? "Parsing…" : `Parse ${validNames.length} valid file${validNames.length===1?"":"s"}`}
          </button>
          {currentSource === "uploaded" && (
            <button onClick={onResetClick} style={{
              background:"transparent",color:"#F87171",border:"1px solid rgba(248,113,113,0.3)",
              borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:600,cursor:"pointer"
            }}>Reset to baked-in</button>
          )}
        </div>

        {progress && (
          <div style={{marginTop:14,fontSize:12,color:"rgba(var(--tint),0.6)",fontFamily:"'Space Mono',monospace"}}>
            [{progress.index + 1}/{progress.total}] parsing {progress.file}
          </div>
        )}
        {error && (
          <div style={{marginTop:14,padding:"10px 14px",background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:8,fontSize:12,color:"#F87171"}}>
            ⚠ {error}
          </div>
        )}
      </Card>

      {results && (
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
            <div style={{fontSize:14,fontWeight:600}}>Parse results</div>
            <div style={{display:"flex",gap:18,fontSize:12,color:"rgba(var(--tint),0.6)"}}>
              <span>✓ {okResults.length} ok</span>
              {errResults.length > 0 && <span style={{color:"#F87171"}}>✗ {errResults.length} failed</span>}
              <span>{totalCustomerRows.toLocaleString()} customer rows</span>
              <span>{totalBrandRows.toLocaleString()} brand rows</span>
            </div>
          </div>

          <div style={{maxHeight:300,overflowY:"auto",marginBottom:16,border:"1px solid rgba(var(--tint),0.04)",borderRadius:8}}>
            {results.fileResults.map(r => (
              <div key={r.file} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:"1px solid rgba(var(--tint),0.03)",fontSize:12}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                  <span style={{color: r.ok ? "#34D399" : "#F87171",fontWeight:600}}>{r.ok ? "✓" : "✗"}</span>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{r.file}</span>
                </div>
                {r.ok ? (
                  <span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"rgba(var(--tint),0.5)"}}>{r.rowCount} rows · {r.kind}</span>
                ) : (
                  <span style={{fontSize:11,color:"#F87171"}}>{r.error}</span>
                )}
              </div>
            ))}
          </div>

          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button
              onClick={applyResults}
              disabled={!okResults.length}
              style={{
                background: okResults.length ? "#34D399" : "rgba(var(--tint),0.05)",
                color: okResults.length ? "#0A0A0F" : "rgba(var(--tint),0.3)",
                border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,
                cursor: okResults.length ? "pointer" : "not-allowed"
              }}>
              Apply &amp; merge into registry
            </button>
            <button onClick={() => setResults(null)} style={{
              background:"transparent",color:"rgba(var(--tint),0.5)",border:"1px solid rgba(var(--tint),0.1)",
              borderRadius:8,padding:"10px 22px",fontSize:13,cursor:"pointer"
            }}>Discard</button>
          </div>
        </Card>
      )}

      <UploadedFilesPanel
        registry={registry}
        onView={onViewFile}
        onUpdate={onUpdateFile}
        onSave={downloadEntry}
        onDelete={onDeleteFile}
        onRestore={onRestoreFile}
        onPurge={onPurgeFile}
        onEmptyTrash={onEmptyTrash}
        showTrash={showTrash}
        setShowTrash={setShowTrash}
        onScrollToUpload={() => dropRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
      />

      <input
        ref={updateInputRef}
        type="file"
        accept=".xlsx"
        style={{display:"none"}}
        onChange={onUpdateFilePicked}
      />

      {viewing && <FilePreviewModal entry={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function UploadedFilesPanel({ registry, onView, onUpdate, onSave, onDelete, onRestore, onPurge, onEmptyTrash, showTrash, setShowTrash, onScrollToUpload }) {
  const active = registry.filter(e => !e.deletedAt).sort((a,b) => (b.parsedAt||0) - (a.parsedAt||0));
  const trash = registry.filter(e => e.deletedAt).sort((a,b) => (b.deletedAt||0) - (a.deletedAt||0));
  if (!registry.length) return null;

  // Coverage matrix: (SP, year) cells with customer + brand availability
  const sps = [...new Set(active.map(e => e.sp))].sort();
  const years = [...new Set(active.map(e => e.year))].sort();
  const coverageKey = (sp, year, kind) => active.some(e => e.sp === sp && e.year === year && e.kind === kind);
  const gaps = [];
  sps.forEach(sp => years.forEach(year => {
    const hasCust = coverageKey(sp, year, "customer");
    const hasBrand = coverageKey(sp, year, "brand");
    if (!hasCust || !hasBrand) gaps.push({ sp, year, missing: [!hasCust && "customer", !hasBrand && "brand"].filter(Boolean) });
  }));

  const totalSize = active.reduce((a, e) => a + (e.sizeBytes || 0), 0);
  const withBytes = active.filter(e => e.bytes).length;

  return (
    <>
      <Card style={{marginTop:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
          <div style={{fontSize:14,fontWeight:600}}>
            Uploaded files <span style={{color:"rgba(var(--tint),0.4)",fontWeight:400,fontSize:12}}>· {active.length} active · {fmtSize(totalSize)} total · {withBytes}/{active.length} downloadable</span>
          </div>
        </div>

        {active.length === 0 ? (
          <div style={{fontSize:12,color:"rgba(var(--tint),0.4)",padding:"12px 0"}}>No active files. Upload above or restore from trash.</div>
        ) : (
          <div style={{overflow:"auto",border:"1px solid rgba(var(--tint),0.05)",borderRadius:10}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:880}}>
              <thead>
                <tr style={{background:"rgba(var(--tint),0.03)"}}>
                  {["FILE","DETECTED AS","SLIDES FED","SIZE","UPLOADED","ACTIONS"].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map(e => (
                  <FileTableRow key={e.id} entry={e} variant="active"
                    onView={onView} onUpdate={onUpdate} onSave={onSave} onDelete={onDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {gaps.length > 0 && (
        <Card style={{marginTop:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:10}}>
            <div style={{fontSize:13,fontWeight:600}}>Coverage gaps <span style={{color:"rgba(var(--tint),0.4)",fontWeight:400,fontSize:12}}>· {gaps.length} (SP, year) combo{gaps.length===1?"":"s"} missing a file</span></div>
            <button onClick={onScrollToUpload} style={{
              background:"#3B82F6",color:"#fff",border:"none",borderRadius:8,padding:"7px 14px",fontSize:11,fontWeight:600,cursor:"pointer"
            }}>↑ Upload here</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))",gap:8}}>
            {gaps.map((g, i) => (
              <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",border:"1px solid rgba(var(--tint),0.06)",borderRadius:8,padding:"8px 12px",fontSize:12}}>
                <div>
                  <div style={{fontWeight:600}}>{g.sp} · {g.year}</div>
                  <div style={{fontSize:10,color:"rgba(var(--tint),0.5)",fontFamily:"'Space Mono',monospace",marginTop:2}}>missing: {g.missing.join(" + ")}</div>
                </div>
                <span style={{color:"#F59E0B",fontSize:14}}>⚠</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {trash.length > 0 && (
        <Card style={{marginTop:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:10}}>
            <div style={{fontSize:13,fontWeight:600,color:"#F87171"}}>
              🗑 Recently deleted <span style={{color:"rgba(var(--tint),0.5)",fontWeight:400,fontSize:11}}>· {trash.length} file{trash.length===1?"":"s"} · restore any time</span>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={() => setShowTrash(s => !s)} style={{
                background:"transparent",border:"1px solid rgba(var(--tint),0.15)",color:"rgba(var(--tint),0.7)",
                borderRadius:8,padding:"6px 14px",fontSize:11,cursor:"pointer"
              }}>{showTrash ? "Hide" : "Show"}</button>
              {showTrash && (
                <button onClick={onEmptyTrash} style={{
                  background:"transparent",border:"1px solid rgba(248,113,113,0.3)",color:"#F87171",
                  borderRadius:8,padding:"6px 14px",fontSize:11,cursor:"pointer"
                }}>Empty trash</button>
              )}
            </div>
          </div>
          <div style={{fontSize:11,color:"rgba(var(--tint),0.4)",marginBottom:10}}>
            Files you remove are kept here until you click <strong style={{color:"#F87171"}}>Delete forever</strong>. Click <strong style={{color:"#34D399"}}>Restore</strong> to put one back in the active set.
          </div>
          {showTrash && (
            <div style={{overflow:"auto",border:"1px solid rgba(var(--tint),0.05)",borderRadius:10,opacity:0.92}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:760}}>
                <thead>
                  <tr style={{background:"rgba(var(--tint),0.03)"}}>
                    {["FILE","DETECTED AS","SIZE","DELETED","ACTIONS"].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trash.map(e => (
                    <FileTableRow key={e.id} entry={e} variant="trash"
                      onView={onView} onRestore={onRestore} onPurge={onPurge} onSave={onSave}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 1,
  color: "rgba(var(--tint),0.45)",
  borderBottom: "1px solid rgba(var(--tint),0.06)",
  textTransform: "uppercase",
  fontFamily: "'DM Sans',sans-serif",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 14px",
  borderBottom: "1px solid rgba(var(--tint),0.04)",
  verticalAlign: "middle",
};

function FileTableRow({ entry, variant, onView, onUpdate, onSave, onDelete, onRestore, onPurge }) {
  const ts = variant === "trash" ? entry.deletedAt : entry.parsedAt;
  const slides = slidesFedFor(entry.kind);
  const kindColor = entry.kind === "customer" ? "#34D399" : "#A855F7";
  return (
    <tr>
      <td style={{...tdStyle,maxWidth:260}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
          <span style={{color:kindColor,fontSize:14,marginTop:1,flexShrink:0}}>📄</span>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:240}}>{entry.name}</div>
            <div style={{fontSize:10,color:"rgba(var(--tint),0.45)",fontFamily:"'Space Mono',monospace",marginTop:2}}>{entry.sp} · {entry.year} · {entry.rowCount} rows</div>
          </div>
        </div>
      </td>
      <td style={tdStyle}>
        <span style={{display:"inline-block",padding:"3px 10px",borderRadius:6,background:`${kindColor}15`,color:kindColor,fontSize:11,fontWeight:600}}>{detectedLabel(entry.kind)}</span>
      </td>
      {variant === "active" && (
        <td style={tdStyle}>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {slides.map(s => (
              <span key={s} style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(var(--tint),0.04)",color:"rgba(var(--tint),0.65)",fontFamily:"'Space Mono',monospace"}}>{s}</span>
            ))}
          </div>
        </td>
      )}
      <td style={{...tdStyle,fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.7)",whiteSpace:"nowrap"}}>{fmtSize(entry.sizeBytes)}</td>
      <td style={{...tdStyle,fontFamily:"'Space Mono',monospace",color:"rgba(var(--tint),0.6)",whiteSpace:"nowrap",fontSize:11}}>
        {ts ? new Date(ts).toLocaleString("en-MY", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "—"}
      </td>
      <td style={tdStyle}>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          <button onClick={() => onView(entry)} style={actionBtn("#3B82F6")}>👁 View</button>
          {variant === "active" ? (
            <>
              <button onClick={() => onSave(entry)} disabled={!entry.bytes} style={actionBtn("#34D399", !entry.bytes)} title={entry.bytes ? "Download original .xlsx" : "Original bytes not stored"}>⬇ Save</button>
              <button onClick={() => onUpdate(entry)} style={actionBtn("#E8633B")}>↻ Update</button>
              <button onClick={() => onDelete(entry)} style={actionBtn("#F87171")}>🗑 Remove</button>
            </>
          ) : (
            <>
              <button onClick={() => onSave(entry)} disabled={!entry.bytes} style={actionBtn("#34D399", !entry.bytes)}>⬇ Save</button>
              <button onClick={() => onRestore(entry)} style={actionBtn("#34D399")}>↺ Restore</button>
              <button onClick={() => onPurge(entry)} style={actionBtn("#F87171")}>✕ Delete forever</button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function actionBtn(color, disabled = false) {
  return {
    background: "transparent",
    border: `1px solid ${disabled ? "rgba(255,255,255,0.08)" : color + "55"}`,
    color: disabled ? "rgba(var(--tint),0.25)" : color,
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "'DM Sans',sans-serif",
    whiteSpace: "nowrap",
  };
}

function FilePreviewModal({ entry, onClose }) {
  const rows = Array.isArray(entry.rows) ? entry.rows : [];
  const cols = entry.kind === "customer"
    ? ["sp","year","customer","total","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    : ["sp","year","customer","brand","amt","qty"];
  const getCell = (r, c) => {
    if (entry.kind === "customer" && MONTH_NAMES.includes(c)) {
      const idx = MONTH_NAMES.indexOf(c);
      return r.months?.[idx];
    }
    return r[c];
  };
  return (
    <div onClick={onClose} style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background:"var(--bg, #0A0A0F)",border:"1px solid rgba(var(--tint),0.1)",borderRadius:14,
        maxWidth:1200,width:"100%",maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden"
      }}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid rgba(var(--tint),0.06)"}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:14,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{entry.name}</div>
            <div style={{fontSize:11,color:"rgba(var(--tint),0.5)",marginTop:3,fontFamily:"'Space Mono',monospace"}}>
              {entry.sp} · {entry.year} · {entry.kind} · {rows.length} rows
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
              No rows stored for this file. (Older uploads before the file manager may not have row data — re-upload to enable preview.)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
