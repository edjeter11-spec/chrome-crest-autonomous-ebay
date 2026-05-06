# F1 Card Vault — Browser Extension

Live verdicts (STRONG_BUY / GOOD_BUY / FAIR / OVERPRICED / PASS) overlaid on every 2025 Topps Chrome F1 listing as you browse eBay.

## What it does

- **Search results pages** (`ebay.com/sch/...`): each F1 card gets a small badge with the verdict + median + ratio
- **Individual listings** (`ebay.com/itm/...`): a full panel pinned to the top-right with median, comp count, driver/parallel
- **Powered by f1cardvault.com** — the same comp data and scoring used on the dashboard

## Install (development / unpacked)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo
5. Pin the F1 Card Vault icon to your toolbar (puzzle icon → pin)
6. Visit `https://www.ebay.com/sch/i.html?_nkw=2025+topps+chrome+f1` — verdict badges should appear on each result

## Install (Chrome Web Store)

Coming soon. The packaged `.zip` is at `extension.zip` in the repo root, ready for store submission.

## Settings

Click the toolbar icon to:
- **Enable / disable** overlay on eBay
- **Change API endpoint** (default `https://www.f1cardvault.com` — only change if running a local backend)
- **Clear cache** (verdicts are cached 60s in the background worker)

## Privacy

The extension only reads listing titles + prices on eBay search/listing pages. It sends them to `f1cardvault.com/api/extension/verdicts` over HTTPS to compute the verdict. No personal data leaves your browser.

## Tech notes

- **Manifest V3**, service worker background
- Content scripts run at `document_idle` so they don't block eBay's own JS
- `MutationObserver` re-scans on infinite scroll
- Verdict cache: 60s TTL, max 1000 entries, evicted FIFO
- All overlay classes namespaced `f1v-*` to avoid clashes with eBay CSS

## Debugging

1. `chrome://extensions` → F1 Card Vault → **Service worker** → opens DevTools for the background script
2. On any eBay page → DevTools console → look for `[F1 Vault ext]` log lines
3. Visit `https://www.f1cardvault.com/api/extension/verdicts` directly to confirm the API is reachable
