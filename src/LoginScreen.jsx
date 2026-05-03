import { useState } from "react";
import { supabase } from "./lib/supabase.js";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0A0A0F", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans',sans-serif",
      backgroundImage: "linear-gradient(135deg, rgba(232,99,59,0.05) 0%, rgba(59,130,246,0.04) 100%)",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{
        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 16, padding: "40px 36px", width: "100%", maxWidth: 380,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
      }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>SEED Malaysia</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px 0", letterSpacing: -0.3 }}>Sales Dashboard</h1>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 28 }}>Sign in to view your performance</div>

        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" required autoFocus
              style={{
                width: "100%", boxSizing: "border-box", padding: "10px 14px",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                color: "#fff", borderRadius: 8, fontSize: 14, outline: "none",
                fontFamily: "'DM Sans',sans-serif"
              }}
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" required
              style={{
                width: "100%", boxSizing: "border-box", padding: "10px 14px",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                color: "#fff", borderRadius: 8, fontSize: 14, outline: "none",
                fontFamily: "'DM Sans',sans-serif"
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: "10px 12px", marginBottom: 14,
              background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: 8, fontSize: 12, color: "#F87171"
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} style={{
            width: "100%", padding: "12px", fontSize: 14, fontWeight: 600,
            background: busy ? "rgba(232,99,59,0.5)" : "#E8633B", color: "#fff",
            border: "none", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer",
            fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.3
          }}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 22, fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "center" }}>
          Forgot password? Contact your admin to reset.
        </div>
      </div>
    </div>
  );
}
