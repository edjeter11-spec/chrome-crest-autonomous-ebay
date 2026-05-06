/**
 * F1 Card Vault — popup script.
 * Reads/writes settings to chrome.storage.sync; calls into the background
 * worker for cache stats and clearing.
 */

const DEFAULT_API_BASE = 'https://www.f1cardvault.com'

const enabledEl = document.getElementById('enabled')
const apiBaseEl = document.getElementById('apiBase')
const cacheSizeEl = document.getElementById('cacheSize')
const clearCacheBtn = document.getElementById('clearCache')

function setToggle(on) {
  enabledEl.classList.toggle('on', !!on)
  enabledEl.setAttribute('aria-checked', String(!!on))
}

// Load settings.
chrome.storage.sync.get({ enabled: true, apiBase: DEFAULT_API_BASE }, ({ enabled, apiBase }) => {
  setToggle(enabled)
  apiBaseEl.value = apiBase || DEFAULT_API_BASE
})

enabledEl.addEventListener('click', () => {
  const newOn = !enabledEl.classList.contains('on')
  setToggle(newOn)
  chrome.storage.sync.set({ enabled: newOn })
})

let saveTimer = null
apiBaseEl.addEventListener('input', () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const v = apiBaseEl.value.trim().replace(/\/$/, '') || DEFAULT_API_BASE
    chrome.storage.sync.set({ apiBase: v })
  }, 500)
})

clearCacheBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'cache:clear' }, () => {
    cacheSizeEl.textContent = '0'
    clearCacheBtn.textContent = 'Cleared!'
    setTimeout(() => { clearCacheBtn.textContent = 'Clear cache' }, 1200)
  })
})

// Live cache size on open.
chrome.runtime.sendMessage({ type: 'cache:size' }, resp => {
  cacheSizeEl.textContent = resp?.size != null ? String(resp.size) : '0'
})
