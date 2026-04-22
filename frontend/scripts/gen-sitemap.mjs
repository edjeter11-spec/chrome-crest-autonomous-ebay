// Build /public/sitemap.xml from the canonical driver roster.
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRIVERS_F1, DRIVERS_F2, DRIVERS_F3, DRIVERS_LEGENDS } from '../src/lib/drivers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/sitemap.xml')
const BASE = 'https://www.f1cardvault.com'
const today = new Date().toISOString().slice(0, 10)

const staticRoutes = [
  '/', '/auctions', '/bin', '/sales', '/graded',
  '/drivers', '/psa', '/portfolio', '/analytics', '/alerts',
  '/wishlist', '/price-history',
]

const drivers = [
  ...DRIVERS_F1, ...DRIVERS_F2, ...DRIVERS_F3, ...DRIVERS_LEGENDS,
]

const urls = []
for (const r of staticRoutes) {
  urls.push({ loc: BASE + r, priority: r === '/' ? '1.0' : '0.8' })
}
for (const d of drivers) {
  urls.push({ loc: `${BASE}/drivers?name=${encodeURIComponent(d)}`, priority: '0.6' })
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`

writeFileSync(OUT, xml)
console.log('wrote', OUT, `${urls.length} urls`)
