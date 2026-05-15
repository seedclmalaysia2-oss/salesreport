import { useEffect, useState } from "react";
import { supabase, fetchAll, aggregateFromRaw } from "./lib/supabase.js";
import LoginScreen from "./LoginScreen.jsx";
import Dashboard from "./Dashboard.jsx";
import bakedData from "./data.json";

const supabaseConfigured = !!(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

// TEMPORARY: when false, the dashboard runs without auth. Re-enable when
// the mid-update period is over (and re-enable RLS via 0006_reenable_auth.sql).
const AUTH_ENABLED = false;

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
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!supabaseConfigured) {
      setSessionLoaded(true);
      return;
    }
    if (!AUTH_ENABLED) {
      // Login disabled — mark loaded so the fetch effect runs without a session.
      setSessionLoaded(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => sub.subscription?.unsubscribe();
  }, []);

  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured) return;
    if (AUTH_ENABLED && !session) {
      setData(null);
      setUser(null);
      setError(null);
      return;
    }
    (async () => {
      try {
        setError(null);
        const fetches = [
          fetchAll("customers_data", "sp,year,customer,months,total"),
          fetchAll("brand_sales_data", "sp,year,customer,brand,amt,qty"),
          fetchAll("sales_targets", "year,month,sp,target_amt"),
          fetchAll("weekly_sales", "period_start,period_end,sp,amount,uploaded_at"),
        ];
        if (AUTH_ENABLED) {
          fetches.push(
            supabase.from("sp_user_map").select("*")
              .eq("user_id", session.user.id).maybeSingle()
          );
        }
        const results = await Promise.all(fetches);
        const [customers, brandSales, targets, weekly, mapRow] = results;
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

        if (AUTH_ENABLED) {
          setUser({
            email: session.user.email,
            sp: mapRow.data?.sp || "(unmapped)",
            isAdmin: !!mapRow.data?.is_admin,
          });
        } else {
          // Open access — show everything as admin would. No logout button.
          setUser({ email: "", sp: "Open access", isAdmin: true });
        }
      } catch (e) {
        setError(e.message || String(e));
      }
    })();
  }, [session, refreshTick]);

  if (!sessionLoaded) {
    return <FullScreenMessage title="Loading…" />;
  }

  if (!supabaseConfigured) {
    // No env vars — fallback to baked-in data without auth (local dev).
    return <Dashboard data={bakedData} user={null} onLogout={null} />;
  }

  if (AUTH_ENABLED && !session) return <LoginScreen />;

  if (error) {
    return (
      <FullScreenMessage
        title="Couldn't load data"
        detail={error + " — sign out and try again, or check that your account has been mapped to a salesperson in sp_user_map."}
        accent="#F87171"
      />
    );
  }

  if (!data) return <FullScreenMessage title="Loading your dashboard…" />;

  return (
    <Dashboard
      data={data}
      user={user}
      onLogout={AUTH_ENABLED ? () => supabase.auth.signOut() : null}
      onRefresh={() => setRefreshTick(t => t + 1)}
    />
  );
}
