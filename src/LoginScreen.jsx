import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";
// Sign-in follows the same saved/system light-dark mode as the dashboard.
import { resolveScreenTheme } from "./lib/theme.js";

// LoginScreen handles three phases:
//   * "signin"  – standard email + password form
//   * "forgot"  – enter email, receive Supabase reset link
//   * "reset"   – after clicking the reset link, set a new password
// Also handles admin fallback: if the URL has ?admin_reset=1 the form shows
// a note explaining that the site admin sent them here.
export default function LoginScreen() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  // Detect Supabase's password-recovery redirect. When the user clicks the
  // email link, Supabase sends them back with type=recovery in the URL hash
  // and immediately establishes a temporary session — enough to call
  // supabase.auth.updateUser({ password }) once.
  useEffect(() => {
    const hash = window.location.hash || "";
    if (hash.includes("type=recovery")) {
      setMode("reset");
      // Clean the fragment so a refresh doesn't re-trigger reset mode.
      history.replaceState(null, "", window.location.pathname + window.location.search);
      setInfo("You clicked a reset link. Set a new password below.");
    }
  }, []);

  const signIn = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(prettyError(error.message));
    setBusy(false);
  };

  const sendReset = async (e) => {
    e.preventDefault();
    if (!email) return setError("Enter the email you sign in with.");
    setBusy(true); setError(null); setInfo(null);
    // Send the user back to the site's own URL so the recovery link opens on
    // the same origin. Supabase re-attaches the type=recovery fragment.
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) setError(prettyError(error.message));
    else setInfo(`Reset link sent to ${email}. Check your inbox (and spam) — the link opens back here.`);
    setBusy(false);
  };

  const applyReset = async (e) => {
    e.preventDefault();
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(prettyError(error.message));
      setBusy(false);
      return;
    }
    setInfo("Password updated. Signing you in…");
    // The recovery session is a full session, so App.jsx will already pick
    // up the auth state and route to the dashboard on the next render.
    // Nothing else to do here besides flip the UI back to a clean state.
    setPassword(""); setConfirm("");
    setBusy(false);
  };

  const t = resolveScreenTheme();

  return (
    <div style={{
      minHeight: "100vh", background: t.bg, color: t.ink,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans',sans-serif",
      backgroundImage: "linear-gradient(135deg, rgba(232,99,59,0.05) 0%, rgba(59,130,246,0.04) 100%)",
    }}>
      <div style={{
        background: t.cardBg, border: `1px solid ${t.cardBorder}`,
        borderRadius: 16, padding: "40px 36px", width: "100%", maxWidth: 380,
        boxShadow: t.shadow
      }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: t.eyebrow, marginBottom: 8 }}>SEED Malaysia</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px 0", letterSpacing: -0.3 }}>
          {mode === "signin" ? "Sales Dashboard" : mode === "forgot" ? "Reset password" : "Set a new password"}
        </h1>
        <div style={{ fontSize: 13, color: t.sub, marginBottom: 24 }}>
          {mode === "signin" && "Sign in to view your performance"}
          {mode === "forgot" && "We'll email you a link to set a new password."}
          {mode === "reset"  && "Pick a password you'll remember."}
        </div>

        {mode === "signin" && (
          <form onSubmit={signIn}>
            <Field t={t} label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus />
            <Field t={t} label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
            <FormMsg t={t} error={error} info={info} />
            <PrimaryButton t={t} busy={busy} label="Sign In" busyLabel="Signing in…" />
            <SecondaryLink t={t} onClick={() => { setMode("forgot"); setError(null); setInfo(null); }}>
              Forgot password?
            </SecondaryLink>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={sendReset}>
            <Field t={t} label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus />
            <FormMsg t={t} error={error} info={info} />
            <PrimaryButton t={t} busy={busy} label="Send reset link" busyLabel="Sending…" />
            <SecondaryLink t={t} onClick={() => { setMode("signin"); setError(null); setInfo(null); }}>
              ← Back to sign in
            </SecondaryLink>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={applyReset}>
            <Field t={t} label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
            <Field t={t} label="Confirm new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            <FormMsg t={t} error={error} info={info} />
            <PrimaryButton t={t} busy={busy} label="Update password" busyLabel="Updating…" />
          </form>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Small presentational primitives kept in-file to keep LoginScreen
// self-contained.
// ============================================================
function Field({ t, label, type, value, onChange, autoComplete, autoFocus }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: t.label, marginBottom: 6 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        style={{
          width: "100%", boxSizing: "border-box", padding: "10px 14px",
          background: t.inputBg, border: `1px solid ${t.inputBorder}`,
          color: t.ink, borderRadius: 8, fontSize: 14, outline: "none",
          fontFamily: "'DM Sans',sans-serif",
        }}
      />
    </div>
  );
}

function FormMsg({ t, error, info }) {
  if (!error && !info) return null;
  const color = error ? t.bad : t.ok;
  const bg    = error ? "rgba(248,113,113,0.10)" : "rgba(52,211,153,0.10)";
  const border= error ? "rgba(248,113,113,0.25)" : "rgba(52,211,153,0.25)";
  return (
    <div style={{
      padding: "10px 12px", marginBottom: 14,
      background: bg, border: `1px solid ${border}`,
      borderRadius: 8, fontSize: 12, color, lineHeight: 1.5,
    }}>
      {error || info}
    </div>
  );
}

function PrimaryButton({ t, busy, label, busyLabel }) {
  return (
    <button type="submit" disabled={busy} style={{
      width: "100%", padding: "12px", fontSize: 14, fontWeight: 600,
      background: busy ? t.accentDisabled : t.accent, color: "#fff",
      border: "none", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer",
      fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.3,
    }}>
      {busy ? busyLabel : label}
    </button>
  );
}

function SecondaryLink({ t, onClick, children }) {
  return (
    <div style={{ marginTop: 18, fontSize: 12, textAlign: "center" }}>
      <button type="button" onClick={onClick} style={{
        background: "transparent", border: "none", color: t.link,
        cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans',sans-serif",
        textDecoration: "underline",
      }}>
        {children}
      </button>
    </div>
  );
}

// Supabase's raw auth messages read like DBMS output — soften a couple of
// common ones so the user doesn't have to look up "AuthApiError".
function prettyError(msg) {
  if (!msg) return "Something went wrong. Try again.";
  const lower = msg.toLowerCase();
  if (lower.includes("invalid login credentials"))
    return "That email + password combination isn't valid. Try again, or use Forgot password.";
  if (lower.includes("email not confirmed"))
    return "Your email hasn't been confirmed yet. Ask your admin to confirm it in Supabase.";
  if (lower.includes("email rate limit"))
    return "Too many attempts — please wait a minute before requesting another reset link.";
  if (lower.includes("user not found"))
    return "No account exists for that email. Contact your admin to be invited.";
  return msg;
}
