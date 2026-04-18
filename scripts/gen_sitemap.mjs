// Generate sitemap.xml with core routes + all driver × top-parallel card pages.
// Reads the driver lists straight from frontend/src/lib/drivers.js, so new
// drivers are picked up automatically when we rerun this script.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SITE = 'https://chrome-crest-autonomous-ebay.vercel.app'

// Top parallels — keep in sync with frontend/src/pages/CardPage.jsx TOP_PARALLELS
const TOP_PARALLELS = [
  'Refractor', 'Prism Refractor', 'Aqua /199', 'Blue /150',
  'Green /99', 'Gold /50', 'Orange /25', 'Autograph',
]

// Extract the four driver arrays from drivers.js with regex — avoids needing
// a bundler and still keeps one source of truth.
function parseDriverArrays() {
  const src = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'lib', 'drivers.js'), 'utf8')
  const extract = (name) => {
    const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`)
    const m = src.match(re)
    if (!m) return []
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
  }
  return {
    F1: extract('DRIVERS_F1'),
    F2: extract('DRIVERS_F2'),
    F3: extract('DRIVERS_F3'),
    LEGENDS: extract('DRIVERS_LEGENDS'),
  }
}

function kebab(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

const today = new Date().toISOString().slice(0, 10)

const CORE_ROUTES = [
  ['/', '1.0'], ['/today', '0.9'], ['/auctions', '0.8'], ['/bin', '0.8'],
  ['/sales', '0.8'], ['/graded', '0.8'], ['/drivers', '0.8'], ['/psa', '0.8'],
  ['/compare', '0.8'], ['/portfolio', '0.8'], ['/analytics', '0.8'],
  ['/alerts', '0.8'], ['/wishlist', '0.8'], ['/price-history', '0.8'],
]

function urlNode(loc, priority = '0.6') {
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${priority}</priority>
  </url>`
}

function run() {
  const drivers = parseDriverArrays()
  const all = [...drivers.F1, ...drivers.F2, ...drivers.F3, ...drivers.LEGENDS]

  const lines = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')

  for (const [route, prio] of CORE_ROUTES) {
    lines.push(urlNode(`${SITE}${route}`, prio))
  }
  // Driver query pages (legacy — keep for SEO)
  for (const d of all) {
    lines.push(urlNode(`${SITE}/drivers?name=${encodeURIComponent(d)}`, '0.6'))
  }
  // NEW: card-specific landing pages
  for (const d of all) {
    for (const p of TOP_PARALLELS) {
      const slug = `${kebab(d)}-${kebab(p)}`
      lines.push(urlNode(`${SITE}/card/${slug}`, '0.7'))
    }
  }
  lines.push('</urlset>')
  lines.push('')

  const out = path.join(ROOT, 'frontend', 'public', 'sitemap.xml')
  fs.writeFileSync(out, lines.join('\n'), 'utf8')

  const total = lines.filter(l => l.trim().startsWith('<loc>')).length
  console.log(`sitemap.xml written — ${total} URLs`)
  console.log(`  core routes: ${CORE_ROUTES.length}`)
  console.log(`  driver query pages: ${all.length}`)
  console.log(`  card landing pages: ${all.length * TOP_PARALLELS.length}`)
}

run()
