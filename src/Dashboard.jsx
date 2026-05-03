import { useState, useMemo, useEffect, useRef } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, LabelList } from "recharts";
import bakedData from "./data.json";
import { buildDataFromFiles, parseFilename } from "./lib/parseXlsx.js";

const STORAGE_KEY = "salesDashboardUserData";

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
    <div style={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#e0e0e0",boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
      <div style={{fontWeight:600,marginBottom:6,color:"#fff",fontSize:13}}>{label}</div>
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
  <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"20px 24px",flex:1,minWidth:180}}>
    <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:1.5,color:"rgba(255,255,255,0.4)",marginBottom:8,fontFamily:"'DM Sans',sans-serif"}}>{label}</div>
    <div style={{fontSize:28,fontWeight:700,color:color||"#fff",fontFamily:"'Space Mono',monospace",lineHeight:1.1}}>{value}</div>
    {sub && <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginTop:6}}>{sub}</div>}
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
    color: active ? (accent ? "#34D399" : "#E8633B") : "rgba(255,255,255,0.5)",
    border: active ? `1px solid ${accent ? "rgba(52,211,153,0.3)" : "rgba(232,99,59,0.3)"}` : "1px solid transparent",
    borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: active ? 600 : 400,
    cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans',sans-serif",
    letterSpacing: 0.3
  }}>{children}</button>
);

const Pill = ({label, active, onClick}) => (
  <button onClick={onClick} style={{
    background: active ? "#E8633B" : "rgba(255,255,255,0.05)",
    color: active ? "#fff" : "rgba(255,255,255,0.5)",
    border: "none", borderRadius: 20, padding: "6px 16px", fontSize: 12, fontWeight: 600,
    cursor: "pointer", transition: "all 0.2s", fontFamily: "'Space Mono',monospace"
  }}>{label}</button>
);

const Card = ({children, style}) => (
  <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:20,...style}}>
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

