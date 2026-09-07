# Neo UI refresh — 7 September 2026

This implements the user's Tabme reference direction in the existing extension: flatter surfaces, readable text, compact controls and reliable dragging. The seven supplied recordings were decoded and reviewed, including Tabme at 18:29:14, 18:31:22 and 18:31:48. Contact sheets are in `output/ui-refresh/references/`.

## Visible changes

- A 360px tab sidebar at desktop widths, with the sorting, saving, duplicate cleanup and selection controls beside **Open tabs**. Sorting uses the three descending bars; rules remain in Settings.
- Shared Segoe UI typography: 15px page content, 14px controls, 13px secondary text. Toolbar buttons are 36px, with 40px tab rows. Light and dark colours have stronger secondary-text contrast.
- Flat collection bodies and coloured title strips. Repeated timestamps move into title tooltips. Open and Switch remain directly available; opening a new window moves into collection options. The current collection retains its indicator and auto-update control.
- **Close all currently open tabs** replaces the ambiguous short label. Its tooltip states that pinned tabs stay open; the action is disabled when there are no eligible tabs in the current window.
- Grouping rules use clearly labelled switches, compact presets and expandable rule editors. Advanced conditions and website suggestions are collapsed. Explanatory copy is shorter.
- The shared typography also applies to settings, popovers, save/switch dialogs and the injected overlay. Dialogs retain flat borders and no shadow. Narrow layouts reflow without horizontal scrolling.

## Dragging

Previously Neo relied on the browser's native drag scrolling; it had no extension controller for the independently scrolling panels. On the committed baseline `a1b2c33`, a real tab drag held 45px inside the sidebar's lower edge did not scroll (`output/chrome-1788771598697`). The inset deliberately avoids relying on Chrome's narrow physical-edge behaviour. An earlier baseline attempt measured only main-panel scrolling and is not used as evidence.

`extension/ui/drag-scroll.js` now runs a frame loop while a native Neo drag is active. It scrolls the sidebar or collection board near their top/bottom edges, including while the pointer is stationary. Speed increases toward the edge. It stops away from the edge, on drop, cancellation or window blur. The source DOM stays in place until the operation finishes.

Saved-link insertion lines, saved-group targets and collection insertion markers track the destination during scrolling. Reordering uses a short positional animation; animations pause while the pointer is held and honour reduced motion. Browser-native tab-strip animations remain controlled by Chrome/Edge.

## Verification

Tests used isolated browser profiles and local fixture pages. No personal browser data or credentials were accessed.

| Check | Result / evidence directory |
| --- | --- |
| Native sidebar scrolling down/up, stationary hold, centre stop and cancellation | Chrome `chrome-1788772568247`; Edge `edge-1788772434377` |
| Collection drag, saved-link insertion and whole saved-group movement after scrolling | Same runs; all 18 collections and 108 saved links preserved |
| Animation pause/resume and reduced motion | Chrome `chrome-1788772568247` |
| Native group changes, multiple selected tabs, ungroup, reorder and Undo | Chrome `chrome-1788772290298` |
| Native title/website/recent sorting, pinned/group preservation, active collection update and Undo | Chrome `chrome-1788772308506` |
| Minimal save, adoption without reopening, outgoing switch options, timeline recovery and late AI naming guards | Edge `edge-1788772059718` |
| Selection, deselection, unhover, keyboard selection and collection removal/Undo | Edge `edge-1788772309007` |
| Injected overlay, native sorting through its menu, group editing, scopes, light/dark dialogs and 620px layout | Chrome `chrome-1788772538117` |
| Unit suite | 155 passed; `output/ui-refresh/unit-results.txt` |

Library screenshots cover 1440px light/dark, 1920px and 390px. Rules and expanded editors were visually inspected in both themes, with a separate 390px modal capture. Measured rules-dialog foreground/background contrast exceeds 4.5:1 in both themes, including secondary text and the primary action; detailed ratios are in `contrast-light.json` and `contrast-dark.json`. This is a bounded contrast check, not a claim of complete accessibility certification.

Final screenshot examples: `output/chrome-1788772568247/library-dark.png`, `rules-light.png`, `rules-390.png`, and `saved-link-drag.png`. These are screenshots of the running extension with fixture data.

