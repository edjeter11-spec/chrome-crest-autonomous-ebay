/* Chrome Crest service worker — Web Push only. No offline caching. */
self.addEventListener('install', (e) => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

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
