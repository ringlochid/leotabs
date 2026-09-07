# Remaining proposal implementation

Baseline: 7a74689. User authorised completing the remaining items from the audit.
The later global auto-update and visible pause control decisions remain authoritative.

Acceptance ledger (completion requires code and browser evidence):

- [x] Independent Group, Collection name, Group name and Order policies; global defaults and space/collection overrides.
- [x] URL and title rules, priority, exceptions, colour, templates and persisted configuration.
- [x] Automatic AI grouping and rules-then-AI, batched new work, preserved manual choices.
- [x] Actual native tab/group ordering and saved collection/group/link ordering; rule and purpose-driven AI order.
- [x] Durable manual correction history, including native browser changes, plus a visible way to reset exceptions.
- [x] Contextual save/drop destination suggestions and inline alternative names.
- [x] Space/all-spaces review for cross-collection moves, merges and renames.
- [x] Page-content-based research overview/continuation with source references and review.
- [x] Explicit utility/Web Store capture policy, retaining deliberate saving.
- [x] One action event for switch/close/stash with associated closures and date-grouped Timeline.
- [x] `neo` omnibox access and optional standalone Library window.
- [x] Native Chrome/Edge and unit validation, packaged artifact, documentation and final requirement audit.

Research: Chrome tabs and tabGroups support native moves (groups must remain contiguous); native group colours use nine named values. Omnibox access uses a manifest keyword and input handlers. Page extraction uses scripting.executeScript with a user-granted host/activeTab permission; saved metadata alone cannot support a page summary. Sources inspected 7 September 2026:
https://developer.chrome.com/docs/extensions/reference/api/tabGroups
https://developer.chrome.com/docs/extensions/reference/api/omnibox
https://developer.chrome.com/docs/extensions/reference/api/scripting

Implementation order: shared policy/data model and configuration; native/saved automation and corrections; contextual/broader AI; Timeline/access; integrated browser verification. No live personal browsing data or external AI credentials are used for test fixtures.

## Final acceptance evidence — 7 September 2026

Implemented as 0.12.0, protocol 17. The earlier proposal is now implemented with the later global auto-update decision preserved. Organisation policies are separate from tab mirroring: Settings controls mirroring globally, and the current collection still has its pause control. No Working/Saved collection-type migration was introduced.

| Requirement | Implementation and verification |
| --- | --- |
| Configurable grouping, naming and ordering | `lib/organisation.js`, `ui/organisation-dialog.js`; unit inheritance/rule round trips; native collection-to-space-to-global inheritance and run-once checks in both browsers. |
| Native and saved automation | `lib/native-organisation.js`, `lib/automatic-ai.js`, `lib/ai-organisation.js`; actual browser group creation, colours, tab ordering, unmatched AI grouping and saved collection ordering verified. |
| Manual corrections | Durable local correction records; native ungrouping and reorder survive later automation; generic-name protection and explicit reset UI verified. |
| Contextual AI | Save destination recommendations, optional post-drop suggestions and selectable inline alternative names verified in the real extension UI. |
| Broader organisation | Space/All spaces review applies selected editable actions, rejects stale revisions, and preserves links and both notes during cross-space merges. |
| Research notes | Actual open-page text reaches the provider fixture; returned source references and draft are reviewed before saving; cancellation verified. |
| Utility tabs and Web Store | Native workflow closes utility tabs; unit tests verify automatic Web Store exclusion, explicit opt-in, and deliberate saving. |
| Timeline | Switch/close/stash snapshots carry operation and closure data; real browser switch produces one action event; date-grouped event navigation rendered. |
| Access | Omnibox manifest registration plus handler/disposition unit tests; actual encoded Library search and standalone popup verified. The extension origin remains browser-assigned. |
| Layout and regression | 1440px and 390px organisation forms fit without horizontal overflow and screenshots were inspected; original Chrome overlay and Chrome/Edge workflow suites remain green. |

Verification artifacts (local, ignored by Git):

- `output/remaining-unit-results.txt`: 142 tests passed, zero failures.
- `output/chrome-1788715631551/results.json`: native organisation, ordering, manual corrections, apply-once and inheritance.
- `output/edge-1788715852548/results.json`: matching organisation coverage; `organisation-1440.png` and `organisation-390.png` capture responsive forms.
- `output/chrome-1788715404258/results.json` and `output/edge-1788715852582/results.json`: contextual AI, reviewed plans, research notes, Timeline and access.
- `output/chrome-1788715500549/results.json`: 29 baseline/overlay/workflow checks, zero recorded exceptions; tab creation reached collection persistence and rendering in 285ms in this run.
- `output/edge-1788715144774/results.json`: 22 baseline/workflow checks, zero recorded exceptions; corresponding update took 205ms in this run.
- `output/edge-1788715542699/results.json`: 13 existing AI workflow/regression checks, zero recorded exceptions.
- `output/neo-0.12.0.zip`: 58 files; package syntax, entry points, assets, overlay freshness and absence of mandatory host permissions passed. `output/package-inventory.json` records file and archive hashes.

## Practical limits

Native tests used isolated headless Chrome/Edge profiles and a local deterministic provider fixture, not personal browsing data or a paid model. They verify transport, application and review behaviour, not a real model's classification quality. Timing observations are fixture measurements, not a universal performance guarantee.

Automatic AI batches work and handles up to 300 links per context. Broader plans cover up to 100 collections / 3,000 links. Research drafts use up to 20 selected, open and readable pages with granted site access; unavailable pages are reported. Closed saved pages are not silently fetched or summarised from titles. These limits are documented in Help.

The package is built, but these 0.12 changes have not been committed or pushed. The unrelated pre-existing line-ending-only change in `scripts/check-overlay.mjs` was preserved.
