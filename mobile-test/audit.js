/**
 * Mobile UX audit for f1cardvault.com.
 *
 * Drives a real Chromium with iPhone 14 Pro emulation through:
 *   /             (Dashboard)
 *   /sales        (Sales DB)
 *   /auctions     (Auctions list)
 *   /sniper       (Sniper)
 *   /how-we-score (Explainer)
 *
 * For each page it:
 *   1. Captures full-page screenshot to ./screenshots/
 *   2. Detects horizontal scroll (most common mobile bug)
 *   3. Lists tap targets smaller than 40px (Apple HIG = 44px, we use 40px as warning floor)
 *   4. Lists elements that overflow the viewport horizontally
 *   5. Counts empty / skeleton sections that never resolve
 *   6. Checks for visible JS console errors
 *
 * Outputs JSON summary to ./report.json + a human-readable digest to stdout.
 */

import { chromium, devices } from 'playwright'
import fs from 'fs/promises'
import path from 'path'

const BASE = process.env.BASE_URL || 'https://f1cardvault.com'
const OUT_DIR = path.resolve('./screenshots')
const REPORT = path.resolve('./report.json')

const PAGES = [
  { path: '/', name: 'dashboard' },
  { path: '/sales', name: 'sales' },
  { path: '/auctions', name: 'auctions' },
  { path: '/sniper', name: 'sniper' },
  { path: '/how-we-score', name: 'how-we-score' },
]

