# Neo 0.9.3: recognisable suspended tabs

## Finding and references

Neo creates one local placeholder per saved link during deferred resume or when a collection has no retained live tabs. This avoids opening every destination website at once. The old discard loop waited only for document navigation to complete, but parked.js fetched the title asynchronously afterward. A discard could freeze the generic Parked page title. No website favicon was set.

Workona documents automatic/on-demand suspension and resuming tabs when needed: https://workona.com/tab-suspender/. Its public product page does not establish its internal restore implementation or comparative performance. Chrome documents that discarded tabs remain visible and reload on activation: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-discard. Its favicon endpoint is documented at https://developer.chrome.com/docs/extensions/how-to/ui/favicons.

## Change

The local page sets the original title without a Parked suffix and reads the browser's cached favicon, converting it into a local PNG data URL. If retrieving or decoding an icon fails, it generates an initial-letter icon locally. An absent site icon may resolve to the browser's generic icon. No destination website or remote favicon service is fetched for this process.

Discard waits for both the browser-visible title and PNG favicon. After a bounded wait, an unready placeholder stays lightweight and alive instead of freezing generic metadata. Up to four placeholders settle concurrently. Existing live collection switching continues to reuse live tabs.

A bounded startup repair pass reloads only inactive owned placeholders with missing identity, keeping their destination records and never activating them. Chrome replacement tab IDs are tracked for retained collection ownership. The overlay also accepts these local PNG favicons.

## Verification

95 unit tests cover delayed metadata, timeout/activation/navigation guards, repair exclusions, replacement IDs, and the existing operation suite. Packaged Chrome checks verify titles and exact cached favicon pixels after discard, repair of a simulated legacy label, and zero requests to destination pages or the fixture favicon server during deferred restore/repair. Selecting a restored tab still loads the destination.

Package: output/neo-0.9.3.zip. No mandatory permission additions. No comparative RAM or latency benchmark is claimed.

Final results: output/chrome-1788680069254/results.json (14 checks, zero exceptions) and output/edge-1788680144486/results.json (8 checks, zero exceptions). Edge verification includes the identity/cache/legacy-repair path. Test harness recovery: reloading the local placeholder before attaching DevTools accounts for Edge removing targets for discarded pages; resolving repaired tabs by URL accounts for replacement tab IDs.
