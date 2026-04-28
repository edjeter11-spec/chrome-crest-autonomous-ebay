import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerSW } from './lib/push'

// Lazy-load Sentry SDK ONLY when a DSN is present. Was eagerly imported
// (~80KB gzipped including Replay integration) on every page load even
// when DSN was unset. Now: zero cost on the critical path until error
// monitoring is actually configured.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
const ENVIRONMENT = import.meta.env.MODE || 'development'

if (SENTRY_DSN) {
  import('@sentry/react').then(Sentry => {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: ENVIRONMENT,
      release: import.meta.env.VITE_APP_VERSION || 'unknown',
      integrations: [
        new Sentry.Replay({ maskAllText: false, blockAllMedia: false }),
      ],
      tracesSampleRate: ENVIRONMENT === 'production' ? 0.1 : 1.0,
      replaysSessionSampleRate: ENVIRONMENT === 'production' ? 0.1 : 1.0,
      replaysOnErrorSampleRate: 1.0,
    })
  }).catch(() => {})
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register service worker (for push notifications)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { registerSW() })
}
