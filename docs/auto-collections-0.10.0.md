# Automatic collection state, version history and same-window swapping — 0.10.0

## Why the card and opened tabs disagreed

Before this release, collection cards displayed curated saved links, while Swap preferred an independently retained browsing snapshot or the latest Timeline snapshot. The manual Update workflow only added reviewed new URLs. Closing tabs updated the browsing snapshot but not the saved card, so an eight-link card could resume a one-tab session. This was conflicting state semantics, not a rendering-cache problem.

The user explicitly chose to have active collections mirror their open tabs, including removal on tab closure, with previous versions retained. They also requested collection-specific version history in each collection menu and no new browser windows during swapping.

## Resulting workflow

- Swap makes the collection active in the source window. Eligible unpinned pages become its automatically maintained contents. Additions, closures (including zero remaining pages), navigation, tab movement and native group changes trigger a debounced checkpoint, normally about 1.8 seconds after the last change. The one-minute alarm remains a fallback.
- The card shows Auto-updating. Manual saved-list membership/group edits pause automatic tracking to prevent overwriting that intentional edit; the status becomes Auto-update paused, with the reason in its tooltip. Click the status or use the collection menu to resume. Notes and custom titles on matching URLs are preserved. Duplicate URLs are matched individually.
- The saved collection is authoritative when reopening. Ordinary historical Timeline snapshots no longer override its current contents. Old retained live tabs are reused only when their content matches. New swaps keep resumable snapshots instead of creating holding windows, and replace unpinned tabs in the existing window. An empty destination retains a Neo library page so that window stays alive. Returning reloads websites rather than retaining in-memory page state.
- Collection menu > Version history shows that collection's previous saved versions and earlier legacy snapshots, with dates, counts, website icons and restore controls. Redundant checkpoints after version tracking began are excluded. The prior collection is written atomically with each content change in the same IndexedDB transaction. Restoring an active collection also replaces its open tabs in the same window; previous content remains recoverable.
- Version/Timeline retention is bounded by the existing 200-entry and 30-day limits. Another already active window is focused rather than creating a competing owner. Incomplete switches/restores pause tracking so a partial tab set cannot silently overwrite the saved version.
- Existing legacy holding windows are not bulk-closed by an upgrade. They can still supply their retained pages when revisited. No new holding window is created by swapping or version restore.

## Validation

102 unit tests passed in output/unit-0.10.0.txt. Browser checks use disposable profiles and the extracted release. They exercise actual debounced autosave (without forcing checkpoints), navigation, pin/unpin exclusion, group rename/colour, closing to one and zero tabs, switching away/back, per-collection menu version restoration with notes, and equality of browser window IDs before/after the complete sequence. Existing core/overlay tests are also run in Chrome.

Earlier successful browser evidence: output/chrome-1788683100866/results.json and output/edge-1788683101035/results.json. Final expanded navigation/pin checks are recorded below after completion. Visual review covered the collection-specific history dialog.

Release: output/neo-0.10.0.zip; extracted output/release-0.10.0-verified. Protocol 13 requires reloading Neo and refreshing existing library/overlay pages. User browser profiles and installed extension were not modified during testing.

Final extracted-release results: Chrome output/chrome-1788683257646/results.json (14 checks, zero exceptions); Edge output/edge-1788683257785/results.json (8 checks, zero exceptions). Both included navigation/pin/unpin and no-new-window assertions. All 102 unit tests passed.
