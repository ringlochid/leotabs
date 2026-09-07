# Auto-update, switching and creating an active collection

Audit date: 7 September 2026. Current working checkout, Neo 0.13.0. This covers the user-facing update/closure entry points and their shared capture code. It is not a claim to have exhaustively tested every browser crash or concurrent-window interleaving.


## Implemented save-flow follow-up

The user's later checkbox design supersedes the switch/save recommendations below. Save now contains only **and close them** and **and switch to new collection** (unchecked). They are mutually exclusive. Adoption requires all unpinned tabs in one window and preserves their native IDs, groups, order and form state. It follows the global tracking preference and supports Undo of the active association.

Both switch entry points use an unchecked **Save current tabs as a new collection** when unassigned, or **Update “source name” with current tabs** when a collection is active. Unchecked performs no additional source mirror at the switch boundary; ordinary auto-update may already have saved browsing before that boundary. Checked updates even a paused source once while retaining its paused preference. Timeline capture always occurs, and updates retain the previous collection version. A changed source identity rejects the stale dialog.

Saving returns immediately with **Saved on [time]**. A configured, permitted AI connection can asynchronously replace it with a short descriptive name plus the original save time. The result is discarded after a manual rename or changed contents; failed/unavailable AI retains the saved fallback. No name, destination, prompt or suggestions field is shown in Save.

Native Chrome and Edge checks cover adoption, stable browser IDs/form state/groups, global tracking preference, unchecked keep, checked update, explicit new collection, Timeline and asynchronous mock-provider naming. Additional Chrome checks cover adoption Undo and unassigned unchecked switching without new collections. Unit suite: 155 passed.

## Original audit findings and repairs

Normal live-tab grouping and sorting does update the active collection in the current checkout. The supplied screenshot alone cannot establish the state of the loaded worker, its prior pause state, or which older capture rules it used. The personal Chrome profile was not inspected.

Two concrete timing defects were fixed during this audit:

1. The collection-card Switch action always passed `preserveCurrent: true`, which skipped the outgoing collection's final mirror. Normal switching now flushes the outgoing collection; the capture code still respects an explicitly paused collection. Version-restore preservation remains separate.
2. Turning auto-update off could discard changes still waiting for the next checkpoint. Pausing now captures the final live state before disabling tracking. Global Off also flushes active writers before changing the global and per-collection flags. Stash uses this same pause boundary, preserving the full pre-close source.

The original audit recorded these gaps (the second is resolved by the follow-up above):

- Saved-card membership changes pause tracking with reason `Saved list edited`. This includes grouping, ungrouping, moves and removals, rather than applying the equivalent operation to live tabs. Thus a later sort may correctly leave a previously paused collection untouched. Live-sidebar group edits do not have this problem.
- `Save current tabs` in the switch modal means retaining a recovery session, not creating a durable collection or committing changes to a paused source. Returning to a paused saved collection opens its saved contents, not necessarily the modified browsing snapshot.

## Update and pause matrix

Assume auto-update is On and exactly one window owns the active collection, except where stated. Native = exercised in isolated Chrome and Edge for this audit. Existing tests/code = inspected shared implementation and existing tests; not newly replayed for every variant.

