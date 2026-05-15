/**
 * Pull the serial number ("22/150") OR just the print-run total ("/150")
 * out of an eBay title. Returns "#22/150", "/150", or '' when neither is
 * present. Intentionally tight so we don't false-positive on card numbers
 * like "#143" or release dates.
 *
 * Preferred patterns:
 *   "22/150"   → "#22/150" (numbered to total)
 *   "#22/150"  → "#22/150"
 *   "/150"     → "/150"    (print-run total only)
 *
 * Suppresses "0/0" / "0/50" ghosts (bug 2 from user audit — broken parsing
 * was rendering "00/00 Error" or "#0/50" on listings with zero either side).
 */
export function parsePrintRun(title) {
  if (!title) return ''
  const t = String(title)
  const numbered = t.match(/(?:^|\s|#)(\d{1,3})\/(\d{1,4})\b/)
  if (numbered) {
    const total = parseInt(numbered[2], 10)
    const num = parseInt(numbered[1], 10)
    if (num <= 0 || total <= 0) return ''
    if (total >= 5 && num <= total) return `#${num}/${total}`
  }
  // Total-only: "/150", "/99", "/10". Same lower bound.
  const totalOnly = t.match(/(?:^|\s)\/(\d{1,4})\b/)
  if (totalOnly) {
    const total = parseInt(totalOnly[1], 10)
    if (total >= 5 && total <= 9999) return `/${total}`
  }
  return ''
}
