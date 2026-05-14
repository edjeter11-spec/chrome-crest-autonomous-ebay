/* Chrome Crest service worker — Web Push + cache-first for static assets. */
const STATIC_CACHE = 'cc-static-v1'

self.addEventListener('install', (e) => self.skipWaiting())

self.addEventListener('activate', (event) => {
  // Drop any old static caches from previous SW versions, then claim clients.
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('cc-static-') && k !== STATIC_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Cache-first for hashed Vite build assets (/assets/*.{js,css}). Filenames are
// content-hashed so a new build automatically yields new URLs — no manual
// invalidation needed. All other requests (API, HTML, images) pass through to
// the network unchanged so push-notification behaviour and live data are
// untouched.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  let url
  try { url = new URL(req.url) } catch { return }
  if (url.origin !== self.location.origin) return
  if (!url.pathname.startsWith('/assets/')) return

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE)
    const hit = await cache.match(req)
    if (hit) return hit
    try {
      const res = await fetch(req)
      // Only cache successful, basic (same-origin) responses.
      if (res && res.ok && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {})
      }
      return res
    } catch (err) {
      // Network failed and nothing cached — let the browser surface the error.
      throw err
    }
  })())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    try { data = { title: 'Chrome Crest', body: event.data?.text?.() || '' } } catch { data = {} }
  }
  const title = data.title || 'Chrome Crest'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'chrome-crest',
    data: { url: data.url || '/' },
    requireInteraction: (data.title || '').includes('CRITICAL'),
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.navigate?.(target); return w.focus() }
      }
      if (clients.openWindow) return clients.openWindow(target)
    })
  )
})
