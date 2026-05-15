/**
 * Tiny toast notification system. Module-level pub/sub — components call
 * `toast.success("Added to watchlist")` from anywhere; the <ToastHost />
 * mounted at app root renders them.
 *
 * Toasts auto-dismiss after 3.5s by default. Stack from bottom-right on
 * desktop, bottom-center on mobile. Click to dismiss early.
 */

let _id = 0
const _listeners = new Set()
let _toasts = []

function _emit() {
  for (const cb of _listeners) {
    try { cb(_toasts) } catch {}
  }
}

function _push(message, kind = 'info', ttl = 3500) {
  const t = { id: ++_id, message: String(message || ''), kind, expiresAt: Date.now() + ttl }
  _toasts = [..._toasts, t]
  _emit()
  setTimeout(() => dismiss(t.id), ttl)
  return t.id
}

export function dismiss(id) {
  _toasts = _toasts.filter(t => t.id !== id)
  _emit()
}

export function subscribe(cb) {
  _listeners.add(cb)
  cb(_toasts)
  return () => _listeners.delete(cb)
}

export const toast = {
  success: (msg, ttl) => _push(msg, 'success', ttl),
  error:   (msg, ttl) => _push(msg, 'error', ttl ?? 5000),
  info:    (msg, ttl) => _push(msg, 'info', ttl),
  warn:    (msg, ttl) => _push(msg, 'warn', ttl ?? 4500),
}
