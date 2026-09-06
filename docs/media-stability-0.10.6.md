# Media stability — Neo 0.10.6

The thumbnail investigation reproduced a destructive cache race. A capture could
finish its IndexedDB write, then receive a tab-change invalidation before its
continuation ran. The old continuation deleted the URL's cached preview. An
already-open overlay could retain its decoded image, while a newly opened overlay
read the now-empty cache.

Capture validity is now checked inside the write transaction. Cancelled captures
leave the existing preview untouched, and later tab changes no longer delete a
successfully committed preview. The regression injects invalidation at the native
IndexedDB put-success boundary: 0.10.5 fails; 0.10.6 passes.

An overlay also used to retain failed/null preview requests for its entire
lifetime and discard its fallback even after an image decode failure. Visible
missing or unreadable previews now retry on later refreshes; successful previews
stay mounted. Rendering replaces the fallback only after decoding succeeds.

Favicon rendering now shares a persistent, bounded last-known-good cache across
the library and overlays. The browser's local `_favicon` endpoint remains the
source; this does not fetch icons from destination websites or add permissions.
Generic browser placeholders, failed lookups and corrupt image responses do not
replace a known icon. Initial misses retry, concurrent lookups coalesce, and
rerenders reuse decoded pixels immediately. The additive IndexedDB version 4
upgrade adds the favicon store alongside the existing library stores.

The original spontaneous Edge icon disappearance was not reproduced. The repair
covers observed weaknesses in Neo's previous loading path, with deterministic
transport fault injection against the production favicon resolver. It does not
establish why Edge temporarily returned generic icons in the user's screenshot.

The initial image-policy hypothesis was ruled out: both old and new builds render
the cached thumbnail on a page with `img-src 'none'`. An early failed check had
left its target outside the lazy-loading viewport; it was corrected to scroll
the target into view before asserting.

## Verification

- 118 unit tests pass: `output/unit-0.10.6.txt`.
- Old-build race reproduction fails in `output/chrome-1788686161865`.
- Final extracted package: `output/release-0.10.6-final`.
- Chrome: 21 checks, no browser exceptions; `output/chrome-1788686576617/results.json`.
- Edge: 9 checks, no browser exceptions; `output/edge-1788686635174/results.json`.
- Chrome checks cover fresh overlays on two host pages, missing/corrupt preview
  recovery without reopening, late invalidation, byte/age eviction and rejection
  of navigated/private captures. Both browsers check real cached site icons,
  simulated generic/unavailable/corrupt native responses, identical rerendered
  pixels, deferred-tab identity and baseline library behavior.
- Inspected the dark overlay screenshot: cached previews and standalone favicons
  render without the overlapping fallback tile.

Commands:

```powershell
node --test tests/*.test.mjs
node scripts/build-overlay.mjs
node scripts/package.mjs
Expand-Archive output/neo-0.10.6.zip output/release-0.10.6-final -Force
node scripts/browser-check.mjs --chrome --extension=output/release-0.10.6-final --overlay-scopes --media-stability --parked-identity --favicon-stability --previews
node scripts/browser-check.mjs --extension=output/release-0.10.6-final --parked-identity --favicon-stability
```

Reload the updated extension and refresh the library/existing overlay host pages.
The fix cannot reconstruct a thumbnail that an older build already deleted;
visiting that page and opening Neo captures a replacement when capture is available.
