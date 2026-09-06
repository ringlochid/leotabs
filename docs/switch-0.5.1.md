# Neo 0.5.1 — Switch collection

The library and overlay now use the same anchored picker. Search by collection name, then choose a row to switch immediately. Rows show the tab count and space name. There is no save destination selector or second confirmation form.

**Save current tabs** is checked by default. When checked, the current window's unpinned tabs are saved into an automatically named new collection. When unchecked, switching adds no collection. In both cases the destination opens before old tabs close, pinned tabs remain, and the close snapshot supports Undo and Recovery. If destination creation or group restoration fails, source tabs remain open.

The search field receives focus. Arrow Down moves to the results; Enter chooses a collection. No results displays an empty state. Cancel or dismissing the picker during a switch requests cancellation.

## Validation

- 72 unit tests passed, including automatic saving, no-save switching and Undo, and creation/group/storage failures.
- Package validation checked all 37 extension files, entry points, module syntax and generated overlay hashes.
- The packaged ZIP was extracted and loaded in a fresh headless Chrome profile. Eleven checks passed with no browser exceptions, including actual overlay switching without saving and library switching with both settings, filtering, empty results, keyboard activation and pinned-tab preservation. Results: `output/chrome-1788673675272/results.json`.
- The initial broader run stopped in an existing group-renaming check. The final run isolated the new switch flow alongside the core browser checks; it is not a full rerun of the 0.5 regression suite.

Install by reloading Neo's existing extension card at chrome://extensions and refreshing the library. Keep the existing installation to retain collections. The protocol version changed so stale pages prompt a reload rather than silently ignoring the new checkbox setting.
