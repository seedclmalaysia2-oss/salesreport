import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { reloadForNewBuild, watchForNewBuild } from './lib/staleChunk.js';

// A lazy chunk from an older deploy is gone → load the new build instead of erroring.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewBuild()) e.preventDefault();
});
// An open tab / Home-Screen app picks up new deploys without a manual reload.
watchForNewBuild();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the push service worker. It only handles notifications (no fetch
// caching), so it can't ship a stale build. Registered after load so it never
// competes with first paint. Silently no-ops where unsupported.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
