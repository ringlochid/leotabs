# Neo 0.9.0: collection updates and quick access

## Research and decision

Reviewed the official product documentation on 6 September 2026:

- [Workona tab manager](https://workona.com/help/tab-manager/) describes autosaved open tabs and returning to active work. [Resources](https://workona.com/help/resources/) are explicitly saved references, with custom names and separate open-all/open-only operations.
- [Session Buddy](https://sessionbuddy.com/) is the source of the supplied collection reference: pinned collections, created/updated ages, colours, text import, and duplicate detection. Its history is a separate recovery feature.
- [Toby: saving tabs](https://help.gettoby.com/support/solutions/articles/66000521573-how-do-i-save-tabs-into-collections-) uses explicit save and drag/drop actions.

These sources establish product behaviour, not a controlled usability comparison. For Neo, the recommendation is to preserve the distinction between active tabs and curated saved links. Existing collection swapping already retains live work. Silently replacing saved links whenever a tab closes or navigates would make a saved reference collection unreliable.

## Implemented

- Collection menu: **Update from current window** previews new URLs, initially selects them, and lets the user choose which to add. The overlay exposes the same dialog as **Update collection**.
- Only eligible unpinned pages in the source window are candidates. New duplicate URLs appear once. Existing saved duplicates are left intact. URL matching is exact after the model's URL normalization; distinct query strings are not merged.
- Saved IDs, titles, notes, and groups are preserved. A live group overlapping one saved group adds its new members there. Otherwise a new group retains the browser group name and colour. Groups are not merged merely because their names match.
- A changed library revision or changed tab/group signature requires a fresh review. Updates use the existing transactional edit and Undo journal. They keep browser tabs open.
- Active collections show a compact **N new tabs** shortcut to the review dialog.
- **Pin collection** gives stable pinned-first ordering in the library, overlay, and collection switch picker. Manual order is preserved within each section; unpinning returns to the stored order. Pin state survives reload and validated JSON import/export.
- Collection cards show **Created/Updated** age with an exact timestamp tooltip. Folding, pinning, and card reordering do not change the saved-content date. Content edits and accepted organisation changes do.

This is an additive update, not automatic replacement or browser-session synchronization. Existing Open and Swap behaviour remains. Importing arbitrary text, automatic merging of renamed pages, and timestamp sorting were not added: each would introduce a separate workflow beyond this focused change.

## Validation

91 unit tests pass, including new update planning, selected subsets, duplicate handling, group mapping, stable pin ordering, imported pin/date preservation, age labels, and stale tab signatures.

Chrome checks use a disposable profile and the extracted release package. They cover shared library/overlay review dialogs, Cancel, selected additions, stale library/tab previews, preservation of saved content and browser tabs, Undo, persistent pin ordering, content timestamps, and the active-collection update shortcut. Existing core extension and overlay/group interactions are also exercised. Final run: `output/chrome-1788679173926/results.json` has 14 passed checks and zero browser exceptions. Inspected screenshots: `collection-update-review.png`, `collection-pinned-library.png`, `collection-active-update.png`, and `overlay-update-collection.png` in that folder. Package: `output/neo-0.9.0.zip` (43 validated extension files), tested from `output/release-0.9.0-verified`.
