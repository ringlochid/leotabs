# Close current collection — 0.10.2

After swapping into a collection, its card action becomes **Close current collection**. The same action appears in the collection menu, expanded view and collection search actions.

Clicking it captures the latest state, ends the active collection association, and closes its eligible unpinned tabs through Neo's group-cleanup operation. The saved collection remains available. The button returns to **Swap to…**. Previous sessions are not reopened and no browser window is created. If the collection owns the window's only tabs, Neo leaves its Library in that same window.

Automatic tracking ends before tab-closure checkpoints run, so closing the collection cannot overwrite it with an empty tab set. A manually paused collection keeps its curated contents; the current tabs are still captured in Timeline. Snapshot failures leave tabs untouched. Incomplete closure preserves a retryable current collection with automatic updates paused to protect its saved contents.

Validation: 114 unit tests, including stale/other-window requests, failed snapshots, incomplete closure, saved-content preservation and sole-window closure. Browser integration clicks the real Swap/Close button, checks pinned tabs and notes/groups, waits for closure checkpoints, confirms no previous tabs or new windows, and reopens the saved collection intact. Test profiles are disposable; reload the updated extension to use this behavior.
