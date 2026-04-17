// Title-based parallel matcher. Sellers don't format titles consistently and
// the scraper often maps listings to a generic "Base"/"Refractor" card, so
// relying on card.parallel alone misses most inserts. We check the title text
// for parallel keywords, then fall back to the stored parallel.

// Each entry is [filter option label, array of case-insensitive regex patterns]
// Order matters: more specific patterns first (e.g. auto-variant before plain auto).
const PARALLEL_PATTERNS = [
  // Numbered autograph variants — check before generic "autograph"
  ['SuperFractor', [/super ?fractor/]],
  ['Red /5', [/\bred\b.*\/\s*5\b/, /\/\s*5\b.*\bred/]],
  ['Black /10', [/\bblack\b.*\/\s*10\b/, /\/\s*10\b.*\bblack/]],
  ['Orange /25', [/\borange\b.*\/\s*25\b/, /\/\s*25\b.*\borange/]],
  ['Gold /50', [/\bgold\b.*\/\s*50\b/, /\/\s*50\b.*\bgold/]],
  ['F1 75th /75', [/75th.*\/\s*75\b/, /\/\s*75\b.*75th/, /anniversary.*\/\s*75\b/]],
  ['Green /99', [/\bgreen\b.*\/\s*99\b/, /\/\s*99\b.*\bgreen/]],
  ['Blue /150', [/\bblue\b.*\/\s*150\b/, /\/\s*150\b.*\bblue/]],
  ['Aqua /199', [/\baqua\b.*\/\s*199\b/, /\/\s*199\b.*\baqua/]],
  ['Pink /250', [/\bpink\b.*\/\s*250\b/, /\/\s*250\b.*\bpink/]],
  ['Teal /299', [/\bteal\b.*\/\s*299\b/, /\/\s*299\b.*\bteal/]],

  // Insert sets — check title text
  ['Vegas at Night', [/vegas at night/, /vegas ?night/]],
  ['Neon Nations', [/neon nations?/]],
  ['Floor It', [/floor ?it/]],
  ['Speed Wheels', [/speed wheels?/]],
  ['Top Speed', [/top speed/]],
  ['Four & More', [/four ?& ?more/, /four and more/, /4 ?& ?more/]],
  ['Diamond 75th', [/diamond ?75th/, /75th anniversary diamond/]],
  ['Helix', [/\bhelix\b/]],
  ['Ultrasonic', [/ultrasonic/]],
  ['The Grail', [/\bthe grail\b/, /\bgrail\b/]],
  ['Futuro', [/futuro/]],
  ['The Chain', [/\bthe chain\b/]],
  ['The Grid', [/\bthe grid\b/]],
  ['Helmet Collection', [/helmet collection/, /helmet collectors/]],
  ['Speed Demons', [/speed demons?/]],
  ['Ace of Trades', [/ace of trades?/]],
  ['Checker Flag', [/checker ?flag/, /checkered ?flag/]],
  ['B&W Ray Wave', [/b\s*&\s*w.*ray ?wave/, /ray ?wave.*b\s*&\s*w/, /black ?& ?white.*ray/]],
  ['B&W Lazer', [/b\s*&\s*w.*lazer/, /lazer.*b\s*&\s*w/, /black ?& ?white.*lazer/]],

  // Base parallels — least specific, checked last
  ['Prism Refractor', [/prism ?refractor/, /prizm ?refractor/]],
  ['Refractor', [/refractor/]],

  // Autograph is checked last so numbered auto variants above win first
  ['Autograph', [/\bauto(graph)?\b/, /\bsigned\b/]],
]

export function parallelFromTitle(title) {
  const t = (title || '').toLowerCase()
  if (!t) return null
  for (const [label, patterns] of PARALLEL_PATTERNS) {
    if (patterns.some(re => re.test(t))) return label
  }
  return null
}

// True if an auction matches the selected parallel filter option.
// Handles 'All' (pass), 'No Base' (exclude only plain Base/unknown), and
// every specific parallel label.
export function matchesParallel(auction, filterValue) {
  if (filterValue === 'All') return true

  const titleMatch = parallelFromTitle(auction.title || '')
  const cardParallel = auction.card?.parallel || ''

  if (filterValue === 'No Base') {
    // Reject only true Base cards — everything with a detected parallel passes.
    if (titleMatch && titleMatch !== 'Base') return true
    if (cardParallel && cardParallel !== 'Base') return true
    return false
  }

  // Specific parallel: match if title regex hits OR card.parallel matches exactly.
  return titleMatch === filterValue || cardParallel === filterValue
}