| Action or state | Current behaviour | Recommended contract | Evidence |
|---|---|---|---|
| Open a normal page | Add to active collection | Keep | Native |
| Navigate a tab | Mirror its new URL; preserve deliberate saved annotations where matched | Keep | Native URL check; code for annotations |
| Page title changes | Follow source title unless the saved title was deliberately edited | Keep | Capture/mirror code |
| Close an individual tab | Remove it from active collection | Keep, with recovery | Existing session tests |
| Close the last ordinary tab manually | Active collection can become empty | Keep; distinguish deleting tabs from closing a collection | Existing session tests |
| Close selected tabs / duplicates | Mirror remaining live tabs | Keep; Undo should restore native tabs and then mirror | Shared close/capture code |
| Group & sort | Mirror native grouping and order without pausing | Keep | Native |
| Automatic local website/rule grouping | Checkpoint groups first, then captures the collection | Keep | Background checkpoint code; previous grouping checks |
| Topic AI / combined collection AI | Apply native layout and capture at operation boundary | Keep; no background regroup reversal | Previous native AI checks; current shared capture audit |
| Drag between groups / out of a group | Mirror native membership and order, keep On | Keep | Native operation check; separate real-mouse checks |
| Move a native browser group | Mirror new group order | Keep | Native |
| Rename, recolour or collapse a native group | Mirror group metadata | Keep | Native |
| Pin a tab | Exclude it from the active collection's window session | Keep; pinned tabs are outside the working collection | Native |
| Unpin a tab | Include it again | Keep | Native |
| Move a tab between windows | Each eligible active owner captures its new tab set | Keep; unassigned windows do not alter a saved collection | Event and capture code |
| Select, hover, search or change sidebar display sorting | No saved-content mutation | Keep; display order is different from moving browser tabs | UI code |
| Change collection name, colour or note | Update metadata, keep tracking | Keep | Native note check; edit code |
| Edit membership/grouping inside an active saved card | Pause with `Saved list edited` | Change: operate on native tabs and saved collection together; keep On after success | Native reproduction of the gap |
| Edit an inactive collection | Edit the saved collection; no live mirror | Keep | Edit/checkpoint code |
| Pause current collection | Final capture, then no later mirroring | Keep; repaired final capture | New regression test + native pause checks |
| Resume current collection | Capture current window immediately; preserve prior collection version | Keep, but make replacement of the saved snapshot clear | Native + session code |
| Global Off | Flush active writers, disable tracking for all collections | Keep; repaired final capture | Native flags; code + shared pause test |
| Global On | Enable collection flags and one writer per active collection, capture live state | Keep | Native + duplicate-owner unit test |
| Stash some or all tabs | Save the stash, flush and pause affected active source before closing tabs | Keep for now; never mirror the destructive intermediate remainder over the full source | Native partial stash + unit test |
| Switch A to B, A On | Final capture into A, then replace tabs and activate B | Keep; no extra collection | Native + repaired UI path |
| Switch A to B, A paused | Leave A unchanged; preserve recovery snapshot | Keep source unchanged unless user explicitly chooses an outgoing save destination | Session code |
| Switch while no collection is active | Recovery snapshot; no new durable library collection | Offer explicit Save as new collection when wanted | Session code / existing switch tests |
| Destination auto-update Off | Destination is active with tracking paused | Keep; switching should not silently override that choice | Session/UI code |
| Open collection using ordinary Open in same window | Detaches prior active session before opening a copy; takes a recovery snapshot without final mirror | UX gap: specify copy/append semantics; do not silently lose the active relationship | Resume-start code |
| Open in new window | Source window remains independent; opening alone is not a saved-window adoption action | Keep, with explicit activation if desired | Resume code |
| Close current collection | Final capture when On, detach before closure, preserve saved contents | Keep | Native + failure tests |
| Close all | Recovery capture without final collection mirror, detach, then close | Consider aligning with Close current collection: flush On, then detach. This audit preserves its existing no-update semantics | Code + existing close-all tests |
| Close native browser window | Forget active owner; retain prior durable collection and recovery | Retain last successful capture; no claim of a final flush during forced shutdown | Event code |
| Version restore / incomplete switch or close | Preserve prior data; incomplete operations pause with reason | Keep; recovery must be visible | Existing failure tests/code |
| Same collection in two windows | One writer; the other cannot overwrite it | Keep; explain the read-only/paused copy | Existing ownership unit test |
| Paused collection while sorting/dragging live tabs | Saved contents remain unchanged | Keep; On/Paused must reflect effective state, not global preference alone | Native pause check / capture code |
| Storage error | Capture can fail; background checkpoint catches and retries later | UX gap: show Update failed / Retry rather than only On | Checkpoint error path |

