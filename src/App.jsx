import { useEffect, useState } from "react";
import { supabase, fetchAll, aggregateFromRaw } from "./lib/supabase.js";
import LoginScreen from "./LoginScreen.jsx";
import Dashboard from "./Dashboard.jsx";
// data.json is a ~2.5 MB offline fallback. Importing it statically compiled the
// whole dataset into the JS bundle, so every visitor downloaded it before the
// app could start — and then we fetch the live data from Supabase anyway. Load
// it only on the path that actually needs it.
const loadBakedData = () => import("./data.json").then(m => m.default);

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
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>SEED Malaysia</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 12px 0", color: accent }}>{title}</h1>
      {detail && <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", maxWidth: 480, lineHeight: 1.6 }}>{detail}</div>}
      {children}
    </div>
  );
}

// Branded loading screen. Shows which stage we're in plus an elapsed counter,
// so a slow network reads as "still working" rather than "frozen". After a
// while it says so explicitly instead of leaving the user guessing.
function LoadingScreen({ stage }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      minHeight: "100vh", background: "#0A0A0F", color: "#fff",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans',sans-serif", textAlign: "center", padding: 24,
    }}>
      <style>{`
        @keyframes seedspin { to { transform: rotate(360deg); } }
        @keyframes seedpulse { 0%,100% { opacity:.35 } 50% { opacity:1 } }
        @keyframes seedbar { 0% { left:-40% } 100% { left:100% } }
      `}</style>

      <div style={{
        width: 54, height: 54, borderRadius: "50%", marginBottom: 22,
        border: "3px solid rgba(232,99,59,0.15)", borderTopColor: "#E8633B",
        animation: "seedspin 0.9s linear infinite",
      }} />

      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "rgba(255,255,255,0.35)", marginBottom: 6 }}>
        SEED Malaysia
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Sales Dashboard</div>

      <div style={{
        position: "relative", width: "min(280px, 80vw)", height: 4, borderRadius: 2,
        background: "rgba(255,255,255,0.07)", overflow: "hidden", marginBottom: 14,
      }}>
        <div style={{
          position: "absolute", top: 0, height: "100%", width: "40%", borderRadius: 2,
          background: "linear-gradient(90deg,transparent,#E8633B,transparent)",
          animation: "seedbar 1.2s ease-in-out infinite",
        }} />
      </div>

      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", animation: "seedpulse 1.8s ease-in-out infinite" }}>
        {stage}
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 8, fontFamily: "'Space Mono',monospace" }}>
        {elapsed}s
      </div>
      {elapsed >= 8 && (
        <div style={{ fontSize: 11, color: "rgba(245,158,11,0.75)", marginTop: 12, maxWidth: 320, lineHeight: 1.6 }}>
          Still working — a slow connection can make the first load take a little longer.
        </div>
      )}
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
  const [loadStage, setLoadStage] = useState("Starting…");
  const [brandsLoading, setBrandsLoading] = useState(false);

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
      setLoadStage("Verifying your access…");

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
      //
      // brand_sales_data is ~24k rows = ~25 paginated requests, an order of
      // magnitude more than everything else combined, and nothing on the
      // landing tab needs it. Render on the small tables first, then fold the
      // brand rows in when they arrive — the charts that use them recompute on
      // the new object.
      try {
        setLoadStage("Loading sales data…");
        // invoiceFiles: metadata only (no rows_json) so the Weekly Sales card
        // can show which archived files feed the current view. RLS on
        // data_files returns empty for non-admins, so the extra fetch is a
        // no-op for them — no server-side gate needed here.
        const [customers, targets, weekly, invoiceFiles] = await Promise.all([
          fetchAll("customers_data", "sp,year,customer,months,total"),
          fetchAll("sales_targets", "year,month,sp,target_amt"),
          fetchAll("weekly_sales", "period_start,period_end,sp,amount,uploaded_at"),
          fetchAll("data_files", "id,name,kind,uploaded_at,deleted_at")
            .then(rows => rows.filter(r => r.kind === "invoice" && !r.deleted_at))
            .catch(() => []),
        ]);

        const withTotals = (brandSales) => {
          const aggregated = aggregateFromRaw(customers, brandSales);
          aggregated.targets = targets.map(t => ({
            year: t.year, month: t.month, sp: t.sp, target: Number(t.target_amt),
          }));
          aggregated.weeklySales = weekly.map(w => ({
            periodStart: w.period_start, periodEnd: w.period_end,
            sp: w.sp, amount: Number(w.amount), uploadedAt: w.uploaded_at,
          }));
          aggregated.invoiceFiles = invoiceFiles.map(f => ({
            id: f.id,
            name: f.name,
            uploadedAt: f.uploaded_at ? new Date(f.uploaded_at).getTime() : null,
          }));
          return aggregated;
        };

        setData(withTotals([]));       // dashboard is usable from here
        setStaleData(false);
        setBrandsLoading(true);

        fetchAll("brand_sales_data", "sp,year,customer,brand,amt,qty")
          .then(brandSales => { setData(withTotals(brandSales)); })
          .catch(e => { console.warn("Brand rows unavailable:", e); })
          .finally(() => setBrandsLoading(false));
      } catch (e) {
        // Showing the baked-in snapshot to an already-authenticated user is a
        // display fallback, not an access decision — their role stays as read.
        console.warn("Live tables unreachable, falling back to baked-in snapshot:", e);
        setLoadStage("Loading offline snapshot…");
        try {
          setData(await loadBakedData());
          setStaleData(true);
        } catch (err) {
          setProfileError(`Could not load any data: ${err.message || err}`);
        }
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

  if (!sessionLoaded) return <LoadingScreen stage="Checking your session…" />;

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

  if (!data || !user) return <LoadingScreen stage={loadStage} />;

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
        brandsLoading={brandsLoading}
        onLogout={() => supabase.auth.signOut()}
        onRefresh={() => setRefreshTick(t => t + 1)}
      />
    </>
  );
}
