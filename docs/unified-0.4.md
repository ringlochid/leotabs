# Neo 0.4: consistent tab management

Research and implementation, 6 September 2026. This extends the existing extension; screenshots supplied by the user are bug evidence and visual references.

## Research and UX decisions

- Microsoft recommends an explicit Select control near the content, checkboxes in multiple-selection mode, commands scoped to the selection, and disabled commands when nothing is selected. Neo uses that pattern for live tabs and each saved collection. A saved collection has its own selection; selecting a group selects its members. Group names are edited inline. [Microsoft selection modes](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/selection-modes)
- Tabme documents Shift selection, group dragging, stashing and duplicate cleanup. Neo keeps those familiar operations and now shares the actual Sort, Save and duplicate controls between the library and switcher. Save offers a destination and an explicit Close tabs after saving checkbox, with the same preference and pinned-tab behavior in both places. This shared component is our implementation decision. [Tabme guide](https://gettabme.com/guide.html)
- The toolbar opens the library. Separate named commands open the visual switcher (Alt+Q), search only (Alt+Shift+K), and the library (Alt+Shift+L). Chrome permits users to reassign these; conflicts can leave a command unassigned. Settings links to Chrome's shortcut configuration. [Chrome commands](https://developer.chrome.com/docs/extensions/reference/api/commands), [Chrome action](https://developer.chrome.com/docs/extensions/reference/api/action)
- Open is additive: it creates fresh tabs in either the current window or a new normal browser window and preserves saved groups. Switch collection remains the separate save-and-replace workflow. The Open chooser supports all pages or a subset. Deferred loading stays available; selecting the new window's first page loads that page. [Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), [Chrome windows](https://developer.chrome.com/docs/extensions/reference/api/windows)
- The Windows-inspired switcher stays bounded over the current page. Search only omits the preview grid and collection dock. Both inherit Neo's light/dark preference. Preview cards do not expand to fill a whole panel when only one tab is present.

## Repairs

- The Open progress dialog used a close callback before its initialization. The callback is now invoked lazily, and opening runs against a persistent operation record.
- New groups default to Chrome's current window if no destination is specified. Restoring a collection to another window now supplies that window explicitly when grouping, preventing tabs from moving back to the original window.
- Ungroup calls the native tabs.ungroup operation for the selected grouped tabs. A versioned message protocol also detects an outdated worker paired with updated UI and provides a reload instruction. The old screenshot alone cannot prove whether a stale worker caused its Unknown action message.
- Per-collection Select supports Open, Group, Ungroup, Rename group, Move to another collection and Remove. Library mutations preserve link identities/notes and support Undo. Moving/removing a populated group's final member removes that empty group. Intentionally created empty groups remain.
- Shared dialog typography fixes the overlay's browser-default font mismatch. The overlay retains keyed preview elements so periodic refreshes do not replace unchanged images.

## Preview quality and performance

Capture preserves the source aspect ratio, never enlarges a small source, and caps the image at 960 × 720 pixels. Preview cards are at most 340 CSS pixels wide. JPEG capture quality is 85 and the stored WebP quality is 0.8. This is a measured engineering choice rather than a claim of universal optimality.

Capture is limited to an eligible active page, throttled to 1.1 seconds, and skipped for the search-only shortcut. The existing 50 MB cache budget, 14-day expiration, navigation-race guard and private-window exclusion remain. Neo does not visit background tabs to refresh their pictures. Older cached pictures improve when their pages are next captured. [Chrome captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)

## Verification

The browser harness loads the extension in a disposable headless Chrome profile with localhost pages. It exercises real storage, tab and window APIs, the Open chooser/progress flow, saved selection and Undo, shared Save controls, native Ungroup, duplicate cleanup, search-only Enter navigation, group dragging, note viewing and unchanged-preview retention. It checks command assignments and the production switcher entry module; it does not simulate physical OS shortcut delivery or alter the user's installed profile.

Final run results and screenshots are recorded under the project output folder. The preview check compares 480-pixel/0.7 and bounded 960-pixel/0.8 WebP encoding of one cached fixture page over five runs; this is a local sample, not a website-wide performance benchmark.

Release validation completed:

- All 66 unit tests pass. Syntax, entry points, generated bundle hashes and the no-mandatory-host-permission check pass for all 37 packaged files.
- The extracted ZIP passes 25 recorded Chrome checks with zero page exceptions. [Exact results](../output/chrome-1788667989729/results.json)
- The test includes collection Remove/Undo, overlay duplicate cleanup retaining a pinned original, and search-only Enter opening a fresh saved link. Shortcut assignments and the production entry module are covered; physical keyboard delivery is not.
- The final fixture sample retained 758 × 482 source pixels: 4,742 bytes and 42.5 ms median WebP encoding versus 2,498 bytes and 14.6 ms at 480 × 305. Decode/capture time is outside this encoding measurement, and real pages vary.
- All 37 extracted files match their inventory SHA-256 values. ZIP SHA-256: `5c58fcb44625fea7f5273dea107d95b57225167eff946d9953413f2019f52673`.
- [Search-only view](../output/chrome-1788667989729/search-only.png), [shared overlay Save](../output/chrome-1788667989729/overlay-save.png), [collection selection](../output/chrome-1788667989729/collection-selection.png).

## Updating the existing installation

Reload Neo's existing card at chrome://extensions and refresh its open library tabs. Keep the existing installation path to retain stored collections and shortcut settings. Check the three shortcuts in Settings → Configure shortcuts after updating from the old toolbar-action binding. No uninstall or data reset is needed.
