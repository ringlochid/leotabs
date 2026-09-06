# Group cleanup — Neo 0.10.1

When Neo closes or swaps grouped tabs, it now ungroups each outgoing tab before closing it. Chrome deletes the empty group instead of retaining a closed saved-group chip. Remaining members of a partially closed group stay grouped. This applies to Neo's shared close operation, including stash, explicit close, and collection swaps.

Recovery is saved before changing browser tabs. Snapshots retain original group membership, names and colours for Undo and Timeline. A tab moved into another group after capture is skipped. A failed close attempts to restore the surviving tab's group without overriding a concurrent move, pin or regroup. Browsers without `tabs.ungroup` retain the existing close fallback; a rejected supported cleanup leaves the affected tab open for retry.

## API evidence and limits

- [Chrome tabs.ungroup](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-ungroup) explicitly removes tabs from groups and deletes groups that become empty (Chrome 88+).
- [Chrome tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) exposes live-group get, query, move and update; it has no method for deleting a previously closed saved group.
- [Chromium local group listener](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/ui/tabs/saved_tab_groups/local_tab_group_listener.cc) removes tabs from the saved model and handles the last removed member as group deletion.

This prevents leftovers for future Neo operations. It does not sweep previously closed saved groups, intercept Chrome's own native close button, or change unrelated groups. Existing closed saved groups can be deleted in Chrome's group menu.

## Validation

- 109 unit tests passed, including durable-write failure, partial close, changed group membership, ungroup rejection, close failure repair and navigation during cleanup.
- Extracted release tested in Chrome and Edge: partial close, full close, swap, Undo metadata, no extra swap windows. Edge also reran active-collection autosave/version restoration integration.
- Actual Chrome window screenshots confirm the named saved chip is present before cleanup and absent afterward, while the unrelated Research chip remains:
  - `output/chrome-1788683926612/group-cleanup-before.png`
  - `output/chrome-1788683926612/group-cleanup-after.png`
- A signed-out disposable profile returns no nodes from sync-internals, so that diagnostic was not used as deletion evidence. Native Chrome screenshots establish the saved-chip result independently of live-group API assertions.

All browser checks use disposable profiles; the user's installed extension and saved browser groups were not changed.
