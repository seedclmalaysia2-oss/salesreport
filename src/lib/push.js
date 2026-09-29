// Web Push opt-in for the current user.
//
// A rep enables alerts once (grants notification permission + subscribes), and
// the subscription is stored in public.push_subscriptions keyed to their auth
// user. The serverless sender (api/send-push.js) reads those rows and pushes to
// each endpoint. Everything here is best-effort and fails soft: no VAPID key,
// no support, or a denied permission just leaves alerts off.

import { supabase } from "./supabase.js";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

// Configured only when the build has the public key AND the browser can do push.
export function pushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY);
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// iOS only delivers Web Push when the site is installed to the home screen.
// This detects "running as an installed app" so the UI can tell an iPhone user
// to install first rather than showing a button that silently won't work.
export function isStandalone() {
  return (
    (typeof window !== "undefined" &&
      window.matchMedia?.("(display-mode: standalone)").matches) ||
    window.navigator?.standalone === true
  );
}
export function isIOS() {
  return typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function readyRegistration() {
  // main.jsx registers /sw.js on load; wait for it to be controlling.
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

// One of: "unsupported" | "unconfigured" | "needs-install" (iOS, not installed)
//       | "denied" | "default" (can ask) | "enabled" (subscribed) | "off"
export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  if (!pushConfigured()) return "unconfigured";
  if (isIOS() && !isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) return "enabled";
  } catch { /* fall through */ }
  return Notification.permission === "granted" ? "off" : "default";
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser can't do push notifications.");
  if (!pushConfigured()) throw new Error("Push isn't configured yet (missing VAPID key).");
  if (isIOS() && !isStandalone()) {
    throw new Error("On iPhone, first add this site to your Home Screen (Share → Add to Home Screen), open it from there, then enable alerts.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked. Allow them for this site in your browser settings, then try again."
      : "Notification permission wasn't granted.");
  }

  const reg = await readyRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new Error("You're not signed in.");

  const json = sub.toJSON();
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: uid,
        endpoint: sub.endpoint,
        subscription: json,
        user_agent: navigator.userAgent.slice(0, 300),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );
  if (error) throw new Error(`Couldn't save your subscription: ${error.message}`);
  return true;
}

// Admin action: fan the given text out to every subscribed device via the
// serverless sender. Authorised by the caller's Supabase JWT (the function
// checks is_admin server-side). Returns the send counts.
export async function sendWeeklyPush({ title, body, url = "/" }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("You're not signed in.");
  const res = await fetch("/api/send-push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, body, url }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Send failed (${res.status}).`);
  return json;
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) {
    throw new Error(`Couldn't turn off alerts: ${e.message || e}`);
  }
  return true;
}