export default function Dashboard({ data: incomingData, user, onLogout }) {
  const [tab, setTab] = useState("overview");
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedSP, setSelectedSP] = useState("All");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [topCustomersBySpView, setTopCustomersBySpView] = useState("grid");

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

  const yearTotals = useMemo(() => {
    const t = {};
    YEARS.forEach(y => { t[y] = 0; });
    SUMMARY.forEach(s => { t[s.year] = (t[s.year] || 0) + s.total; });
    return t;
  }, [data]);

  const currentYearTotal = yearTotals[selectedYear] || 0;
  const prevYearTotal = yearTotals[selectedYear - 1] || 0;
  const yoyChange = prevYearTotal > 0 ? ((currentYearTotal - prevYearTotal) / prevYearTotal) * 100 : 0;

  const monthlyData = useMemo(() => {
    return MONTH_NAMES.map((m, i) => {
      const row = { month: m };
      const filtered = selectedSP === "All" ? SUMMARY : SUMMARY.filter(s => s.sp === selectedSP);
      filtered.filter(s => s.year === selectedYear).forEach(s => {
        row[s.sp] = s.months[i];
      });
      row.total = filtered.filter(s => s.year === selectedYear).reduce((acc, s) => acc + s.months[i], 0);
      return row;
    }).filter((_, i) => {
      // Trim trailing empty months (for partial-year datasets like 2026)
      const allMonthsThisYear = SUMMARY.filter(s => s.year === selectedYear);
      if (!allMonthsThisYear.length) return true;
      const monthHasAny = allMonthsThisYear.some(s => s.months[i] > 0);
      const futureMonthEmpty = !allMonthsThisYear.some(s => s.months[i] > 0);
      // Only trim from the right: keep the month if any month >= it has data
      if (futureMonthEmpty) {
        const anyLater = allMonthsThisYear.some(s => s.months.slice(i).some(v => v > 0));
        return anyLater;
      }
      return true;
    });
  }, [selectedYear, selectedSP, data]);

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

  const customerTopBrands = useMemo(() => {
    if (!activeCustomer) return [];
    const m = new Map();
    BRAND_SALES.filter(r => r.customer === activeCustomer.customer).forEach(r => {
      m.set(r.brand, (m.get(r.brand) || 0) + r.amt);
    });
    return [...m.entries()]
      .map(([brand, amt]) => ({ brand, amt }))
      .sort((a, b) => b.amt - a.amt)
      .slice(0, 12);
  }, [activeCustomer, data]);

  const brandYearTotals = useMemo(() => {
    const m = new Map();
    BRAND_SALES.filter(r => r.year === selectedYear && (selectedSP === "All" || r.sp === selectedSP)).forEach(r => {
      m.set(r.brand, (m.get(r.brand) || 0) + r.amt);
    });
    return [...m.entries()]
      .map(([brand, amt]) => ({ brand, amt }))
      .sort((a, b) => b.amt - a.amt);
  }, [selectedYear, selectedSP, data]);

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
    const custMap = new Map();
    BRAND_SALES.filter(r => r.year === selectedYear && (selectedSP === "All" || r.sp === selectedSP))
      .forEach(r => custMap.set(r.customer, (custMap.get(r.customer) || 0) + r.amt));
    const topCust = [...custMap.entries()].sort((a,b) => b[1]-a[1]).slice(0,12).map(([c]) => c);
    const brandMap = new Map();
    BRAND_SALES.filter(r => r.year === selectedYear && (selectedSP === "All" || r.sp === selectedSP))
      .forEach(r => brandMap.set(r.brand, (brandMap.get(r.brand) || 0) + r.amt));
    const topBrand = [...brandMap.entries()].sort((a,b) => b[1]-a[1]).slice(0,12).map(([b]) => b);
    const grid = topCust.map(() => topBrand.map(() => 0));
    BRAND_SALES.filter(r => r.year === selectedYear && (selectedSP === "All" || r.sp === selectedSP) &&
                       topCust.includes(r.customer) && topBrand.includes(r.brand))
      .forEach(r => {
        const ci = topCust.indexOf(r.customer);
        const bi = topBrand.indexOf(r.brand);
        grid[ci][bi] += r.amt;
      });
    let max = 0;
    grid.forEach(row => row.forEach(v => { if (v > max) max = v; }));
    return { customers: topCust, brands: topBrand, grid, max };
  }, [selectedSP, selectedYear, data]);

  return (
    <div style={{
      minHeight:"100vh",
      background:"#0A0A0F",
      color:"#fff",
      fontFamily:"'DM Sans',sans-serif",
      padding:"0 0 60px 0",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div style={{
        background:"linear-gradient(135deg, rgba(232,99,59,0.08) 0%, rgba(59,130,246,0.05) 100%)",
        borderBottom:"1px solid rgba(255,255,255,0.06)",
        padding:"28px 32px 20px",
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:16}}>
          <div>
            <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:2,color:"rgba(255,255,255,0.35)",marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
              <span>SEED Malaysia</span>
              {isUploaded && (
                <span style={{padding:"2px 8px",background:"rgba(52,211,153,0.15)",color:"#34D399",borderRadius:10,fontSize:10,letterSpacing:0.5}}>UPLOADED DATA</span>
              )}
            </div>
            <h1 style={{fontSize:26,fontWeight:700,margin:0,letterSpacing:-0.5,background:"linear-gradient(90deg,#fff,rgba(255,255,255,0.7))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
              Sales Performance Dashboard
            </h1>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.4)",marginTop:4}}>
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
            {user && (
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 12px 6px 8px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20}}>
                <div style={{
                  width:26,height:26,borderRadius:"50%",
                  background: user.isAdmin ? "linear-gradient(135deg,#E8633B,#F59E0B)" : (COLORS[user.sp] || "#3B82F6"),
                  color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:11,fontWeight:700,fontFamily:"'Space Mono',monospace"
                }}>{(user.sp || "?")[0]?.toUpperCase()}</div>
                <div style={{display:"flex",flexDirection:"column",gap:0,lineHeight:1.1}}>
                  <div style={{fontSize:12,fontWeight:600}}>{user.isAdmin ? "Admin" : user.sp}</div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.4)"}}>{user.email}</div>
                </div>
                {onLogout && (
                  <button onClick={onLogout} style={{
                    marginLeft:4,padding:"4px 10px",fontSize:11,fontWeight:600,
                    background:"transparent",border:"1px solid rgba(255,255,255,0.1)",
                    color:"rgba(255,255,255,0.6)",borderRadius:14,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"
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
          <TabButton active={tab==="data"} onClick={()=>setTab("data")} accent>Data ⤴</TabButton>
        </div>
      </div>

      <div style={{padding:"24px 32px",maxWidth:1280,margin:"0 auto"}}>

        {tab === "overview" && (
          <>
            <div style={{display:"flex",gap:16,marginBottom:28,flexWrap:"wrap"}}>
              <KPI label="Total Revenue" value={`RM ${fmt(currentYearTotal)}`} sub={`${selectedYear}`} trend={selectedYear>YEARS[0]?yoyChange:undefined} color="#E8633B" />
              <KPI label="Top Performer" value={topSP?.sp || "—"} sub={`RM ${fmt(topSP?.total||0)}`} color="#3B82F6" />
              <KPI label="Active Teams" value={spPerformance.filter(s=>s.total>0).length} sub={`of ${SALESPEOPLE.length} teams`} color="#10B981" />
              <KPI label="Avg Monthly" value={`RM ${fmt(currentYearTotal / Math.max(SUMMARY.find(s => s.year === selectedYear)?.months.filter(m => m > 0).length || 12, 1))}`} sub="active months" color="#A855F7" />
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:24}}>
              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Monthly Revenue — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyData}>
                    <defs>
                      <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#E8633B" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#E8633B" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} />
                    <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="total" stroke="#E8633B" fill="url(#totalGrad)" strokeWidth={2} name="Total" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Revenue by Team — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} dataKey="value" paddingAngle={3} stroke="none">
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[pieData[i]?.name] || PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#e0e0e0"}} />
                    <Legend formatter={(v) => <span style={{color:"rgba(255,255,255,0.7)",fontSize:11}}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <Card>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Team Performance Summary — {selectedYear}</div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
                      {["Rank","Team","Revenue","Avg/Month","Customers","YoY Change"].map(h => (
                        <th key={h} style={{padding:"10px 14px",textAlign:"left",color:"rgba(255,255,255,0.4)",fontWeight:500,fontSize:11,textTransform:"uppercase",letterSpacing:1}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {spPerformance.filter(s=>s.total>0).map((s, i) => (
                      <tr key={s.sp} style={{borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                        <td style={{padding:"12px 14px"}}>
                          <span style={{
                            display:"inline-flex",alignItems:"center",justifyContent:"center",
                            width:24,height:24,borderRadius:"50%",fontSize:11,fontWeight:700,
                            background:i===0?"rgba(232,99,59,0.2)":i===1?"rgba(59,130,246,0.15)":i===2?"rgba(16,185,129,0.15)":"rgba(255,255,255,0.05)",
                            color:i===0?"#E8633B":i===1?"#3B82F6":i===2?"#10B981":"rgba(255,255,255,0.5)"
                          }}>{i+1}</span>
                        </td>
                        <td style={{padding:"12px 14px",fontWeight:600}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{width:10,height:10,borderRadius:3,background:COLORS[s.sp] || "#888"}} />
                            {s.sp}
                          </div>
                        </td>
                        <td style={{padding:"12px 14px",fontFamily:"'Space Mono',monospace",fontWeight:600}}>{fmtFull(s.total)}</td>
                        <td style={{padding:"12px 14px",fontFamily:"'Space Mono',monospace",color:"rgba(255,255,255,0.6)"}}>{fmtFull(s.avgMonthly)}</td>
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
                          ) : <span style={{color:"rgba(255,255,255,0.3)",fontSize:11}}>N/A</span>}
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
              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginRight:8}}>Filter:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            <Card style={{marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Monthly Revenue Breakdown — {selectedYear}</div>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} />
                  <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend formatter={(v) => <span style={{color:"rgba(255,255,255,0.7)",fontSize:11}}>{v}</span>} />
                  {selectedSP === "All" ? (
                    <>
                      {SALESPEOPLE.filter(sp => SUMMARY.some(s => s.sp === sp && s.year === selectedYear && s.total > 0)).map((sp, idx, arr) => (
                        <Bar key={sp} dataKey={sp} stackId="a" fill={COLORS[sp] || "#888"} radius={idx === arr.length - 1 ? [3,3,0,0] : [0,0,0,0]}>
                          {idx === arr.length - 1 && (
                            <LabelList
                              dataKey="total"
                              position="top"
                              formatter={(v) => v > 0 ? fmt(v) : ""}
                              fill="rgba(255,255,255,0.85)"
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
                        fill="rgba(255,255,255,0.85)"
                        fontSize={11}
                        fontFamily="'Space Mono',monospace"
                      />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} />
                  <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend formatter={(v) => <span style={{color:"rgba(255,255,255,0.7)",fontSize:11}}>{v}</span>} />
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
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:14}}>{selectedYear} Revenue</div>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={spData.map(s => ({year: s.year.toString(), total: s.total}))}>
                      <XAxis dataKey="year" tick={{fill:"rgba(255,255,255,0.3)",fontSize:10}} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#e0e0e0"}} />
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
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{YEARS[0]}–{YEARS[YEARS.length-1]}</div>
                </div>
                {topLocalCustomers.length === 0 ? (
                  <div style={{padding:"60px 0",textAlign:"center",color:"rgba(255,255,255,0.4)"}}>No local customers in dataset.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(topLocalCustomers.length * 28, 200)}>
                    <BarChart data={topLocalCustomers} layout="vertical" margin={{left:140, right:70}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                      <XAxis type="number" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                      <YAxis type="category" dataKey="customer" tick={{fill:"rgba(255,255,255,0.6)",fontSize:11}} axisLine={false} width={135} />
                      <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#e0e0e0"}} />
                      <Bar dataKey="total" name="Total Sales" radius={[0,4,4,0]}>
                        {topLocalCustomers.map((_, i) => <Cell key={i} fill="#3B82F6" opacity={1 - i * 0.035} />)}
                        <LabelList dataKey="total" position="right" formatter={(v) => fmt(v)} fill="rgba(255,255,255,0.85)" fontSize={11} fontFamily="'Space Mono',monospace" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              <Card>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                  <div style={{fontSize:14,fontWeight:600}}>🌏 Top 20 Overseas / Export — All Time</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>served by Seed Malaysia</div>
                </div>
                {topOverseasCustomers.length === 0 ? (
                  <div style={{padding:"60px 0",textAlign:"center",color:"rgba(255,255,255,0.4)"}}>No overseas customers in dataset.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(topOverseasCustomers.length * 28, 200)}>
                    <BarChart data={topOverseasCustomers} layout="vertical" margin={{left:140, right:70}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                      <XAxis type="number" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                      <YAxis type="category" dataKey="customer" tick={{fill:"rgba(255,255,255,0.6)",fontSize:11}} axisLine={false} width={135} />
                      <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#e0e0e0"}} />
                      <Bar dataKey="total" name="Total Sales" radius={[0,4,4,0]}>
                        {topOverseasCustomers.map((_, i) => <Cell key={i} fill="#EC4899" opacity={1 - i * 0.035} />)}
                        <LabelList dataKey="total" position="right" formatter={(v) => fmt(v)} fill="rgba(255,255,255,0.85)" fontSize={11} fontFamily="'Space Mono',monospace" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>
            <div style={{marginTop:14,fontSize:11,color:"rgba(255,255,255,0.35)",textAlign:"center"}}>
              * Customers served by the <strong style={{color:"rgba(255,255,255,0.5)"}}>Seed Malaysia</strong> team in any year are classified as Overseas/Export. All others are Local.
            </div>

            <div style={{marginTop:32,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
              <div style={{fontSize:15,fontWeight:700,color:"rgba(255,255,255,0.9)"}}>Top 10 Customers by Sales Team</div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{display:"inline-flex",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,padding:2}}>
                  <button onClick={()=>setTopCustomersBySpView("grid")} style={{
                    background: topCustomersBySpView === "grid" ? "rgba(232,99,59,0.2)" : "transparent",
                    color: topCustomersBySpView === "grid" ? "#E8633B" : "rgba(255,255,255,0.5)",
                    border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"
                  }}>▦ Grid</button>
                  <button onClick={()=>setTopCustomersBySpView("list")} style={{
                    background: topCustomersBySpView === "list" ? "rgba(232,99,59,0.2)" : "transparent",
                    color: topCustomersBySpView === "list" ? "#E8633B" : "rgba(255,255,255,0.5)",
                    border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"
                  }}>≡ List</button>
                </div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>All-time · {YEARS[0]}–{YEARS[YEARS.length-1]}</div>
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
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>top 10</div>
                      </div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginBottom:14,fontFamily:"'Space Mono',monospace"}}>
                        Top-10 contribution: {fmtFull(spTotal)}
                      </div>
                      {list.length === 0 ? (
                        <div style={{padding:"40px 0",textAlign:"center",color:"rgba(255,255,255,0.3)",fontSize:12}}>No customers in dataset</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(list.length * 30, 220)}>
                          <BarChart data={list} layout="vertical" margin={{left:115, right: 60}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                            <XAxis type="number" tick={{fill:"rgba(255,255,255,0.4)",fontSize:10}} axisLine={false} tickFormatter={fmt} />
                            <YAxis type="category" dataKey="customer" tick={{fill:"rgba(255,255,255,0.6)",fontSize:10}} axisLine={false} width={110} />
                            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#e0e0e0"}} />
                            <Bar dataKey="total" fill={COLORS[sp] || "#888"} radius={[0,3,3,0]}>
                              <LabelList dataKey="total" position="right" formatter={(v) => fmt(v)} fill="rgba(255,255,255,0.85)" fontSize={11} fontFamily="'Space Mono',monospace" />
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
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>top {list.length}</div>
                      </div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginBottom:14,fontFamily:"'Space Mono',monospace"}}>
                        Top-10 contribution: {fmtFull(spTotal)}
                      </div>
                      {list.length === 0 ? (
                        <div style={{padding:"40px 0",textAlign:"center",color:"rgba(255,255,255,0.3)",fontSize:12}}>No customers in dataset</div>
                      ) : (
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                          <tbody>
                            {list.map((c, i) => {
                              const pct = (c.total / maxVal) * 100;
                              return (
                                <tr key={c.customer} style={{borderBottom: i === list.length - 1 ? "none" : "1px solid rgba(255,255,255,0.04)"}}>
                                  <td style={{padding:"8px 8px 8px 0",width:24,color:"rgba(255,255,255,0.4)",fontSize:11,fontFamily:"'Space Mono',monospace",verticalAlign:"top"}}>
                                    {String(i + 1).padStart(2, "0")}
                                  </td>
                                  <td style={{padding:"8px 8px",verticalAlign:"top"}}>
                                    <div style={{color:"rgba(255,255,255,0.9)",marginBottom:4,fontWeight:500}}>{c.customer}</div>
                                    <div style={{height:4,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden"}}>
                                      <div style={{width:`${pct}%`,height:"100%",background:COLORS[sp] || "#888",opacity:0.7,transition:"width 0.3s"}} />
                                    </div>
                                  </td>
                                  <td style={{padding:"8px 0",fontFamily:"'Space Mono',monospace",fontSize:12,color:"rgba(255,255,255,0.85)",fontWeight:600,whiteSpace:"nowrap",verticalAlign:"top",textAlign:"right"}}>
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
              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginRight:8}}>View:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            <Card style={{marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>
                {selectedSP === "All" ? "Annual Revenue by Team" : `Annual Revenue — ${selectedSP}`}
              </div>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={yearCompData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="year" tick={{fill:"rgba(255,255,255,0.4)",fontSize:12}} axisLine={false} />
                  <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                  <Tooltip content={<CustomTooltip />} />
                  {selectedSP === "All" && <Legend formatter={(v) => <span style={{color:"rgba(255,255,255,0.7)",fontSize:11}}>{v}</span>} />}
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
                        fill="rgba(255,255,255,0.85)"
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="year" tick={{fill:"rgba(255,255,255,0.4)",fontSize:12}} axisLine={false} />
                  <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                  <Tooltip content={<CustomTooltip />} />
                  {selectedSP === "All" ? (
                    <Line type="monotone" dataKey="total" stroke="#E8633B" strokeWidth={3} dot={{r:5,fill:"#E8633B"}} name="Total Revenue">
                      <LabelList
                        dataKey="total"
                        position="top"
                        offset={12}
                        formatter={(v) => v > 0 ? fmt(v) : ""}
                        fill="rgba(255,255,255,0.85)"
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
                        fill="rgba(255,255,255,0.85)"
                        fontSize={11}
                        fontFamily="'Space Mono',monospace"
                      />
                    </Line>
                  )}
                </LineChart>
              </ResponsiveContainer>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginTop:10,textAlign:"center"}}>
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
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:12,fontFamily:"'Space Mono',monospace"}}>
                          5-yr total: {fmtFull(spTotal)}
                        </div>
                        <ResponsiveContainer width="100%" height={140}>
                          <BarChart data={spYears} margin={{top:18,right:8,bottom:0,left:0}}>
                            <XAxis dataKey="year" tick={{fill:"rgba(255,255,255,0.4)",fontSize:10}} axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#e0e0e0"}} />
                            <Bar dataKey="total" fill={COLORS[sp] || "#888"} radius={[3,3,0,0]} opacity={0.85}>
                              <LabelList dataKey="total" position="top" formatter={(v) => v > 0 ? fmt(v) : ""} fill="rgba(255,255,255,0.7)" fontSize={9} fontFamily="'Space Mono',monospace" />
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
                  background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",
                  color:"#fff",borderRadius:8,fontSize:13,marginBottom:12,outline:"none"
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
                      color:"#fff",borderRadius:6,cursor:"pointer",fontSize:12,textAlign:"left"
                    }}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,marginRight:8}}>{c.customer}</span>
                    <span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"rgba(255,255,255,0.5)"}}>{fmt(c.total)}</span>
                  </button>
                ))}
              </div>
            </Card>

            <div>
              {activeCustomer && (
                <>
                  <Card style={{marginBottom:16}}>
                    <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:1.5,color:"rgba(255,255,255,0.4)",marginBottom:6}}>Customer</div>
                    <div style={{fontSize:24,fontWeight:700,marginBottom:8}}>{activeCustomer.customer}</div>
                    <div style={{display:"flex",gap:24,flexWrap:"wrap",fontSize:13,color:"rgba(255,255,255,0.7)"}}>
                      <div><span style={{color:"rgba(255,255,255,0.4)"}}>Total all time:</span> <span style={{fontFamily:"'Space Mono',monospace",fontWeight:600,color:"#E8633B"}}>{fmtFull(activeCustomer.total)}</span></div>
                      <div><span style={{color:"rgba(255,255,255,0.4)"}}>Active years:</span> {Object.keys(activeCustomer.perYear).filter(y => activeCustomer.perYear[y] > 0).length}</div>
                      <div>
                        <span style={{color:"rgba(255,255,255,0.4)"}}>Served by:</span>{" "}
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
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} />
                        <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend formatter={(v) => <span style={{color:"rgba(255,255,255,0.7)",fontSize:11}}>{v}</span>} />
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
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="year" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} />
                          <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                          <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#e0e0e0"}} />
                          <Bar dataKey="total" fill="#E8633B" radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>
                    <Card>
                      <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>Top Brands Purchased</div>
                      {customerTopBrands.length === 0 ? (
                        <div style={{color:"rgba(255,255,255,0.4)",fontSize:13,padding:"40px 0",textAlign:"center"}}>No brand-level data for this customer</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(customerTopBrands.length * 22, 220)}>
                          <BarChart data={customerTopBrands} layout="vertical" margin={{left:80, right:60}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                            <XAxis type="number" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                            <YAxis type="category" dataKey="brand" tick={{fill:"rgba(255,255,255,0.6)",fontSize:11}} axisLine={false} width={75} />
                            <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#e0e0e0"}} />
                            <Bar dataKey="amt" fill="#3B82F6" radius={[0,3,3,0]}>
                              <LabelList dataKey="amt" position="right" formatter={(v) => fmt(v)} fill="rgba(255,255,255,0.85)" fontSize={10} fontFamily="'Space Mono',monospace" />
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
              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginRight:8}}>Filter by SP:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            <div style={{display:"flex",gap:16,marginBottom:24,flexWrap:"wrap"}}>
              <KPI label="Total Brands" value={brandYearTotals.length} sub={`${selectedYear} · ${selectedSP === "All" ? "all teams" : selectedSP}`} color="#E8633B" />
              <KPI label="Top Brand" value={brandYearTotals[0]?.brand || "—"} sub={`RM ${fmt(brandYearTotals[0]?.amt || 0)}`} color="#3B82F6" />
              <KPI label="Top 5 Concentration" value={`${((brandYearTotals.slice(0,5).reduce((a,b) => a+b.amt, 0) / Math.max(brandYearTotals.reduce((a,b) => a+b.amt, 0), 1)) * 100).toFixed(0)}%`} sub="of brand revenue" color="#10B981" />
              <KPI label="Total Brand Revenue" value={`RM ${fmt(brandYearTotals.reduce((a,b) => a+b.amt, 0))}`} sub={`${selectedYear}`} color="#A855F7" />
            </div>

            <Card style={{marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Top 20 Brands — {selectedYear}</div>
              <ResponsiveContainer width="100%" height={520}>
                <BarChart data={brandYearTotals.slice(0,20)} layout="vertical" margin={{left:90, right:80}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                  <YAxis type="category" dataKey="brand" tick={{fill:"rgba(255,255,255,0.6)",fontSize:11}} axisLine={false} width={85} />
                  <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{background:"rgba(15,15,20,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:12,color:"#e0e0e0"}} />
                  <Bar dataKey="amt" radius={[0,4,4,0]}>
                    {brandYearTotals.slice(0,20).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} opacity={1 - i * 0.025} />)}
                    <LabelList dataKey="amt" position="right" formatter={(v) => fmt(v)} fill="rgba(255,255,255,0.85)" fontSize={11} fontFamily="'Space Mono',monospace" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Top 15 Brands by Team — {selectedYear}</div>
                <ResponsiveContainer width="100%" height={380}>
                  <BarChart data={brandSPBreakdown} layout="vertical" margin={{left:80}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={{fill:"rgba(255,255,255,0.4)",fontSize:10}} axisLine={false} tickFormatter={fmt} />
                    <YAxis type="category" dataKey="brand" tick={{fill:"rgba(255,255,255,0.6)",fontSize:10}} axisLine={false} width={75} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend formatter={(v) => <span style={{color:"rgba(255,255,255,0.7)",fontSize:11}}>{v}</span>} />
                    {SALESPEOPLE.map(sp => <Bar key={sp} dataKey={sp} stackId="x" fill={COLORS[sp] || "#888"} />)}
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Top 8 Brands — Year over Year</div>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={brandYoY}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="year" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} />
                    <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}} axisLine={false} tickFormatter={fmt} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend formatter={(v) => <span style={{color:"rgba(255,255,255,0.7)",fontSize:10}}>{v}</span>} />
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
              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginRight:8}}>SP:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",marginBottom:16}}>
              Comparing <strong style={{color:"#fff"}}>{selectedYear}</strong> vs <strong style={{color:"#fff"}}>{selectedYear-1}</strong>
              {" "} · scope: <strong style={{color:"#fff"}}>{selectedSP === "All" ? "all teams" : selectedSP}</strong>
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
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{col.list.length} customers</div>
                  </div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{col.valueLabel}</div>
                  <div style={{maxHeight:480,overflowY:"auto"}}>
                    {col.list.length === 0 && <div style={{color:"rgba(255,255,255,0.3)",fontSize:13,padding:"20px 0"}}>None</div>}
                    {col.list.slice(0, 50).map((c, i) => (
                      <div key={c.customer} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",fontSize:12}}>
                        <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginRight:8}}>{c.customer}</span>
                        <span style={{fontFamily:"'Space Mono',monospace",color:"rgba(255,255,255,0.7)"}}>{fmt(c[col.valueKey])}</span>
                      </div>
                    ))}
                    {col.list.length > 50 && <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",paddingTop:8}}>+ {col.list.length - 50} more</div>}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {tab === "heatmap" && (
          <>
            <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginRight:8}}>SP:</span>
              <Pill label="All Teams" active={selectedSP==="All"} onClick={()=>setSelectedSP("All")} />
              {SALESPEOPLE.map(sp => <Pill key={sp} label={sp} active={selectedSP===sp} onClick={()=>setSelectedSP(sp)} />)}
            </div>

            <Card>
              <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>Top 12 Customers × Top 12 Brands — {selectedYear}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginBottom:16}}>Cell intensity = revenue. Hover for exact values.</div>

              {heatmap.customers.length === 0 ? (
                <div style={{padding:"40px 0",textAlign:"center",color:"rgba(255,255,255,0.4)"}}>
                  No brand-level data for this scope.
                </div>
              ) : (
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"separate",borderSpacing:2,fontSize:11}}>
                    <thead>
                      <tr>
                        <th style={{padding:"6px 10px",textAlign:"left",color:"rgba(255,255,255,0.4)",fontWeight:500,minWidth:200}}>Customer ↓ / Brand →</th>
                        {heatmap.brands.map(b => (
                          <th key={b} style={{padding:"6px 4px",color:"rgba(255,255,255,0.6)",fontWeight:500,fontSize:10,minWidth:60,textAlign:"center"}}>
                            <div style={{transform:"rotate(-30deg)",transformOrigin:"left bottom",whiteSpace:"nowrap",height:60,marginTop:30}}>
                              {b}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatmap.customers.map((c, ci) => (
                        <tr key={c}>
                          <td style={{padding:"6px 10px",color:"rgba(255,255,255,0.85)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200}}>{c}</td>
                          {heatmap.brands.map((b, bi) => {
                            const v = heatmap.grid[ci][bi];
                            const intensity = heatmap.max > 0 ? v / heatmap.max : 0;
                            const bg = v === 0 ? "rgba(255,255,255,0.02)" : `rgba(232,99,59,${0.1 + intensity * 0.85})`;
                            return (
                              <td key={b} title={`${c} × ${b}: ${fmtFull(v)}`} style={{
                                padding:"6px 4px",background:bg,borderRadius:4,
                                textAlign:"center",fontFamily:"'Space Mono',monospace",fontSize:10,
                                color: intensity > 0.4 ? "#fff" : "rgba(255,255,255,0.5)",cursor:"default"
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
              )}
            </Card>
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

      <div style={{textAlign:"center",fontSize:11,color:"rgba(255,255,255,0.2)",padding:"40px 0 20px",fontFamily:"'Space Mono',monospace"}}>
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
  const dropRef = useRef(null);
  const inputRef = useRef(null);

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropRef.current) dropRef.current.style.borderColor = "rgba(255,255,255,0.1)";
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

  const applyResults = () => {
    if (!results?.parsed) return;
    const payload = {
      data: results.parsed,
      meta: {
        fileCount: selectedFiles.length,
        parsedAt: Date.now(),
        customerFiles: results.fileResults.filter(r => r.ok && r.kind === "customer").length,
        brandFiles: results.fileResults.filter(r => r.ok && r.kind === "brand").length,
      },
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      setError(`Saved to memory but localStorage failed (probably size limit): ${e.message}. Reload will revert to baked-in.`);
    }
    onApply(payload);
    setSelectedFiles([]);
    setResults(null);
  };

  const onResetClick = () => {
    if (!confirm("Discard uploaded data and revert to the baked-in dataset?")) return;
    localStorage.removeItem(STORAGE_KEY);
    onReset();
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
        <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginBottom:16,lineHeight:1.5}}>
          Drag <strong>.xlsx</strong> files matching the naming pattern:<br/>
          <code style={{fontFamily:"'Space Mono',monospace",color:"rgba(255,255,255,0.7)",fontSize:11}}>{"<SP> <YYYY> Sales Analysis by customer.xlsx"}</code> &nbsp;or&nbsp;
          <code style={{fontFamily:"'Space Mono',monospace",color:"rgba(255,255,255,0.7)",fontSize:11}}>{"<SP> <YYYY> Stock Sales Analysis - Summary by Brand.xlsx"}</code><br/>
          Uploads are parsed in your browser and saved to localStorage. They <strong>replace</strong> the baked-in dataset until you reset.
        </div>

        <div
          ref={dropRef}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (dropRef.current) dropRef.current.style.borderColor = "rgba(232,99,59,0.6)"; }}
          onDragLeave={() => { if (dropRef.current) dropRef.current.style.borderColor = "rgba(255,255,255,0.1)"; }}
          onDrop={onDrop}
          style={{
            border:"2px dashed rgba(255,255,255,0.1)",
            borderRadius:12,
            padding:"40px 20px",
            textAlign:"center",
            cursor:"pointer",
            transition:"all 0.2s",
            background:"rgba(255,255,255,0.01)"
          }}
        >
          <div style={{fontSize:28,marginBottom:8,opacity:0.4}}>⤴</div>
          <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Drop xlsx files here</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>or click to browse</div>
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
              <div style={{fontSize:12,color:"rgba(255,255,255,0.6)"}}>
                <strong style={{color:"#fff"}}>{selectedFiles.length}</strong> file{selectedFiles.length===1?"":"s"} selected
                {validNames.length !== selectedFiles.length && <span style={{color:"#F87171"}}> · {invalidNames.length} invalid name{invalidNames.length===1?"":"s"}</span>}
              </div>
              <button onClick={clearFiles} style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.4)",fontSize:11,cursor:"pointer",textDecoration:"underline"}}>clear</button>
            </div>
            <div style={{maxHeight:240,overflowY:"auto",border:"1px solid rgba(255,255,255,0.04)",borderRadius:8}}>
              {selectedFiles.map(f => {
                const info = parseFilename(f.name);
                return (
                  <div key={f.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                      <span style={{color: info ? "#34D399" : "#F87171",fontWeight:600,flexShrink:0}}>{info ? "✓" : "✗"}</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{f.name}</span>
                      {info && <span style={{color:"rgba(255,255,255,0.4)",fontSize:10,fontFamily:"'Space Mono',monospace",flexShrink:0}}>{info.sp} · {info.year} · {info.kind === "Sales Analysis by customer" ? "customer" : "brand"}</span>}
                    </div>
                    <button onClick={() => removeFile(f.name)} style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:14,padding:"0 0 0 8px"}}>✕</button>
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
              background: parsing || !validNames.length ? "rgba(255,255,255,0.05)" : "#E8633B",
              color: parsing || !validNames.length ? "rgba(255,255,255,0.3)" : "#fff",
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
          <div style={{marginTop:14,fontSize:12,color:"rgba(255,255,255,0.6)",fontFamily:"'Space Mono',monospace"}}>
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
            <div style={{display:"flex",gap:18,fontSize:12,color:"rgba(255,255,255,0.6)"}}>
              <span>✓ {okResults.length} ok</span>
              {errResults.length > 0 && <span style={{color:"#F87171"}}>✗ {errResults.length} failed</span>}
              <span>{totalCustomerRows.toLocaleString()} customer rows</span>
              <span>{totalBrandRows.toLocaleString()} brand rows</span>
            </div>
          </div>

          <div style={{maxHeight:300,overflowY:"auto",marginBottom:16,border:"1px solid rgba(255,255,255,0.04)",borderRadius:8}}>
            {results.fileResults.map(r => (
              <div key={r.file} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:12}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                  <span style={{color: r.ok ? "#34D399" : "#F87171",fontWeight:600}}>{r.ok ? "✓" : "✗"}</span>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{r.file}</span>
                </div>
                {r.ok ? (
                  <span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"rgba(255,255,255,0.5)"}}>{r.rowCount} rows · {r.kind}</span>
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
                background: okResults.length ? "#34D399" : "rgba(255,255,255,0.05)",
                color: okResults.length ? "#0A0A0F" : "rgba(255,255,255,0.3)",
                border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,
                cursor: okResults.length ? "pointer" : "not-allowed"
              }}>
              Apply &amp; replace dashboard data
            </button>
            <button onClick={() => setResults(null)} style={{
              background:"transparent",color:"rgba(255,255,255,0.5)",border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:8,padding:"10px 22px",fontSize:13,cursor:"pointer"
            }}>Discard</button>
          </div>
        </Card>
      )}
    </>
  );
}
