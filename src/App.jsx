import { useEffect, useState } from "react";
import { supabase, fetchAll, aggregateFromRaw } from "./lib/supabase.js";
import Dashboard from "./Dashboard.jsx";
import bakedData from "./data.json";

const supabaseConfigured = !!(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

function FullScreenMessage({ title, detail, accent = "#E8633B" }) {
  return (
    <div style={{
      minHeight: "100vh", background: "#0A0A0F", color: "#fff",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans',sans-serif", textAlign: "center", padding: 24,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>SEED Malaysia</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 12px 0", color: accent }}>{title}</h1>
      {detail && <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", maxWidth: 480, lineHeight: 1.6 }}>{detail}</div>}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [backendDown, setBackendDown] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured) {
      setData(bakedData);
      return;
    }
    (async () => {
      try {
        const [customers, brandSales, targets, weekly] = await Promise.all([
          fetchAll("customers_data", "sp,year,customer,months,total"),
          fetchAll("brand_sales_data", "sp,year,customer,brand,amt,qty"),
          fetchAll("sales_targets", "year,month,sp,target_amt"),
          fetchAll("weekly_sales", "period_start,period_end,sp,amount,uploaded_at"),
        ]);
        const aggregated = aggregateFromRaw(customers, brandSales);
        aggregated.targets = targets.map(t => ({
          year: t.year,
          month: t.month,
          sp: t.sp,
          target: Number(t.target_amt),
        }));
        aggregated.weeklySales = weekly.map(w => ({
          periodStart: w.period_start,
          periodEnd: w.period_end,
          sp: w.sp,
          amount: Number(w.amount),
          uploadedAt: w.uploaded_at,
        }));
        setData(aggregated);
        setBackendDown(false);
      } catch (e) {
        console.warn("Live backend unreachable, falling back to baked-in snapshot:", e);
        setData(bakedData);
        setBackendDown(true);
      }
    })();
  }, [refreshTick]);

  if (!data) return <FullScreenMessage title="Loading your dashboard…" />;

  return (
    <>
      {backendDown && (
        <div style={{
          position:"sticky",top:0,zIndex:50,
          background:"rgba(245,158,11,0.12)",borderBottom:"1px solid rgba(245,158,11,0.3)",
          color:"#F59E0B",padding:"8px 20px",fontSize:12,fontFamily:"'DM Sans',sans-serif",
          display:"flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap",textAlign:"center"
        }}>
          <span>⚠ Live data backend is unreachable — showing baked-in snapshot. Upload your own xlsx files from the <strong>Data ⤴</strong> tab to override.</span>
          <button onClick={() => setRefreshTick(t => t + 1)} style={{
            background:"transparent",border:"1px solid rgba(245,158,11,0.4)",color:"#F59E0B",
            borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer"
          }}>Retry</button>
        </div>
      )}
      <Dashboard data={data} onRefresh={() => setRefreshTick(t => t + 1)} />
    </>
  );
}