async function auditPage(context, p) {
  const page = await context.newPage()
  const consoleErrs = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrs.push(msg.text().slice(0, 200))
  })
  page.on('pageerror', e => consoleErrs.push(`PAGEERROR ${e.message?.slice(0, 200)}`))

  const issues = []
  let scrollX = 0
  let viewportWidth = 0
  let smallTaps = []
  let overflowing = []
  let skeletonsLeft = 0
  let loadOk = false
  let title = ''
  let pageHTML = ''

  try {
    // Pre-set localStorage flags that suppress first-visit overlays so the
    // audit sees the actual app, not the WelcomeModal / OnboardingTour /
    // SignedOutBanner that mask everything behind them.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('cc_welcome_dismissed', '1')
        localStorage.setItem('cc_signed_out_banner_dismissed', '1')
        localStorage.setItem('cc_onboarding_complete', '1')
        localStorage.setItem('cc_tour_done', '1')
      } catch {}
    })

    const resp = await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle', timeout: 30000 })
    loadOk = resp && resp.ok()
    if (!loadOk) issues.push(`HTTP ${resp?.status() ?? 'no response'}`)
    title = await page.title()
    // Wait for SPA hydration + lazy chunks
    await page.waitForTimeout(1800)
    // Aggressively dismiss any modal/overlay still up — try both close buttons
    // and Escape, and remove fixed-overlay nodes if all else fails.
    try {
      const closeBtns = await page.$$('[aria-label="Close"], [aria-label="close"], button:has(svg.lucide-x)')
      for (const b of closeBtns.slice(0, 4)) {
        try { await b.click({ timeout: 800 }) } catch {}
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    } catch {}

    // Take screenshot
    const screenPath = path.join(OUT_DIR, `${p.name}.png`)
    await page.screenshot({ path: screenPath, fullPage: true })

    // Horizontal scroll check (single most-common mobile bug)
    const dims = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScroll: document.body.scrollWidth,
    }))
    scrollX = dims.scrollWidth
    viewportWidth = dims.clientWidth
    if (dims.scrollWidth > dims.clientWidth + 1) {
      issues.push(`HORIZONTAL_SCROLL: scrollWidth=${dims.scrollWidth} > viewport=${dims.clientWidth}`)
    }

    // Tap-target audit — find buttons / links smaller than 40px.
    // Skip footer legal links (small text by design) and elements inside
    // closed mobile drawers (off-canvas).
    smallTaps = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')]
      const small = []
      const FOOTER_TEXTS = new Set(['Home', 'About', 'FAQ', 'Terms', 'Privacy', 'Contact', 'How we score', 'Shortcuts'])
      for (const el of els) {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) continue // hidden
        // Skip footer legal text-links (intentionally compact)
        const txt = (el.textContent || '').trim()
        if (FOOTER_TEXTS.has(txt) && r.height <= 20) continue
        if (r.width < 40 || r.height < 40) {
          const cs = window.getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden') continue
          // Skip elements inside closed drawers (entire ancestor offscreen)
          if (r.right <= 0 || r.left > window.innerWidth) continue
          const visible = r.top >= -window.innerHeight && r.top < window.innerHeight * 3
          if (!visible) continue
          small.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 30),
            w: Math.round(r.width),
            h: Math.round(r.height),
            cls: (el.className || '').toString().slice(0, 60),
          })
        }
      }
      // Dedupe by class+text so we don't report 50 of the same thing
      const seen = new Set()
      const unique = []
      for (const s of small) {
        const k = `${s.tag}|${s.cls}|${s.text}`
        if (seen.has(k)) continue
        seen.add(k)
        unique.push(s)
      }
      return unique.slice(0, 25)
    })

    // Overflowing children — anything wider than viewport at its position.
    // Skip:
    //   - closed mobile drawers (translated offscreen via transform / left:-N)
    //   - children of horizontally-scrolling containers (legitimate)
    //   - hidden elements (display:none / visibility:hidden / opacity:0 ancestors)
    overflowing = await page.evaluate(() => {
      const vw = window.innerWidth
      const found = []
      const all = document.querySelectorAll('body *')
      for (const el of all) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right <= vw + 1 && r.left >= -1) continue
        const cs = window.getComputedStyle(el)
        // Hidden / fully-offscreen drawer
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue
        // Closed slide-in drawer: transform translates entire element offscreen.
        // If both left and right are negative, the element is entirely to the
        // left of the viewport — that's an intentional hidden drawer.
        if (r.right <= 0) continue
        let parent = el.parentElement
        let skip = false
        while (parent) {
          const pcs = window.getComputedStyle(parent)
          if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'hidden') { skip = true; break }
          if (pcs.display === 'none' || pcs.visibility === 'hidden' || pcs.opacity === '0') { skip = true; break }
          // Closed drawer ancestor — translate < 0
          const tr = pcs.transform
          if (tr && tr !== 'none' && tr.includes('matrix') && tr.match(/-\d{2,}/)) { skip = true; break }
          parent = parent.parentElement
        }
        if (skip) continue
        found.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 80),
          w: Math.round(r.width),
          right: Math.round(r.right),
          txt: (el.textContent || '').trim().slice(0, 40),
        })
      }
      // Dedupe
      const seen = new Set()
      const out = []
      for (const f of found) {
        const k = `${f.tag}|${f.cls}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push(f)
      }
      return out.slice(0, 15)
    })

    // Skeleton check — count elements still showing animate-pulse after wait
    skeletonsLeft = await page.evaluate(() => {
      return document.querySelectorAll('.animate-pulse').length
    })
    if (skeletonsLeft > 5) {
      issues.push(`STUCK_SKELETONS: ${skeletonsLeft} animate-pulse elements still rendering after 1.5s`)
    }
  } catch (e) {
    issues.push(`EXCEPTION: ${e.message?.slice(0, 200)}`)
  }

  await page.close()

  return {
    name: p.name,
    path: p.path,
    title,
    loadOk,
    viewportWidth,
    scrollWidth: scrollX,
    horizontalScroll: scrollX > viewportWidth + 1,
    smallTaps,
    overflowing,
    skeletonsLeft,
    consoleErrors: consoleErrs,
    issues,
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  // iPhone 14 Pro — 393x852 dpr=3, common F1 fan device.
  const iphone = devices['iPhone 14 Pro'] || devices['iPhone 13'] || devices['iPhone 12']
  const context = await browser.newContext({ ...iphone, viewport: iphone.viewport })

  console.log(`\n🔍 Auditing ${BASE} on ${iphone.name || 'iPhone'} (${iphone.viewport.width}x${iphone.viewport.height})\n`)

  const results = []
  for (const p of PAGES) {
    process.stdout.write(`  ${p.path.padEnd(20)} ... `)
    const r = await auditPage(context, p)
    results.push(r)
    const summary = []
    if (r.horizontalScroll) summary.push('🔴 H-SCROLL')
    if (r.smallTaps.length > 0) summary.push(`🟡 ${r.smallTaps.length} small taps`)
    if (r.overflowing.length > 0) summary.push(`🟠 ${r.overflowing.length} overflow`)
    if (r.skeletonsLeft > 5) summary.push(`🟡 ${r.skeletonsLeft} skeletons stuck`)
    if (r.consoleErrors.length > 0) summary.push(`🔴 ${r.consoleErrors.length} console errs`)
    if (!r.loadOk) summary.push('🔴 LOAD FAIL')
    if (r.issues.length === 0 && summary.length === 0) summary.push('✅ clean')
    console.log(summary.join(' · '))
  }

  await fs.writeFile(REPORT, JSON.stringify({ base: BASE, ts: new Date().toISOString(), results }, null, 2))

  // Detailed digest
  console.log('\n=== DETAILED FINDINGS ===\n')
  for (const r of results) {
    if (r.issues.length === 0 && r.smallTaps.length === 0 && r.overflowing.length === 0 && r.consoleErrors.length === 0) continue
    console.log(`${r.path}`)
    for (const i of r.issues) console.log(`  ❗ ${i}`)
    if (r.consoleErrors.length) {
      console.log(`  Console errors:`)
      for (const e of r.consoleErrors.slice(0, 3)) console.log(`    · ${e}`)
    }
    if (r.smallTaps.length) {
      console.log(`  Small tap targets (top ${Math.min(8, r.smallTaps.length)}):`)
      for (const t of r.smallTaps.slice(0, 8)) {
        console.log(`    · ${t.tag} ${t.w}x${t.h} "${t.text}" .${t.cls.slice(0, 40)}`)
      }
    }
    if (r.overflowing.length) {
      console.log(`  Overflowing elements:`)
      for (const o of r.overflowing.slice(0, 5)) {
        console.log(`    · ${o.tag} w=${o.w} right=${o.right} "${o.txt}" .${o.cls.slice(0, 40)}`)
      }
    }
    console.log('')
  }

  console.log(`\n📸 Screenshots: ${OUT_DIR}`)
  console.log(`📄 Full report: ${REPORT}`)

  await context.close()
  await browser.close()
}

main().catch(e => { console.error(e); process.exit(1) })
