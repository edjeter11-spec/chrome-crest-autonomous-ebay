/**
 * F1 Card Vault — eBay search results overlay.
 *
 * Scans visible search-result cards on ebay.com/sch/, extracts title + price,
 * batches them to our /api/extension/verdicts endpoint via the background
 * worker, and overlays a colored verdict badge directly on each card.
 *
 * Re-runs on infinite-scroll: a MutationObserver watches the results
 * container and processes any new cards that appear.
 */

(async () => {
  const enabled = await new Promise(r =>
    chrome.storage.sync.get({ enabled: true }, ({ enabled }) => r(enabled))
  )
  if (!enabled) return

  // Match if we're on a 2025 Topps Chrome F1 search. Avoids polluting unrelated
  // searches with our F1-specific verdicts.
  const url = new URL(location.href)
  const q = (url.searchParams.get('_nkw') || '').toLowerCase()
  // Loose check — if the user is doing F1-relevant searches, run.
  const looksF1 = /f1|formula\s*1|topps\s*chrome|verstappen|hamilton|leclerc|norris|piastri/.test(q) ||
                  /sapphire|chrome|formula/.test(q)
  if (!looksF1) {
    // Still mount a "scan anyway" button for users who want to try.
    mountManualToggle()
    return
  }

  // Selectors to find result cards. eBay rotates layouts ('s-item' classic,
  // 's-card' new). Try both.
  const CARD_SELECTORS = [
    'li.s-item',
    'div.s-item__wrapper',
    '.su-card-container',
    '.s-card',
  ]

  const TITLE_SELECTORS = [
    '.s-item__title span',
    '.s-item__title',
    '.s-card__title',
    '[data-testid="item-title"]',
    'h3',
  ]
  const PRICE_SELECTORS = [
    '.s-item__price',
    '.s-card__price',
    '[data-testid="item-price"]',
  ]

  function pickText(el, selectors) {
    for (const sel of selectors) {
      const node = el.querySelector(sel)
      if (node) {
        const t = (node.textContent || '').trim()
        if (t) return t
      }
    }
    return ''
  }

  function parsePrice(text) {
    if (!text) return 0
    // Take first $X amount; ignore "to" ranges by taking lower bound.
    const m = text.replace(/[,]/g, '').match(/\$\s*(\d+(?:\.\d{1,2})?)/)
    return m ? parseFloat(m[1]) : 0
  }

  function findCards() {
    const seen = new Set()
    const cards = []
    for (const sel of CARD_SELECTORS) {
      document.querySelectorAll(sel).forEach(el => {
        if (seen.has(el)) return
        if (el.dataset.f1vBadged === '1') return
        seen.add(el)
        const title = pickText(el, TITLE_SELECTORS)
        const priceText = pickText(el, PRICE_SELECTORS)
        const price = parsePrice(priceText)
        if (!title || title === 'Shop on eBay' || title.length < 6) return
        cards.push({ el, title, price })
      })
    }
    return cards
  }

  function badgeFor(verdict) {
    if (!verdict) return null
    const v = verdict.verdict
    if (!v) return null
    const config = {
      STRONG_BUY: { color: '#10b981', text: 'STRONG BUY', emoji: '🔥' },
      GOOD_BUY: { color: '#22c55e', text: 'GOOD BUY', emoji: '✓' },
      FAIR: { color: '#9ca3af', text: 'FAIR', emoji: '·' },
      OVERPRICED: { color: '#f59e0b', text: 'OVERPRICED', emoji: '↑' },
      PASS: { color: '#ef4444', text: 'PASS', emoji: '✗' },
    }[v]
    if (!config) return null

    const wrap = document.createElement('div')
    wrap.className = 'f1v-badge-wrap'
    wrap.innerHTML = `
      <div class="f1v-badge" style="background:${config.color};">
        <span class="f1v-badge-emoji">${config.emoji}</span>
        <span class="f1v-badge-text">${config.text}</span>
      </div>
      <div class="f1v-badge-detail">
        ${verdict.median != null ? `Median <strong>$${verdict.median.toFixed(2)}</strong>` : ''}
        ${verdict.ratio != null ? `· <strong>${Math.round((1 - verdict.ratio) * 100)}%</strong> ${verdict.ratio < 1 ? 'under' : 'over'}` : ''}
        ${verdict.n_comps ? `<span class="f1v-badge-conf">· ${verdict.n_comps} comps${verdict.low_confidence ? ' (low conf)' : ''}</span>` : ''}
      </div>
      <a class="f1v-badge-link" target="_blank" rel="noopener"
         href="https://www.f1cardvault.com/how-we-score">How?</a>
    `
    return wrap
  }

  async function processBatch(cards) {
    if (!cards.length) return
    cards.forEach(c => { c.el.dataset.f1vBadged = '1' })
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'verdicts:batch',
        items: cards.map(c => ({ title: c.title, price: c.price })),
      })
      const verdicts = resp?.verdicts || []
      cards.forEach((c, i) => {
        const v = verdicts[i]
        if (!v || !v.verdict) return
        const badge = badgeFor(v)
        if (!badge) return
        // Make the card a positioning context so the badge floats correctly.
        c.el.style.position = 'relative'
        c.el.appendChild(badge)
      })
    } catch (e) {
      // Service worker may be paused — leave dataset flag off so we retry.
      cards.forEach(c => { delete c.el.dataset.f1vBadged })
    }
  }

  let pending = []
  let scheduled = false
  function schedule() {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      const cards = findCards()
      if (cards.length) processBatch(cards)
    }, 350) // small debounce
  }

  // Initial pass.
  schedule()

  // Watch for new results from infinite scroll / filter changes.
  const obs = new MutationObserver(schedule)
  obs.observe(document.body, { childList: true, subtree: true })

  function mountManualToggle() {
    // Tiny floating button in the corner — lets users force-scan even if our
    // heuristic doesn't think the page is F1-related.
    if (document.getElementById('f1v-manual-scan')) return
    const btn = document.createElement('button')
    btn.id = 'f1v-manual-scan'
    btn.className = 'f1v-manual-scan'
    btn.textContent = 'Scan F1 verdicts'
    btn.onclick = () => {
      btn.disabled = true
      btn.textContent = 'Scanning…'
      const cards = findCards()
      processBatch(cards).finally(() => {
        btn.textContent = `Scanned ${cards.length}`
        setTimeout(() => btn.remove(), 4000)
      })
    }
    document.body.appendChild(btn)
  }
})()