The interaction design follows the supplied recordings. Supporting references: [native drag event lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Drag_operations), [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), and [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Reload the unpacked extension in Chrome/Edge's Extensions page and refresh the library to load the new UI. The rebuilt ZIP is `output/neo-0.13.0.zip`.

## Insertion bars and control geometry follow-up

The user's 3.95-second follow-up recording exposed two positions for the same collection boundary. The old code placed the line 10px outside each card independently, inside a 28px gap, and capped its height at 100px. The baseline native reproduction confirmed different left/right approach geometry and stretched swatches in both themes (`output/chrome-1788773117804/marker-geometry.json`).

The new shared insertion indicator belongs to the gap. Both approaches resolve to the same insertion ID and centre line, including grid row wrapping and list layouts. Expanded neighbours produce a longer vertical line; folded neighbours shorten it. The line is clipped to the visible scrolling panel. Board gaps accept drops directly, and the committed destination uses the same calculation as the displayed bar.

Native tabs and saved links now use the same 2px line above/below the row. Bottom-half drops insert after the row; the native operation now supports that position, including the end of an existing group. The protocol changed to 21 so stale worker/UI combinations request a reload instead of silently ignoring the new position.

Swatches now have a square 36px target and a circular 24px colour sample. Their colours match the collection colour, the checkmark updates immediately after choosing a colour, and the custom colour/hex fields stay aligned in one row. Default menu focus goes to the first action, avoiding the misleading initial focus ring on an unselected colour. Geometry checks also found and fixed space-options and saved-group-options buttons stretched by the shared minimum height.

The CSS cause is consistent with [MDN's min-height definition](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/min-height): a minimum height can exceed an explicitly smaller height. The native drag lifecycle was checked against the MDN reference linked above; the fix stays within the existing browser drag event and persistence contracts.

Verification includes native mouse drags, identical geometry from either approach, expanded/folded/list markers, saved/native persisted positions, native group-end insertion, cancellation and Undo. Chrome (`output/chrome-1788773650460`) and Edge (`output/edge-1788773711304`) checks passed. The Edge run also verifies saved-link insertion against persisted order. Screenshots include `collection-boundary.png`, `collapsed-marker.png`, `list-marker.png`, `native-tab-insertion.png`, `saved-tab-insertion.png` and `controls-390.png` in the corresponding evidence directories. Control geometry checks cover square targets, centred icons, circular swatches and menu overflow at 1440px and 390px. Palette screenshots were visually inspected in light and dark themes.

The broader scrolling regression passed again in Chrome (`output/chrome-1788773737037`), including stationary edge scrolling, saved groups, exact insertion, reduced motion and animation pause/resume. Native multi-tab grouping/ungrouping and Undo passed (`output/chrome-1788773711304`). All 159 unit tests passed (`output/drag-polish/unit-results.txt`).

Final expanded Chrome run: `output/chrome-1788773846352` passes all marker, saved/native order and control geometry checks. The rebuilt injected overlay regression also passes (`output/chrome-1788773846349`). The 66-file ZIP passes CRC checks and matches every extension source byte.

## History rows and lazy Open follow-up

Removed the repeated Open/Reopen/Switch text from individual recent/history/timeline rows, including the injected overlay's session rows. The whole row remains a labelled, keyboard-accessible button. Opening one historical page activates that page; bulk Restore remains a separate action.

Collection Open and Open in new window now explicitly request deferred opening through the same parked-page mechanism used by Switch. A new window retains Neo's library as its active tab, preventing removal of an empty guard tab from activating and loading the first website. Existing tabs, saved groups and the source collection are preserved. Open in the current window retains its previous snapshot/detach behaviour. The Close all enabled state now follows live tab changes even when the saved board has not changed.

Each library load starts with This window, including installations with an older All windows preference. All windows remains available as a per-view choice; the quick overlay already starts with This window. Protocol 22 ensures the updated UI and worker agree on the deferred-opening result.

The opening path was checked against the [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs): creating a background tab alone is insufficient to prevent its destination loading, so the existing local parked page is used. Native checks in Chrome (`output/chrome-1788774411631`) and Edge (`output/edge-1788774448660`) observed zero requests to all three fixture destination URLs after each Open action, followed by a request only when a tab was activated. They also verified group preservation, existing tabs/source collection preservation, history-row clicks, and the default window scope. The rebuilt overlay regression passes (`output/chrome-1788774472434`); all 159 unit tests pass (`output/lazy-open-unit-results.txt`). Recent and timeline screenshots were visually inspected in the Chrome evidence directory.

## Built-in grouping only

Removed all custom grouping-rule editors and menu entries. Grouping uses the shipped defaults and website fallback, including for older libraries and imported settings. Auto-group on/off, AI topics and direct group editing remain available. Settings and migration checks cover legacy custom rules and disabled website grouping.

## Keyboard-ready tab switcher

The switcher opens with a tab focused. Slash focuses search without entering text; arrow keys move focus into and between live tab previews from the toolbar or search in This window and All windows. Search-only mode still starts in search, and inline rename keeps its editing keys.

The visible toolbar reuses Library controls for Group & sort, AI topics, native sorting, Save and Close duplicates. Sort, Save and Duplicates sit between Audio and Select. Switcher action panels are centred within the switcher while menus remain anchored to their buttons.

Verified in the isolated Chrome injected overlay: real slash/arrow input, preview and list navigation, native title ordering, centred Save geometry, light/dark dialogs and narrow layout. Edge's existing harness checks the Library/package path only; it does not run the injected overlay checks. All 159 unit tests pass.

## Collection Group & sort

Collection menus no longer expose the Organisation policy editor. Group & sort sits immediately above Organise collection with AI, replacing Apply default grouping. It groups saved links by the built-in website defaults and sorts groups and links alphabetically; the include-existing-groups checkbox controls regrouping. Single links remain ungrouped, notes and names are preserved, and the operation supports Undo. Active tracked collections use the native grouping path so browser tabs and the saved collection update together.

Validation: 161 unit tests; isolated Chrome collection menu, saved grouping/sorting/Undo and active browser/collection grouping/Undo checks passed.

## Topic grouping in the injected switcher

The 20260907-1134 recording shows Topic Apply failing with an undefined permissions.request call. Reproduced in an isolated Chrome content script before the fix (`output/chrome-1788781127698`). Chrome exposes only selected extension APIs to content scripts; permissions requests belong in an extension context ([content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)).

Topic Apply now asks the authenticated background handler whether the configured provider origin is allowed. Existing access proceeds directly; missing access or connection setup opens Library AI connection settings. The provider operation still independently enforces permission. Library Apply keeps its user-gesture permission request. No real API key or provider was used for validation.

After-fix injected-overlay test (`output/chrome-1788781316745`) verifies one local provider call, native grouping, Undo, and missing-permission navigation without a request. Library include/exclude and stable-grouping checks passed (`output/chrome-1788781273675`); all 161 unit tests passed.
