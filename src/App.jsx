import { useEffect, useState } from "react";
import { supabase, fetchAll, aggregateFromRaw } from "./lib/supabase.js";
import LoginScreen from "./LoginScreen.jsx";
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
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!supabaseConfigured) {
      // Local dev without Supabase env: skip auth, use baked data.
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

  useEffect(() => {
    if (!supabaseConfigured) return;
    if (!session) {
      setData(null);
      setUser(null);
      setError(null);
      return;
    }
    (async () => {
      try {
        setError(null);
        const [customers, brandSales, mapRow] = await Promise.all([
          fetchAll("customers_data", "sp,year,customer,months,total"),
          fetchAll("brand_sales_data", "sp,year,customer,brand,amt"),
          supabase.from("sp_user_map").select("*")
            .eq("user_id", session.user.id).maybeSingle(),
        ]);
        setData(aggregateFromRaw(customers, brandSales));
        setUser({
          email: session.user.email,
          sp: mapRow.data?.sp || "(unmapped)",
          isAdmin: !!mapRow.data?.is_admin,
        });
      } catch (e) {
        setError(e.message || String(e));
      }
    })();
  }, [session]);

  if (!sessionLoaded) {
    return <FullScreenMessage title="Loading…" />;
  }

  if (!supabaseConfigured) {
    // No env vars — fallback to baked-in data without auth (local dev).
    return <Dashboard data={bakedData} user={null} onLogout={null} />;
  }

  if (!session) return <LoginScreen />;

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
      onLogout={() => supabase.auth.signOut()}
    />
  );
}
