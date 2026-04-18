// Web Push manager — registers the SW and manages browser subscription.
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    return reg
  } catch (e) {
    console.warn('SW register failed', e)
    return null
  }
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function isSubscribed() {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

export async function subscribePush() {
  if (!pushSupported()) throw new Error('Push not supported')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Permission denied')

  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerSW())
  if (!reg) throw new Error('SW not available')

  // Get VAPID key
  const r = await fetch(`${API}/api/push/vapid-public-key`)
  const { public_key } = await r.json()
  if (!public_key) throw new Error('No VAPID key configured')

  // Reuse existing or create new
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(public_key),
    })
  }
  await fetch(`${API}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  })
  localStorage.setItem('cc_push_subscribed', '1')
  return sub
}

export async function unsubscribePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => {})
    await fetch(`${API}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {})
  }
  localStorage.removeItem('cc_push_subscribed')
}