Web Store URLs are ordinary saved pages. Internal new-tab/settings/extension utility pages may be closed during collection operations but are not saved as collection links. Neo and holding surfaces, pinned tabs and private windows are outside normal capture. These are capture rules, not reasons to pause the entire collection.

## Recommended switch UX

Do not silently create another collection every time the user switches. Separate three outcomes: updating an existing collection, making a new durable collection, and retaining temporary recovery.

- **Current collection On:** finish saving A, then switch to B. No save checkbox is necessary. Failure to save should stop the switch.
- **Current collection paused with different live tabs:** offer a compact explicit choice: **Keep saved A unchanged**, **Update A once**, or **Save as new collection**. Default to keeping A unchanged to respect Pause. Updating once must not turn continuous tracking back on.
- **No current collection:** offer **Save as new collection** when the user wants durable storage; otherwise retain recovery and switch.
- **No changes:** omit outgoing-save controls entirely.

If a checkbox is retained, make its destination explicit: `Save current tabs to: [A / New collection]`. An unchecked box means no durable save, not no recovery. Avoid the present generic `Save current tabs` label.

Recovery remains a safety net with retention limits (currently 200 timeline entries and a 30-day age cleanup), not a substitute for an explicit saved collection. The user should never need to understand hidden `parked` records to predict where work will reappear.

## Save current window as a new active collection

Recommended action: **Save as active collection**, in the existing sidebar Save control's menu. It is especially useful when no collection is active.

The operation should adopt the current window: capture all eligible unpinned tabs, create a collection, and bind this same window to it. Do not call the ordinary switch/open routine: reopening tabs would unnecessarily lose live forms, navigation and loading state. Preserve native tab IDs, order, groups and selected tab. Apply the global auto-update preference; activation and automatic updating are distinct choices.

If another collection is active, flush it first when On; preserve it when paused. Then create and bind the new collection with a recoverable operation record. Saving a selected subset should remain a normal saved collection operation: binding an entire window to only a subset would cause the next mirror to pull in the other tabs unexpectedly.

These original recommendations were superseded by the implemented checkbox flow above.

## Research basis

- [Partizion auto-updating collections](https://www.partizion.io/guide/auto-updating-collections) explicitly distinguishes reference collections (auto-update Off) from working project sessions (On). This supports retaining a deliberate paused state rather than treating it as an error.
- [Workona tab management](https://workona.com/help/tab-manager/) documents autosaving working spaces and restoring them after closing, with pinned tabs persisting during switching. [Workona resources](https://workona.com/help/resources/) are a separate deliberate saved-resource concept. Neo can make the same distinction through clear outcomes without introducing another entity.
- [Microsoft Edge Workspaces](https://support.microsoft.com/en-us/edge/getting-started-with-microsoft-edge-workspaces) frames a workspace around returning to related project tabs. It supports the task-continuity rationale for adopting a current window; the exact Save as active collection design above is a Neo recommendation.
- [Chrome tabGroups events](https://developer.chrome.com/docs/extensions/reference/api/tabGroups#event-onMoved) confirm that moving a group also emits individual tab move events. The missing update is not explained by absence of a separate group-move listener alone.

## Verification and limits

- 152 unit tests passed, including a regression that failed before the pause-boundary fix.
- Dedicated isolated Chrome and Edge audit runs passed the native scenarios above: `chrome-1788768669990` and `edge-1788768753161` under output.
- The saved-card grouping pause is an observed remaining gap, not reported as a passing UX requirement.
- Existing failure, duplicate-owner and switch tests were rerun with the unit suite. No personal profile, API key, cloud provider or crash simulation was needed for this audit.
- No claim that every timing race, operating-system shutdown or storage failure was reproduced. The next structural improvement should make saved-card edits on an active collection use the same native operation path as the sidebar.
