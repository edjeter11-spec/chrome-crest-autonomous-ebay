# Sentry Error Monitoring Setup

This project uses **Sentry** for production error monitoring on both frontend and backend.

## What's Configured

### Frontend (React + Vite)
- **Package**: `@sentry/react` + `@sentry/vite-plugin`
- **Entry**: `frontend/src/main.jsx`
- **Integrations**:
  - Sentry React Error Boundary (catches React component errors)
  - Session Replay (records user interactions leading up to errors)
  - Performance monitoring (10% sample rate in production)

### Backend (FastAPI)
- **Package**: `sentry-sdk`
- **Entry**: `backend/main.py` (initialized before other imports)
- **Integrations**:
  - FastAPI integration (auto-captures HTTP errors)
  - SQLAlchemy integration (captures DB errors)
  - Exception handler hook (all unhandled exceptions captured)

## Setup Instructions

### 1. Create Sentry Account & Project

1. Go to https://sentry.io and sign up (free tier available)
2. Create a new organization (or use existing)
3. Create two projects:
   - **Frontend Project**: "f1cardvault-frontend" (framework: React)
   - **Backend Project**: "f1cardvault-backend" (framework: FastAPI)

### 2. Get DSN Keys

Each project has a **Data Source Name (DSN)** that looks like:
```
https://examplePublicKey@o0.ingest.sentry.io/0
```

Copy both frontend and backend DSNs.

### 3. Local Development Setup

Create or update `.env` in root directory:

```bash
# Frontend Sentry
VITE_SENTRY_DSN=https://YOUR_FRONTEND_DSN

# Backend Sentry
SENTRY_DSN=https://YOUR_BACKEND_DSN
ENVIRONMENT=development
APP_VERSION=1.0.0
SENTRY_AUTH_TOKEN=YOUR_SENTRY_AUTH_TOKEN  # optional, for source maps upload
```

Create `frontend/.env`:
```bash
VITE_SENTRY_DSN=https://YOUR_FRONTEND_DSN
VITE_APP_VERSION=1.0.0
```

### 4. Production Setup (Vercel)

1. Go to **Vercel Dashboard** → Project Settings → **Environment Variables**
2. Add for both production and preview:
   ```
   SENTRY_DSN=https://YOUR_BACKEND_DSN
   ENVIRONMENT=production
   APP_VERSION=1.0.0
   ```
3. Add frontend env var to **Build & Development Settings**:
   ```
   VITE_SENTRY_DSN=https://YOUR_FRONTEND_DSN
   VITE_APP_VERSION=1.0.0
   ```
4. Redeploy project

### 5. Test Error Monitoring

#### Backend Test

```bash
curl http://localhost:8000/api/test-error
```

Visit **Sentry Dashboard** → Backend Project → Issues. You should see a test error.

#### Frontend Test

Open browser console and run:
```javascript
throw new Error("Frontend test error for Sentry")
```

Or trigger via React component error during development.

## Monitoring & Alerts

### View Errors in Sentry Dashboard

1. **Issues** tab shows all errors with:
   - Error message & stack trace
   - Environment (production/staging/development)
   - Release version
   - Affected users
   - Session replay (what the user was doing)

2. **Alerts** tab lets you set up notifications:
   - Slack webhook (recommended)
   - Email digests
   - Custom alert rules

### Recommended Alert Rules

1. **Critical Errors**: Alert immediately on new production errors
2. **Error Spike**: Alert if error count exceeds threshold
3. **Release Health**: Track crash-free sessions

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `SENTRY_DSN` | Backend error capture | `https://key@o0.ingest.sentry.io/123456` |
| `ENVIRONMENT` | App environment | `production` / `staging` / `development` |
| `APP_VERSION` | Release version | `1.0.0` |
| `VITE_SENTRY_DSN` | Frontend error capture | `https://key@o0.ingest.sentry.io/654321` |
| `VITE_APP_VERSION` | Frontend release | `1.0.0` |
| `SENTRY_AUTH_TOKEN` | Auth for source map upload | (optional) |

## Performance Tuning

### Trace Sample Rate

Currently set to:
- **Production**: 10% (free tier friendly, captures ~1/10 requests)
- **Development**: 100% (all requests sampled)

To adjust, edit:
- **Backend**: `backend/main.py` - `traces_sample_rate`
- **Frontend**: `frontend/src/main.jsx` - `tracesSampleRate`

### Session Replay Sample Rate

- **Production**: 10% of sessions
- **On error**: 100% (always record if error occurs)

Adjust in `frontend/src/main.jsx` if needed.

## Troubleshooting

### Errors Not Appearing

1. **Check DSN is correct**: Paste into Sentry.io dashboard
2. **Check environment variable is set**: `echo $SENTRY_DSN`
3. **Check network**: Browser DevTools → Network tab, look for `ingest.sentry.io` requests
4. **Test endpoint**: Curl `http://localhost:8000/api/test-error`

### High Quota Usage

Reduce sample rates:
- `traces_sample_rate: 0.05` (5% for production)
- `replaysSessionSampleRate: 0.05` (5% for session replay)

### Source Maps Not Uploading

1. Generate auth token in Sentry: Settings → Auth Tokens
2. Set `SENTRY_AUTH_TOKEN=...` in environment
3. Run build with Vite plugin configured

## Links

- **Sentry Docs**: https://docs.sentry.io
- **React Integration**: https://docs.sentry.io/platforms/javascript/guides/react/
- **FastAPI Integration**: https://docs.sentry.io/platforms/python/guides/fastapi/
