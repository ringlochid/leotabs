# Neo 0.8.5 timeline refinement

Sessions is renamed Timeline in the library and overlay. The library timeline includes snapshots from all windows without a window selector. The redundant Browsing session and Before switch captions are hidden; named collections keep their useful names. Stored snapshots are retained.

Timeline pages use the same favicon, title, domain, spacing and Switch/Reopen affordances as Recent & history. A page already open switches to its existing tab. Whole-snapshot Restore is beneath the scrollable tab list. The overlay snapshot view also keeps website icons and puts its restore action after its pages.

Validation: 87 unit tests passed. The real Chrome run output/chrome-1788678433469/results.json has 15 passed checks and zero browser exceptions. Checks cover the missing selector/captions, website-icon rows, restore position, unified search, optional browser-history access via a disposable permission fixture, and overlay groups/scopes. Screenshot: output/chrome-1788678433469/library-timeline.png. Package: output/neo-0.8.5.zip.
