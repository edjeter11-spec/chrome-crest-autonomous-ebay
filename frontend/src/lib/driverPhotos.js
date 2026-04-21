// Fetch driver photos from Wikipedia REST summary API (returns a thumbnail).
// Cached in localStorage for 30 days so we don't hit Wikipedia on every render.
const TITLE_OVERRIDES = {
  'Max Verstappen': 'Max Verstappen',
  'Lewis Hamilton': 'Lewis Hamilton',
  'Charles Leclerc': 'Charles Leclerc',
  'Lando Norris': 'Lando Norris',
  'Fernando Alonso': 'Fernando Alonso',
  'Oscar Piastri': 'Oscar Piastri',
  'Carlos Sainz': 'Carlos Sainz Jr.',
  'George Russell': 'George Russell (racing driver)',
  'Sergio Perez': 'Sergio Pérez',
  'Lance Stroll': 'Lance Stroll',
  'Valtteri Bottas': 'Valtteri Bottas',
  'Esteban Ocon': 'Esteban Ocon',
  'Pierre Gasly': 'Pierre Gasly',
  'Yuki Tsunoda': 'Yuki Tsunoda',
  'Daniel Ricciardo': 'Daniel Ricciardo',
  'Nico Hulkenberg': 'Nico Hülkenberg',
  'Kevin Magnussen': 'Kevin Magnussen',
  'Zhou Guanyu': 'Zhou Guanyu',
  'Alexander Albon': 'Alexander Albon',
  'Logan Sargeant': 'Logan Sargeant',
  'Oliver Bearman': 'Oliver Bearman',
  'Jack Doohan': 'Jack Doohan',
  'Andrea Kimi Antonelli': 'Andrea Kimi Antonelli',
  'Isack Hadjar': 'Isack Hadjar',
  'Gabriel Bortoleto': 'Gabriel Bortoleto',
  'Liam Lawson': 'Liam Lawson',
  'Franco Colapinto': 'Franco Colapinto',
  'Michael Schumacher': 'Michael Schumacher',
  'Ayrton Senna': 'Ayrton Senna',
  'Alain Prost': 'Alain Prost',
  'Nigel Mansell': 'Nigel Mansell',
  'Mario Andretti': 'Mario Andretti',
  'Mika Hakkinen': 'Mika Häkkinen',
  'Damon Hill': 'Damon Hill',
  'Jacques Villeneuve': 'Jacques Villeneuve',
  'Emerson Fittipaldi': 'Emerson Fittipaldi',
  'Juan Pablo Montoya': 'Juan Pablo Montoya',
  'Gerhard Berger': 'Gerhard Berger',
  'James Hunt': 'James Hunt',
  'Sebastian Vettel': 'Sebastian Vettel',
  'Kimi Raikkonen': 'Kimi Räikkönen',
  'Niki Lauda': 'Niki Lauda',
  'Jackie Stewart': 'Jackie Stewart',
  'Jim Clark': 'Jim Clark',
  'Stirling Moss': 'Stirling Moss',
}

const CACHE_KEY = 'cc_driver_photos_v1'
const TTL_MS = 30 * 24 * 3600 * 1000

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed.ts || Date.now() - parsed.ts > TTL_MS) return {}
    return parsed.map || {}
  } catch { return {} }
}

function saveCache(map) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), map })) } catch {}
}

let cache = loadCache()
const inflight = new Map()

export async function fetchDriverPhoto(name) {
  if (!name) return ''
  if (cache[name] !== undefined) return cache[name]
  if (inflight.has(name)) return inflight.get(name)
  const title = TITLE_OVERRIDES[name] || name
  const promise = (async () => {
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
      if (!r.ok) throw new Error('not ok')
      const j = await r.json()
      const url = j?.thumbnail?.source || j?.originalimage?.source || ''
      cache[name] = url
      saveCache(cache)
      return url
    } catch {
      cache[name] = ''
      saveCache(cache)
      return ''
    } finally {
      inflight.delete(name)
    }
  })()
  inflight.set(name, promise)
  return promise
}

export function driverInitials(name) {
  return (name || '').split(' ').map(n => n[0]).filter(Boolean).join('').slice(0, 2)
}
