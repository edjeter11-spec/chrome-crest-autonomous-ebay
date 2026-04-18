// Canonical driver → series + team mapping. Used by every filter on the site
// so F2/F3/Legends stop leaking into F1 views (and vice versa) just because
// an eBay title happens to contain "F1".

export const DRIVERS_F1 = [
  'Max Verstappen', 'Yuki Tsunoda', 'Charles Leclerc', 'Lewis Hamilton',
  'Lando Norris', 'Oscar Piastri', 'George Russell', 'Andrea Kimi Antonelli',
  'Fernando Alonso', 'Lance Stroll', 'Liam Lawson', 'Isack Hadjar',
  'Esteban Ocon', 'Oliver Bearman', 'Franco Colapinto', 'Alexander Albon',
  'Carlos Sainz', 'Nico Hulkenberg', 'Gabriel Bortoleto', 'Pierre Gasly',
  'Jack Doohan', 'Sergio Perez', 'Valtteri Bottas', 'Zhou Guanyu',
  'Daniel Ricciardo',
]

export const DRIVERS_F2 = [
  'Leonardo Fornaroli', 'Arvid Lindblad', 'Josep Maria Marti', 'Richard Verschoor',
  'Dino Beganovic', 'Gabriele Mini', 'Jak Crawford', 'Victor Martins',
  'Joshua Durksen', 'Luke Browning', 'Alexander Dunne', 'Cian Shields',
  'John Bennett', 'Kush Maini', 'Max Esterson', 'Ivan Domingues',
  'Oliver Goethe', 'Amaury Cordeel',
]

export const DRIVERS_F3 = [
  'Tuukka Taponen', 'Ugo Ugochukwu', 'James Wharton', 'Louis Sharp',
  'Noah Stromsted', 'Javier Sagrera',
]

export const DRIVERS_LEGENDS = [
  'Michael Schumacher', 'Ayrton Senna', 'Alain Prost', 'Nigel Mansell',
  'Mario Andretti', 'Mika Hakkinen', 'Damon Hill', 'Jacques Villeneuve',
  'Emerson Fittipaldi', 'Juan Pablo Montoya', 'Gerhard Berger', 'James Hunt',
  'Sebastian Vettel', 'Kimi Raikkonen', 'Niki Lauda', 'Jackie Stewart',
  'Jim Clark', 'Stirling Moss',
]

// driver lowercase → series
const SERIES_MAP = new Map()
DRIVERS_F1.forEach(d => SERIES_MAP.set(d.toLowerCase(), 'F1'))
DRIVERS_F2.forEach(d => SERIES_MAP.set(d.toLowerCase(), 'F2'))
DRIVERS_F3.forEach(d => SERIES_MAP.set(d.toLowerCase(), 'F3'))
DRIVERS_LEGENDS.forEach(d => SERIES_MAP.set(d.toLowerCase(), 'Legends'))

// team aliases (lowercase) → canonical team name
export const TEAMS = [
  { name: 'Red Bull Racing', aliases: ['red bull racing', 'red bull'] },
  { name: 'Ferrari', aliases: ['ferrari', 'scuderia ferrari', 'scuderia'] },
  { name: 'Mercedes', aliases: ['mercedes-amg', 'mercedes amg', 'mercedes'] },
  { name: 'McLaren', aliases: ['mclaren'] },
  { name: 'Aston Martin', aliases: ['aston martin'] },
  { name: 'Alpine', aliases: ['alpine'] },
  { name: 'Williams', aliases: ['atlassian williams', 'williams racing', 'williams'] },
  { name: 'Haas', aliases: ['haas'] },
  { name: 'Sauber', aliases: ['stake sauber', 'kick sauber', 'sauber'] },
  { name: 'Racing Bulls', aliases: ['racing bulls', 'visa cash app rb', 'rb f1'] },
]

