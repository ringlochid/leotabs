# Neo 0.8.2 overlay refinement

The overlay uses two compact rows and a flat, opaque surface. Search, Previews/List, Select and the icon-only More actions control occupy the first row. The second row contains This window, All windows, Recently closed and Collections, with Audio retained on the right beside Library and Close.

Removed the redundant title/count header, keyboard-hint footer, empty-state Search all windows button, and Session history entry in More actions. Session history remains reachable from Recently closed. Keyboard navigation, Enter activation and Escape dismissal still work; only the repeated on-screen hint was removed.

Every displayed open tab is represented individually, including tabs inside a native browser group. Group colours fill the whole frame surrounding each preview, with the group name in the metadata. No stacked cards or coloured cap bars are used. Previews are the default; List remains an explicit choice. Individual close and mute actions remain available without entering selection mode.

Thumbnails use actual locally captured page images. Chrome's current visible-tab capture path cannot provide a screenshot of an unvisited background tab without activating it; such tabs retain a per-tab placeholder until a preview is available. This update does not activate background tabs to manufacture previews or add mandatory permissions.

Validation: 85 unit tests passed. The packaged extension is exercised in disposable Chrome profiles for window scopes, empty results, individual close, reopening, Audio/unmute, collection Open/Swap, keyboard handling, flat group frames, actual cached previews, and narrow-layout overflow. No everyday browser profile or saved library is modified by tests.

Final package: `output/neo-0.8.2.zip`. Verified extracted copy: `output/release-0.8.2-verified`. Chrome results: `output/chrome-1788677820764/results.json` (12 checks, zero exceptions); desktop and 620px screenshots in the same folder. Unit results: `output/unit-0.8.2.txt` (85 passed).
