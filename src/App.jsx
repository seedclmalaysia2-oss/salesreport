import { useEffect, useState } from "react";
import { supabase, fetchAll, aggregateFromRaw } from "./lib/supabase.js";
import LoginScreen from "./LoginScreen.jsx";
import Dashboard from "./Dashboard.jsx";
import bakedData from "./data.json";

const supabaseConfigured = !!(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

function FullScreenMessage({ title, detail, accent = "#E8633B", children }) {
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
      {children}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [staleData, setStaleData] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured) {
      setSessionLoaded(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    }).catch(() => {
      // Auth unreachable. Stay on the login screen rather than letting anyone
      // in — an outage must never widen access.
      setSessionLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (!sess) {
        setUser(null);
        setData(null);
        setProfileError(null);
      }
    });
    return () => sub.subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;

    (async () => {
      setProfileError(null);

      // Role first, and on its own. If this read fails we must not guess —
      // an unknown role is treated as "no access", never as admin.
      let profile;
      try {
        const { data: row, error } = await supabase
          .from("sp_user_map")
          .select("sp,is_admin,managed_sps,can_view_all")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (error) throw error;
        profile = row;
      } catch (e) {
        setProfileError(
          "Could not verify your account permissions. Please try again — " +
          "if this persists, contact your admin. " + (e.message || e)
        );
        return;
      }

      if (!profile) {
        setProfileError(
          `${session.user.email} is signed in but is not mapped to a salesperson yet, ` +
          "so there is no data to show. Ask your admin to add you in the Users panel."
        );
        return;
      }

      setUser({
        email: session.user.email,
        sp: profile.sp,
        isAdmin: !!profile.is_admin,
        // Admins always see all; everyone else sees all unless an admin has
        // restricted them (can_view_all = false).
        canViewAll: !!profile.is_admin || !!profile.can_view_all,
        managedSps: profile.managed_sps || [],
      });

      // Data second. RLS already limits these reads to this user's scope, so
      // whatever comes back is what they are allowed to see.
      try {
        const [customers, brandSales, targets, weekly] = await Promise.all([
          fetchAll("customers_data", "sp,year,customer,months,total"),
          fetchAll("brand_sales_data", "sp,year,customer,brand,amt,qty"),
          fetchAll("sales_targets", "year,month,sp,target_amt"),
          fetchAll("weekly_sales", "period_start,period_end,sp,amount,uploaded_at"),
        ]);
        const aggregated = aggregateFromRaw(customers, brandSales);
        aggregated.targets = targets.map(t => ({
          year: t.year, month: t.month, sp: t.sp, target: Number(t.target_amt),
        }));
        aggregated.weeklySales = weekly.map(w => ({
          periodStart: w.period_start, periodEnd: w.period_end,
          sp: w.sp, amount: Number(w.amount), uploadedAt: w.uploaded_at,
        }));
        setData(aggregated);
        setStaleData(false);
      } catch (e) {
        // Showing the baked-in snapshot to an already-authenticated user is a
        // display fallback, not an access decision — their role stays as read.
        console.warn("Live tables unreachable, falling back to baked-in snapshot:", e);
        setData(bakedData);
        setStaleData(true);
      }
    })();
  }, [session, refreshTick]);

  if (!supabaseConfigured) {
    return (
      <FullScreenMessage
        title="Not configured"
        detail="VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing. Copy .env.example to .env and fill them in, then restart the dev server."
      />
    );
  }

  if (!sessionLoaded) return <FullScreenMessage title="Loading…" />;

  if (!session) return <LoginScreen />;

  if (profileError) {
    return (
      <FullScreenMessage title="Account not ready" detail={profileError} accent="#F59E0B">
        <button onClick={() => supabase.auth.signOut()} style={{
          marginTop: 20, padding: "8px 18px", fontSize: 13, fontWeight: 600,
          background: "transparent", border: "1px solid rgba(255,255,255,0.2)",
          color: "rgba(255,255,255,0.7)", borderRadius: 8, cursor: "pointer",
          fontFamily: "'DM Sans',sans-serif",
        }}>Sign out</button>
      </FullScreenMessage>
    );
  }

  if (!data || !user) return <FullScreenMessage title="Loading your dashboard…" />;

  return (
    <>
      {staleData && (
        <div style={{
          position:"sticky",top:0,zIndex:50,
          background:"rgba(245,158,11,0.12)",borderBottom:"1px solid rgba(245,158,11,0.3)",
          color:"#F59E0B",padding:"8px 20px",fontSize:12,fontFamily:"'DM Sans',sans-serif",
          display:"flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap",textAlign:"center"
        }}>
          <span>⚠ Live data backend is unreachable — showing the baked-in snapshot, which may be out of date.</span>
          <button onClick={() => setRefreshTick(t => t + 1)} style={{
            background:"transparent",border:"1px solid rgba(245,158,11,0.4)",color:"#F59E0B",
            borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer"
          }}>Retry</button>
        </div>
      )}
      <Dashboard
        data={data}
        user={user}
        onLogout={() => supabase.auth.signOut()}
        onRefresh={() => setRefreshTick(t => t + 1)}
      />
    </>
  );
}
