# Neo 0.1.0 — historical implementation and verification

This report describes the previous build. Current UX changes and evidence are in [the 0.2 redesign report](redesign-0.2.md).

6 September 2026. The local extension implementation is complete and packaged. Scope follows `../tmp/tab-experience-research/complete-proposal-v2.md` and the user's request for the full polished extension, including the requested AI and portable/service integrations. Explicitly deferred products in the proposal—team/cloud sync, a task suite, full-page archival, autonomous AI and required companions—are not implied by this release.

## Delivered

| Capability | Implementation and evidence |
|---|---|
| Local library | Collections, optional groups, links and notes; IndexedDB transactions; actual v1→v2 migration; versioned portable formats |
| Safe tab operations | Save-before-close, pinned protection, navigation checks, partial outcomes, Undo and real worker-interruption recovery |
| Selective/deferred resume | Choosing a collection creates no tabs; explicit resume prepares local parked tabs, reuses unambiguous live pages, preserves native groups, and loads websites only when selected |
| Bulk behaviour | Four concurrent local navigation/discard preparations with ordered native creation; persisted resume snapshots/progress; cancellation; 30/100/500 actual native-tab tests |
| Library UI | Flat pastel collection headers, persistent open-tabs sidebar, compact stash tray/popover, quiet group actions, light/dark/system, narrow reflow |
| Interactions | Native pointer drag to save, move into groups and reorder collections; Shift/Ctrl/Cmd selection; sort/filter, duplicate review, recently closed, notes; focus/caret preservation during refresh |
| Visual switcher | Open tabs only, actual captured previews, group collages, list fallback, keyboard navigation and configurable shortcut |
| General bar | Independent search window; open/saved/closed/notes search; multi-word/quoted @ context; slash commands and shared action dialogs; IME guards |
| Portable work | JSON, Markdown/Obsidian and bookmark HTML import/export; supported Toby collections/cards and OneTab text; file-input preview; optional preference restore and inert imported recovery log |
| Native bookmarks | Explicit optional bridge; durable export status before root creation; real native export and UI import tested with fixture-granted access, including empty groups |
| AI | Gemini and compatible endpoints; user credentials; reviewed link subset up to 300; editable/per-group acceptance; optional note draft; stale-context rejection; cancellation and Undo |
| Notion | Reviewed destination; current API version; durable bounded batches; rate-limit backoff; pause/continue; uncertain writes are not blindly repeated |
| Obsidian | Markdown export and encoded, size-bounded user-invoked note URI, without overwrite; actual external handler availability is separate |
| Privacy/settings | No required backend/account/telemetry; credentials excluded from backups; optional history/website access; preview byte/age limits and invalidation after navigation/private-state changes |
| Source/distribution | Readable packaged sources, original assets, MPL 2.0 notices/license, bundled Help & privacy, deterministic ZIP |

## Verification results

- **54 unit/contract tests passed** using `node --test tests/*.test.mjs`.
- **29 packaged files** pass module/entrypoint/asset/CSP checks; production manifest has no mandatory host permissions.
- **43 Chrome checks passed** with no page exceptions in `output/chrome-1788630627840/results.json`. This uses the production manifest and includes full recovery, scale, bulk, preview, native pointer and actual file-input workflows.
- **4 additional connection/bookmark checks passed** in `output/chrome-1788630751469/results.json` (13 total including repeated baseline checks). The disposable fixture grants required test access in its copied manifest; Notion's transport origin is replaced in that copy with localhost. Production code and manifest are not changed by fixture setup.
- **The final ZIP was independently extracted and loaded in Chrome:** 9 smoke checks passed in `output/chrome-1788630986734/results.json`. ZIP CRC, every file SHA-256 and identical hashes from two builds pass; see `output/package-verification.json` and `output/package-inventory.json`.
- Earlier Edge 152 core checks also passed. Current comprehensive validation is Chrome 152 on Windows. Chromium 123 is the documented API/CSS minimum, not an old-browser runtime test claim.
- Light/dark library, actual switcher, stash and responsive screenshots were captured and inspected. Fixture page titles/content are test data, not bundled demo data.

### Measured scale on this machine

311 collections / 15,023 links: import 351 ms, full state/runtime load 113 ms, search to the next frame 18 ms. The DOM contains at most 60 initial collection cards and 41 search choices. Actual native deferred resume: 30 tabs in 1.3 s, 100 in 3.1 s, 500 in 18.2 s; every destination remained parked/discarded until selected. These are single fixture observations, not performance guarantees or measurements of hundreds of loaded websites. Raw files: `scale.json` and `bulk.json` in the 43-check output directory.

## Boundaries

- Hosted AI/Notion account access, provider billing/model availability and a user's destination sharing rights were not tested with user credentials. Adapters and complete UI/worker flows were exercised using dummy credentials and local responses. The original-manifest denial paths were tested separately.
- Chrome's native optional-permission prompt remained pending in headless automation. Granted-path fixtures explicitly pre-grant access; this is not a claim that the real permission prompt was clicked or bypassed in a user's browser.
- An early runtime fetch-override fixture failed to intercept a dummy Notion request, which was rejected with HTTP 401. No account write succeeded. The retained successful UI fixture replaces the endpoint in an isolated copy before browser launch, preventing that request from reaching Notion.
- No registered Windows Obsidian URI handler was found. Markdown output and URI encoding/size behaviour are verified; an actual vault write is not claimed.
- Recovery preserves URLs/groups, not unsaved forms, authentication or arbitrary web-app memory. Last 20 completed operation records and up to 1,000 closed records from 30 days are retained. Parked destination records remain durable because browser-restored placeholder tabs may outlive the journal; they are small URL/title records and live views read only referenced entries.
- Imports are bounded at 20 MB, 2,000 collections and 50,000 links; notes and fields have documented bounds. Large libraries can be exported by collection. This is not arbitrary-format or unlimited-volume import support.
- No store publication, Git push or installation into a real user browser profile occurred. Test profiles contain only task-owned fixtures.

See `docs/release-review.md` for the exact-target review and `docs/api-research.md` for current primary-source decisions.
