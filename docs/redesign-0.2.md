# Neo 0.2 — organization and switcher corrections

The user's Tabme and Notion screenshots establish the visual and interaction direction: quiet page chrome, colored collection headings, actions next to their content, immediate creation and optional inline naming. The Windows Task View reference establishes a viewport-sized preview surface with readable groups. This revision replaces the previous name-only dialogs and small action popup.

## Changes

- Space → collection → optional group → saved link. Existing data gains a default space without changing saved IDs. New spaces start empty; the final add row creates the first collection. Collection options move it between spaces. Empty spaces can be removed, keeping at least one.
- Collection, saved-group and native browser-group creation happen immediately. The title is focused inline; Enter saves, Escape ends renaming. Live refresh preserves unfinished names and focus.
- Saved links have a hover/focus remove button and Undo. The broom shows the number of redundant tabs and closes those candidates while retaining the pinned/active representative.
- Save tabs and Switch collection are visible on the library and switcher. Save uses a compact destination popover. Switching saves all unpinned tabs in the current window into a new or existing collection before preparing the chosen destination. Source tabs close only after successful preparation. Partial results remain recoverable.
- Alt+Q retains the existing registered action shortcut, but the toolbar action no longer owns a small popup. It injects a closed-shadow-root overlay across a normal page's viewport. Protected browser pages use a maximized extension window associated with the original browser window.
- The same search controller handles `@collection` and `/commands` in both surfaces. A selected collection returns only its saved links, never extra live/history copies. Existing live pages may still be reused when opening a saved link.
- Group tiles display a full-size representative page image with a stacked border, group icon and count. Selecting a group reveals its member tiles. Previews and List are labeled view controls; Library is a separate labeled action.

## Platform decisions

Checked Chrome 152 / Node 22, with the existing minimum Chromium 123. The [Chrome commands documentation](https://developer.chrome.com/docs/extensions/reference/api/commands) confirms that `_execute_action` invokes the action handler and preserves its configurable shortcut. The [activeTab documentation](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) establishes the user-invoked temporary access used for capture and injection. [Content-script isolation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) keeps extension JavaScript separate from page JavaScript.

There is no web-accessible privileged iframe. Overlay RPC uses an unguessable capability bound to the initiating tab's document ID and limited lifetime, stored in extension session storage. The page cannot read the closed shadow DOM. Credential/connection screens open in the extension library. A slow preview capture is bounded; mounting invalidates late results so the overlay cannot be cached as the underlying page. No additional mandatory website permission was added.

The overlay is bundled locally with pinned esbuild 0.25.10. Its source is packaged, and the build records source/output hashes; package checks reject a stale bundle. No runtime server or remote code is required.

## Verification

- **61 unit/contract checks pass.** This includes strict collection scope, legacy space migration, backup membership, tab replacement, document-bound overlay access, and rapid shortcut toggling.
- **18 Chrome checks pass against the extracted release ZIP**, with no page exceptions: `output/chrome-1788661726322/results.json`. These cover the real action handler and registered Alt+Q shortcut, full viewport mounting, real group previews, protected-page fallback, inline collection/group/native-group naming, space persistence/isolation, remove/Undo, duplicate count/close, save-to-existing, replacement and space-aware backup import.
- **34 packaged files pass syntax, entry point, asset and source/bundle freshness checks.** ZIP extraction independently matches every file hash: `output/package-verification.json`. Package: `output/neo-0.2.0.zip`, SHA-256 `f4018363658e7d98483f3fde26ebd8d358c532c4ccb5f144eb56792c2ed68ddd`.
- Additional broader-run evidence is retained in `output/chrome-1788660645671/progress.json` (32 completed checks) and `output/chrome-1788660787859/progress.json` (19 completed checks). These include standalone commands, adapter/review flows, actual worker interruption/restart, database migration and a 15,023-link library. These were not completed full-suite runs: a later bulk-fixture cleanup exceeded the harness's 15-second call deadline. Cleanup is now batched, and ordinary tab closures no longer issue unnecessary overlay-storage writes. No refreshed 500-tab performance claim is made for this revision.

Test harness readiness checks were changed from fixed short sleeps to actual document, navigation and control readiness. Closing a fallback window is verified from a surviving extension context rather than waiting for a response from the destroyed window. These are test-driver corrections, not claims about Windows shortcut latency. The earlier 0.1 report remains historical.

Tests use disposable Chrome profiles and local pages. They exercise Chrome's real extension action API and check that Alt+Q is registered; they do not operate the user's Windows keyboard or personal Chrome profile. Existing users reload the same unpacked installation at `C:\Users\ring_\Desktop\Neo tab manger\extension`, then refresh the library page. Selecting the project root itself in Load unpacked will not work; the release ZIP has a root-level manifest.
