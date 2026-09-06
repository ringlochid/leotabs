# Neo 0.5: direct collection actions

6 September 2026. This update follows the user's Tabme screenshots and replaces the 0.4 chooser-based everyday flows.

## Decisions and evidence

Tabme's guide describes stashing open tabs into a new folder and rearranging folders by their headers. The supplied screenshots establish the exact requested checkbox/Stash/Cancel flow, direct Open All commands, and insertion line during reorder. Neo now uses those interactions with its own collection terminology. [Tabme guide](https://gettabme.com/guide.html)

Anchored menus use menu roles and labelled triggers, arrow/Home/End navigation, and Escape to dismiss and restore focus. They do not dim or block the board. [WAI-ARIA menu button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)

## Changes

- Collection, group and link ellipses open compact lists. Export choices are a list too; link editing is an anchored form. Create collection and Rename stay inline. Substantive Settings, Import, Switch and AI review forms remain dialogs.
- Open all immediately opens fresh tabs in the current window. Open in new window immediately opens them in a new window. There is no opening chooser or progress modal. Collection Select opens a subset. A notification reports completion and exposes Cancel while an open operation is running.
- Stash always creates a new collection, offers “and close them,” and shows Stash tabs and Cancel. There is no destination selector in either library or overlay. Dragging is the route for saving into an existing collection. Pinned tabs remain open and destructive changes retain recovery/Undo.
- Collections persist their folded state, including through backup import. Expand becomes Restore and returns to the board. Both controls retain the same 28-pixel button size and subdued hover treatment.
- Selection actions are icon-only with titles and accessible names. The sidebar strip is above the tabs, collection actions are above saved links, and rows have spacing with inset keyboard focus treatment.
- Dragging a collection header produces a colored header preview, dims its source and draws a before/after insertion line. Dropping does not suggest merging into the highlighted collection. The existing native-group and saved-group drags remain supported.
- Organise with AI is visible in the library header and collection menu. It opens the existing organisation workflow: select saved links, give an instruction, generate a plan, review/edit proposed groups, and apply selected changes. Gemini or a compatible endpoint/model/key is configured in Settings → AI connection. Opening this UI sends no external request. Hosted provider success is not claimed by this UI verification.

## Verification

The test harness uses disposable headless Chrome profiles, local fixture pages, real native drag events and browser storage/tab/window APIs. It checks direct current/new-window opening, new-collection Save with keep-open, persistent folding, fixed-size Restore, menu focus/Escape, compact selection geometry, before/after drag insertion, and AI entry/setup. It also covers existing Ungroup, Undo, note previews, search-only opening and preview stability. Physical OS shortcut delivery and the user's everyday browser profile are outside these tests.

Final validation: **67 unit tests pass; 28 recorded Chrome checks pass with zero page exceptions**, using the extracted final ZIP. All 37 extracted files match their package inventory hashes. No user data or installed profile was reset.

- [Chrome results](../output/chrome-1788672461456/results.json)
- [Collection menu](../output/chrome-1788672461456/collection-menu-05.png)
- [Compact selection strip](../output/chrome-1788672461456/selection-strip-05.png)
- [Drag insertion](../output/chrome-1788672461456/drag-after-05.png)
- [AI entry and setup](../output/chrome-1788672461456/ai-entry-05.png)
- [Package](../output/neo-0.5.0.zip), SHA-256 `9b58c2f515dcd17258c8519c51b163dec8ea32be5d50d81960d5f8b551b2e74a`.

Reload the existing Neo card at chrome://extensions, then refresh its library pages to use 0.5. Keep the existing installation path and stored collections.