// Primary driver → team for the 2025 grid
const DRIVER_TEAM_MAP = new Map(Object.entries({
  'Max Verstappen': 'Red Bull Racing',
  'Yuki Tsunoda': 'Red Bull Racing',
  'Charles Leclerc': 'Ferrari',
  'Lewis Hamilton': 'Ferrari',
  'Lando Norris': 'McLaren',
  'Oscar Piastri': 'McLaren',
  'George Russell': 'Mercedes',
  'Andrea Kimi Antonelli': 'Mercedes',
  'Fernando Alonso': 'Aston Martin',
  'Lance Stroll': 'Aston Martin',
  'Liam Lawson': 'Racing Bulls',
  'Isack Hadjar': 'Racing Bulls',
  'Esteban Ocon': 'Haas',
  'Oliver Bearman': 'Haas',
  'Franco Colapinto': 'Williams',
  'Alexander Albon': 'Williams',
  'Carlos Sainz': 'Williams',
  'Nico Hulkenberg': 'Sauber',
  'Gabriel Bortoleto': 'Sauber',
  'Pierre Gasly': 'Alpine',
  'Jack Doohan': 'Alpine',
  'Sergio Perez': 'Red Bull Racing',
  'Valtteri Bottas': 'Mercedes',
  'Zhou Guanyu': 'Sauber',
  'Daniel Ricciardo': 'Racing Bulls',
}).map(([k, v]) => [k.toLowerCase(), v]))

// Find which driver's name appears in the title (longest match wins)
function driverInTitle(title) {
  if (!title) return null
  const t = title.toLowerCase()
  // Check all known drivers, longest name first so "Andrea Kimi Antonelli" beats "Antonelli"
  const all = [...DRIVERS_F1, ...DRIVERS_F2, ...DRIVERS_F3, ...DRIVERS_LEGENDS]
    .slice()
    .sort((a, b) => b.length - a.length)
  for (const d of all) {
    if (t.includes(d.toLowerCase())) return d
    // last-name match as fallback (only long-enough last names)
    const last = d.split(' ').pop().toLowerCase()
    if (last.length > 4 && new RegExp(`\\b${last}\\b`).test(t)) return d
  }
  return null
}

export function seriesOf(auction) {
  // 1. Trust the linked card's series first
  const cardSeries = auction?.card?.series
  if (cardSeries) {
    // but if the card was mapped to default id=1 (F1) and the title actually names
    // a legend/F2/F3 driver, trust the driver name over the card. We detect that
    // by checking if the driver name in the title matches a non-F1 series.
    const driverSeries = driverSeriesFromTitle(auction.title)
    if (driverSeries && driverSeries !== cardSeries) return driverSeries
    return cardSeries
  }
  return driverSeriesFromTitle(auction.title) || 'F1'
}

function driverSeriesFromTitle(title) {
  const d = driverInTitle(title)
  if (d) return SERIES_MAP.get(d.toLowerCase())
  // Fallback to title text
  const t = (title || '').toLowerCase()
  if (t.includes('legends') || t.includes('legend ')) return 'Legends'
  if (/\bf3\b|formula 3/.test(t)) return 'F3'
  if (/\bf2\b|formula 2/.test(t)) return 'F2'
  return null
}

export function teamOf(auction) {
  // 1. trust the card's team if present
  const cardTeam = auction?.card?.team
  if (cardTeam) return normalizeTeam(cardTeam)

  // 2. driver → team mapping (authoritative for the 2025 grid)
  const d = auction?.card?.driver_name || driverInTitle(auction?.title || '')
  if (d) {
    const t = DRIVER_TEAM_MAP.get(d.toLowerCase())
    if (t) return t
  }

  // 3. fall back to title text
  const titleLower = (auction?.title || '').toLowerCase()
  for (const team of TEAMS) {
    if (team.aliases.some(a => titleLower.includes(a))) return team.name
  }
  return null
}

function normalizeTeam(raw) {
  const r = (raw || '').toLowerCase()
  for (const t of TEAMS) {
    if (t.aliases.some(a => r.includes(a))) return t.name
  }
  return raw
}

export const ALL_TEAMS = ['All', ...TEAMS.map(t => t.name)]
