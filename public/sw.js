/* Service worker — Web Push only.
 *
 * Deliberately minimal: it does NOT cache or intercept fetches (the app is not
 * offline-first, and a stale-cache SW is a classic way to ship a broken build).
 * Its one job is to receive push messages and open the dashboard on tap.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "SEED Weekly Sales";
  const options = {
    body: data.body || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    // Same tag so a re-send replaces the previous alert instead of stacking.
    tag: data.tag || "seed-weekly-sales",
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Focus an already-open dashboard tab if there is one; else open a new one.
      for (const w of wins) {
        try {
          if (new URL(w.url).origin === self.location.origin && "focus" in w) return w.focus();
        } catch { /* ignore malformed client url */ }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
