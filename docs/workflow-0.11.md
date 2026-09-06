# Neo 0.11 workflow work

Requested: rules including github.com/* → Github; optional AI grouping and naming;
direct open/replace/close without unwanted collection updates; current collection
name/colour and close control; custom colours; utility-tab cleanup; drag-to-create;
meaningful Timeline; remove redundant Save/Switch/Update controls.

Research: Chrome action.setIcon supports per-tab ImageData and title; tabGroups
uses nine named colours, while local collection colours can use RGB. Native HTML
colour inputs provide a platform picker without another modal. Partizion distinguishes
reference collections from working sessions. Tabme documents dropping onto New Folder.

Sources checked 7 September 2026:
- https://developer.chrome.com/docs/extensions/reference/api/action
- https://developer.chrome.com/docs/extensions/reference/api/tabGroups
- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/color
- https://www.partizion.io/guide/auto-updating-collections
- https://gettabme.com/guide.html

Implemented workflow:
- Search and Settings stay upper right beside the spaces. AI and current collection occupy the row below. Current collection shows name, colour, Auto-update and Close. Close is absent from collection cards: each card shows Open, New window and Switch to collection on one line; switching is disabled on the current card. The library logo, favicon and toolbar icon follow its colour.
- Auto-update shows On/Paused and applies immediately. Resuming mirrors current tabs; pausing freezes saved contents. Settings applies On/Off globally to all existing and new collections, including open sessions. The current collection switch can still pause or resume that collection. Replace respects the destination preference.
- Replace asks whether to save the outgoing session, checked by default. Cancel changes nothing. Unchecking skips a retained session shortcut; Timeline recovery remains available. Pins stay open; utility pages close without entering saved links.
- New collection accepts drops without changing height on hover. Live redraws wait until dragging ends; scroll is preserved after a drop.
- New, saved and drop-created collections choose a random palette colour at creation; consecutive saves avoid repeating the preceding colour. Duplicates get a colour different from their source. Existing/custom colours and imported colours remain stable. Verified with `--collection-colours` in output/edge-1788710687017 (no runtime exceptions), plus 48 core/workflow unit checks. The unrelated full workflow run encountered its timing-sensitive burst assertion; this change's focused creation and persistence checks passed.
- Rules start with github.com/* => Github and preserve manual grouping. Optional AI plans are reviewed; automatic naming is separately opt-in for new collections and unnamed saved/native groups. Later manual renames and membership changes invalidate pending naming results. Custom RGB colours survive validation and reload.
- Timeline operation snapshots are separate from native Recently closed entries. Redundant Save/Switch/Update controls are removed.

Additional research:
- https://primer.style/product/components/toggle-switch/guidelines/ — explicit state and immediate effect.
- https://www.nngroup.com/articles/toggle-switch-guidelines/ — no extra Save step.
- https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Drag_operations — drag source lifecycle.
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_anchoring/Overview — layout changes can adjust scroll.

Responsive updates use 120 ms batches rather than waiting for 1.8 seconds of silence. Events during a running checkpoint request one follow-up; checkpoints remain serialized with tab operations. The library coalesces refreshes at 60 ms and skips grid redraws when library revision and active session state are unchanged. Reference: https://developer.mozilla.org/en-US/docs/Glossary/Throttle.

Validation: 125 unit tests pass; 50-file package source check and ZIP creation pass. Chrome native run output/chrome-1788709185310 verified responsive updates, including uninterrupted tab-event bursts. Edge run output/edge-1788709293642 verified the global On/Off setting across existing/new/open collections, layout at 1440/900/390 px, pause/resume, Replace confirmation and native drag under background updates, with no runtime exceptions. Measured creation to persistence and visible card was 289 ms in Chrome and 359 ms in Edge fixtures; these are local measurements, not universal latency guarantees.

Final terminology: **Switch to collection**, with **Switch to [name]?** confirmation, describes changing the active work context. Sources: https://workona.com/help/tab-manager/ and https://support.microsoft.com/en-us/edge/getting-started-with-microsoft-edge-workspaces. Earlier references to Replace describe the same operation before this label correction.

Completion audit, 7 September 2026:

| Requirement | Current evidence |
| --- | --- |
| Default GitHub rule; AI optional | tests/workflow.test.mjs verifies exact rule and lookalike rejection; native workflow verifies automatic grouping and manual ungroup preservation without credentials. |
| Optional AI names for collections and groups | scripts/check-ai-workflow.mjs exercises real worker requests to a local mock provider: AI-off sends nothing, new collections and saved/native groups are named, manual names are protected, subsets and cancellation work; actual review dialog edits names and placement before Apply. |
| Direct open, separate window, switch, close; no unwanted updates | Native workflow checks original tabs preserved when opening a new window, saved notes retained while paused, utility-only close, switch confirmation/Cancel/save choice and same-window switching. |
| Current collection identity and colour panel | Native workflow checks custom RGB persistence after reload, page identity, toolbar title, current control, themes and 1440/900/390 px layout. Screenshot inspection confirms the coloured library mark. User screenshots also confirm toolbar recolouring. |
| Global auto-update plus per-current pause | Existing/new/open collections all receive global changes; actual tab changes mirror when enabled, remain saved while paused, and survive reload. Unit test proves a single writer when the same collection is open twice. |
| Drag/drop and responsive updates | Real browser drag keeps its DOM and scroll through a background event, target height stays constant, new collection accepts drops. Continuous creation updates before the burst ends and preserves the final event. |
| Latest card actions | Three actions remain on one row without overflow at all tested widths; no Close action in the card or duplicate menu entries; New window opens its real destination separately. |

Final Chrome run: **output/chrome-1788710121207/results.json**, 34 checks, zero runtime exceptions. Edge AI/workflow run: **output/edge-1788709957599/results.json**, 28 checks, zero exceptions. Final unit suite: **125/125**. Final package: **output/neo-0.11.0.zip**, all 50 entries verified byte-for-byte against current extension source. AI tests use a fixture copy with localhost host access and a local mock provider; no personal credentials or external AI service were used. The work remains uncommitted; the previously requested 0.10.6 commit/push is separate.

Toolbar colour repair, 7 September 2026:

- Chromium resets per-tab action state during navigation, but Neo cached only the collection name/colour and skipped restoring it. The native Edge regression failed before repair with `navigation reset the toolbar identity and Neo did not restore it`. Reference: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/setIcon (tabId navigation reset).
- Navigation/loading/completion, activation, attachment and replacement now invalidate the tab's identity. Updates are batched at 50 ms and serialized with fresh state reads. Failed browser writes and invalidation during an in-flight write remain retryable. Each window retains its own collection colour.
- `npm test`: 126/126 pass, including actual icon-payload colour selection, window isolation, failed-write retry and in-flight invalidation. Native `--toolbar-identity` checks pass in Edge (`output/edge-1788711512492/results.json`) and Chrome (`output/chrome-1788711575707/results.json`), without runtime exceptions. Native checks use action title restoration as the readable per-tab browser-state signal; colour payloads are checked by the unit test, not a screenshot of toolbar pixels.
- The wider diagnostic runs hit unrelated setup/overlay timeouts before the focused assertion. The focused flag now skips those unrelated workflows. Package rebuilt successfully: 50 files, `output/neo-0.11.0.zip`.

Stash/auto-update repair, 7 September 2026:

- Reproduced the supplied recording: a partial stash removed the stashed link from the active collection at the next checkpoint; stashing the remaining tabs could empty it. Tab removal events continued to feed active mirroring (https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onRemoved).
- Stash now saves durably, pauses the affected active collections, then closes the captured tabs, all on the existing serialized operation queue. Partial stashes also pause; save-only leaves tracking unchanged. The existing current-collection control displays Paused. Utility-only stashes follow the same guard. If saving or pausing fails, no captured tabs are closed.
- Validation: 62 core/session tests pass, including persistence-before-pause-before-close, failure paths, utility tabs, unaffected windows and checkpoints after partial/complete closure. Native `--stash-safety` passes in Edge (`output/edge-1788711861361/results.json`) and Chrome (`output/chrome-1788711952405/results.json`), with no runtime exceptions. These exercise actual worker save/stash requests and confirm the visible Paused state and preserved original/stashed contents.
