import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig({
  plugins: [react(), sentryVitePlugin({ org: 'f1cardvault', project: 'f1cardvault', authToken: process.env.SENTRY_AUTH_TOKEN })],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Only force-split react itself. Letting Rollup auto-chunk the rest
        // means recharts goes only into the chunks that actually import it
        // (Drivers, GradedTracker, AffiliateROI, Indices) — not preloaded
        // on /bin, /sales, etc. The previous 'charts' manualChunk was 548KB
        // and got modulepreloaded everywhere via <link rel="modulepreload">,
        // and on slow networks would race React's hydration → React error
        // #426 (Suspense interrupted). Removing the manual split fixes that
        // AND reduces total transfer on chart-free pages.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        }
      }
    }
  }
})
