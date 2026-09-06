# Collection picker spacing — 0.9.7

Collection choices now share a common row component and style across overlay browsing, Switch collection and Move selected links to. Collection search/context results use the same colour treatment. Rows have an 8px gap, a colour marker, a full-width hit area, aligned name and tab-count text, and consistent hover/focus feedback. Existing collection colours and pinned indicators are preserved.

Move to no longer uses the wrapping actions layout. It provides a searchable vertical destination list, excludes the source collection, reports empty matches and supports keyboard entry from the search field. Existing move operations and data semantics are unchanged.

Validation includes actual extension rendering in light and dark themes, measured row gaps, source exclusion, filtering, and a real selected-link move. Unit results: output/unit-0.9.7.txt (96 passed). Edge evidence: output/edge-1788682233144/results.json. Screenshots in the same directory show collection-switch-light, collection-move-light, and collection-overlay-light/dark.

The optional older check-switch-picker script was tried and found to assert pre-existing obsolete switch behaviour (creating an extra saved collection rather than retaining the browsing session). It was not used as a current contract. The active overlay checks verify current switching behaviour. Early new-check failures came from the test's settings RPC and an ambiguous button selector; those were corrected to use the actual settings contract and scoped destination button.

Release: output/neo-0.9.7.zip. Replace the unpacked extension files and reload it. Disposable browser profiles were used; the user's installed extension was not replaced.

Final Chrome package verification: output/chrome-1788682363938/results.json (14 checks, no exceptions). Edge passed 8 checks, no exceptions. Native extension screenshots were visually reviewed; the final capture explicitly brings the test page forward before capturing. No product changes were required for the screenshot timeout.
