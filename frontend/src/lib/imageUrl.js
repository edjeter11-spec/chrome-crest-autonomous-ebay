// eBay CDN image URL helpers.
//
// eBay serves the SAME source image at multiple sizes by suffixing the path
// segment, e.g. `s-l225.jpg` (225px) → `s-l500.jpg` (500px) → `s-l1600.jpg`.
// Bumping the suffix returns a higher-res version at the same path with no
// extra request to a different origin — pure quality win.
//
// We only ever upscale http(s) URLs that look like the eBay CDN form. Anything
// else (data: URIs, our proxy URLs, broken inputs) is returned unchanged so
// callers can wrap every `image_url` blindly.

const EBAY_HOST_RE = /(?:^|\.)ebayimg\.com/i
const SIZE_SUFFIX_RE = /\/s-l\d+(?=\.(?:jpg|jpeg|png|webp)(?:$|\?|#))/i

/**
 * Swap an eBay image URL's `s-lNNN` size token for a higher-res variant.
 *
 * @param {string|null|undefined} url - source image URL (any origin)
 * @param {number} [size=500] - desired pixel size (eBay supports 96, 140, 225,
 *   300, 400, 500, 640, 800, 1000, 1200, 1600)
 * @returns {string} upscaled URL, or the original input if it isn't an eBay
 *   CDN URL with a recognizable size token
 */
export function upscaleEbayImage(url, size = 500) {
  if (!url || typeof url !== 'string') return url || ''
  // Only touch eBay CDN URLs. Leaves our proxy URLs + foreign hosts alone.
  if (!EBAY_HOST_RE.test(url)) return url
  if (!SIZE_SUFFIX_RE.test(url)) return url
  const sz = Number.isFinite(size) && size > 0 ? Math.round(size) : 500
  return url.replace(SIZE_SUFFIX_RE, `/s-l${sz}`)
}

/**
 * Convenience: upscale a list of URLs, dropping nullish entries.
 */
export function upscaleEbayImages(urls, size = 500) {
  if (!Array.isArray(urls)) return []
  return urls.filter(Boolean).map(u => upscaleEbayImage(u, size))
}
