# Neo 0.9.1: direct group controls

The overlay selection toolbar exposes Ungroup beside Group. Its More menu and Rename group action are removed. The unrelated top-level actions menu remains.

Clicking a group name edits it inline in Preview or List, in normal or selection mode. Enter or leaving the field saves; Escape cancels. The existing rename-tab-group RPC updates the native browser group. Group creation also focuses its inline name. Names and controls are siblings of the primary folder button, avoiding nested interactive buttons.

Group previews open the folder in either mode. The checkbox selects or clears all members; partial selection shows a minus. The Browse group button and repeated Browse group caption are removed. Collection rows use their stored library colour as a dot and a flat background tint.

Validation: 91 unit tests pass. Real Chrome testing of the extracted package covers normal/selected inline renaming, List editing and blur-save, Escape cancellation, folder navigation, whole/partial selection, direct Ungroup, collection colours, and existing overlay scope/keyboard behaviours. The final run has 13 passed checks and zero browser exceptions. Screenshots inspect group selection, list editing, collection colours, and narrow layout. Package: output/neo-0.9.1.zip.
`output/chrome-1788679552487/results.json` records the final packaged Chrome run. Screenshots are in the same folder.
