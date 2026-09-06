# Neo 0.8.1: library search and recovery

The library now uses one sidebar query for open tabs, recently closed pages, browser history, and saved collections in the current space (or the expanded collection). The header Search action and / shortcut focus that same query. Escape or the search field's clear control resets the filter.

## Design decisions and evidence

- Tabme describes searching open, saved, and recently closed tabs in one workspace: https://gettabme.com/. The user's supplied screenshots additionally show browser history below recently closed, with match highlighting. Neo adopts that compact grouping, using its existing styling rather than copying the layout.
- Workona distinguishes individual recent-tab recovery and restoring previous sets of tabs: https://workona.com/help/tab-manager/. Neo keeps its existing local snapshot timeline behind Sessions in the same sidebar area. A prominent, labeled Restore session / Restore window action sits above the scrollable tab list.
- This window / All windows applies to open tabs. Recently closed and browser history are browser-wide, while the session timeline retains its own window selector.
- Recently closed shows six pages initially; history shows eight, with Show more controls. Duplicate URLs appear once in recently closed and are omitted from the history section. A page that is already open switches to its existing tab.
- Browser history remains an optional permission. Enable history search requests access only on the user's click. Search uses the existing backend limit of 40 matches over 30 days; local session retention remains 200 snapshots / 30 days.
- Matching uses literal, case-insensitive terms. Marks are built with text nodes, including unusual punctuation and HTML-looking titles. Search temporarily reveals matching folded groups without persisting fold changes. Collection actions continue to operate on the complete collection, not a filtered copy.
- History reads are debounced and generation guarded. Permission changes refresh availability. No browser history is copied into Neo's collection data.

## Validation

85 unit tests passed. Real Chrome tests exercise the packaged extension in disposable profiles, both with history access absent and with history permission granted in an isolated manifest fixture. They cover filtering/highlights, native recently closed entries, permission rejection, real history queries, deduplication, stale-result protection, clearing search, preserving folded state, visible restore placement, light/dark/compact layouts, and existing overlay scope/close/swap behavior. The browser's permission prompt itself is not automated; the enabled path uses only the disposable permission fixture. Screenshots and result JSON are stored under output/chrome-*.

Final packaged run: `output/chrome-1788677545674/results.json` (15 checks, zero browser exceptions). History-denied run: `output/chrome-1788677133124/results.json`. Unit results: `output/unit-0.8.1.txt`. Release: `output/neo-0.8.1.zip`; extracted copy: `output/release-0.8.1-verified`. A compact-view capture timeout during an intermediate run was resolved by bringing the disposable library tab to the foreground; the final compact screenshot and sidebar overflow assertions pass.
