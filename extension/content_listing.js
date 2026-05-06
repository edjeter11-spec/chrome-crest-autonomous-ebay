/**
 * F1 Card Vault — eBay individual listing page overlay.
 *
 * On a single-listing page (ebay.com/itm/...) we have all the room in the
 * world, so we render a full verdict panel pinned to the top-right of the
 * viewport: median, ratio, comp count, and a deep link to the same listing
 * on f1cardvault.com (when we have it).
 */

(async () => {
  const enabled = await new Promise(r =>
    chrome.storage.sync.get({ enabled: true }, ({ enabled }) => r(enabled))
  )
  if (!enabled) return

  // Extract title — eBay's listing title node is generally:
  //   h1.x-item-title__mainTitle  (new layout)
  //   h1#itemTitle                (older layout)
  function getTitle() {
    const sels = [
      'h1.x-item-title__mainTitle span.ux-textspans',
      'h1.x-item-title__mainTitle',
      'h1#itemTitle',
      'h1[data-testid="x-item-title-label"]',
      'h1.it-ttl',
    ]
    for (const s of sels) {
      const n = document.querySelector(s)
      if (n) {
        const t = (n.textContent || '').trim()
        if (t) return t.replace(/^Details about\s*/i, '').trim()
      }
    }
    // Fallback: meta og:title
    const og = document.querySelector('meta[property="og:title"]')
    return og?.content?.trim() || ''
  }

  function getPrice() {
    const sels = [
      'div.x-price-primary span.ux-textspans',
      'div.x-bin-price__content span.ux-textspans',
      '[data-testid="x-price-primary"] span',
      '#prcIsum',
      '#prcIsum_bidPrice',
      '.x-price-primary',
    ]
    for (const s of sels) {
      const n = document.querySelector(s)
      if (n) {
        const t = (n.textContent || '').replace(/[,]/g, '')
        const m = t.match(/\$\s*(\d+(?:\.\d{1,2})?)/)
        if (m) return parseFloat(m[1])
      }
    }
    return 0
  }

  // Quick "is this an F1 card?" gate so we don't badge unrelated listings.
  function looksLikeF1(title) {
    const t = title.toLowerCase()
    return /(formula\s*1|\bf1\b)/.test(t) && /topps\s*chrome|chrome\s*sapphire|chrome\s*formula/.test(t)
  }

  const title = getTitle()
  if (!title || !looksLikeF1(title)) return
  const price = getPrice()

  let resp
  try {
    resp = await chrome.runtime.sendMessage({
      type: 'verdicts:batch',
      items: [{ title, price }],
    })
  } catch {
    return
  }
  const v = resp?.verdicts?.[0]
  if (!v) return

  const config = {
    STRONG_BUY: { color: '#10b981', text: 'STRONG BUY', emoji: '🔥' },
    GOOD_BUY: { color: '#22c55e', text: 'GOOD BUY', emoji: '✓' },
    FAIR: { color: '#9ca3af', text: 'FAIR', emoji: '·' },
    OVERPRICED: { color: '#f59e0b', text: 'OVERPRICED', emoji: '↑' },
    PASS: { color: '#ef4444', text: 'PASS', emoji: '✗' },
  }[v.verdict] || { color: '#6b7280', text: v.reason === 'no_comps' ? 'NO COMPS' : 'UNKNOWN', emoji: '?' }

  const panel = document.createElement('div')
  panel.id = 'f1v-listing-panel'
  panel.className = 'f1v-listing-panel'
  panel.innerHTML = `
    <div class="f1v-panel-header">
      <img class="f1v-panel-logo" src="${chrome.runtime.getURL('icons/icon-48.png')}" alt="F1 Card Vault" />
      <div class="f1v-panel-title">F1 Card Vault</div>
      <button class="f1v-panel-close" aria-label="Close">×</button>
    </div>
    <div class="f1v-panel-verdict" style="background:${config.color};">
      <span class="f1v-panel-emoji">${config.emoji}</span>
      <span class="f1v-panel-text">${config.text}</span>
    </div>
    <div class="f1v-panel-stats">
      <div class="f1v-panel-row">
        <span class="f1v-panel-k">Listing price</span>
        <span class="f1v-panel-v">$${price.toFixed(2)}</span>
      </div>
      ${v.median != null ? `
      <div class="f1v-panel-row">
        <span class="f1v-panel-k">90-day median</span>
        <span class="f1v-panel-v">$${v.median.toFixed(2)}</span>
      </div>
      ` : ''}
      ${v.ratio != null ? `
      <div class="f1v-panel-row">
        <span class="f1v-panel-k">vs median</span>
        <span class="f1v-panel-v"><strong>${v.ratio < 1 ? '−' : '+'}${Math.abs(Math.round((1 - v.ratio) * 100))}%</strong></span>
      </div>
      ` : ''}
      ${v.n_comps ? `
      <div class="f1v-panel-row f1v-panel-row-muted">
        <span class="f1v-panel-k">Comps</span>
        <span class="f1v-panel-v">${v.n_comps}${v.low_confidence ? ' (low conf)' : ''}</span>
      </div>
      ` : ''}
      ${v.driver ? `
      <div class="f1v-panel-row f1v-panel-row-muted">
        <span class="f1v-panel-k">Driver</span>
        <span class="f1v-panel-v">${v.driver}${v.parallel ? ` · ${v.parallel}` : ''}</span>
      </div>
      ` : ''}
    </div>
    <div class="f1v-panel-actions">
      <a class="f1v-panel-btn" target="_blank" rel="noopener"
         href="https://www.f1cardvault.com/?driver=${encodeURIComponent(v.driver || '')}">
        See full driver page →
      </a>
      <a class="f1v-panel-link" target="_blank" rel="noopener"
         href="https://www.f1cardvault.com/how-we-score">
        How we score
      </a>
    </div>
  `
  document.body.appendChild(panel)
  panel.querySelector('.f1v-panel-close').onclick = () => panel.remove()

  // Close with Escape.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.isConnected) panel.remove()
  })
})()
