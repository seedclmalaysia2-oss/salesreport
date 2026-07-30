import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 5173, strictPort: false },
  // Vitest. Runs in the Node environment because the units under test are pure
  // data logic (weekly bucketing, dedupe, fact-table sync) with Supabase mocked
  // — no DOM needed. `npm test` runs once; `npm run test:watch` re-runs on save.
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
  build: {
    rollupOptions: {
      output: {
        // xlsx is only reachable through a dynamic import (admin uploads), but
        // Rollup still folded it into the entry chunk on the CI build — it is
        // CommonJS, and the interop wrapper defeats the automatic split. Naming
        // the chunk forces it out, so a normal user never downloads the ~140 KB
        // (gzip) parser. Charts are split for caching: they are needed on first
        // paint, but they change far less often than app code.
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'xlsx';
          if (id.includes('node_modules/recharts') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-vendor')) return 'charts';
          if (id.includes('node_modules/@supabase')) return 'supabase';
        },
      },
    },
    // The remaining chunks are deliberately sized; the default 500 KB warning
    // just adds noise to every build log.
    chunkSizeWarningLimit: 900,
  },
});
