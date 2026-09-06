# Neo 0.1.0 local release review

Target: the 29-file source extension in `output/neo-0.1.0.zip`, SHA-256 `9ca5329768697582b70d673a9b9ff05f34d913c6f2b3574413a841444c3c4dfd`. This directory is not a Git checkout; the package inventory pins the reviewed output. Review authority is the user's implementation request, the consolidated proposal and the repository's test/format contracts.

## Verdict

No blocking finding remains in the implemented local scope after the fixes and checks below. The package loads and performs the tested workflows. This is a local-build verdict, not Chrome Web Store certification, a guarantee for every provider account, or proof of external Obsidian writes.

## Criteria and research

The review covered browser/native API boundaries, durable state before destructive operations, worker termination, recovery/Undo semantics, credential isolation, remote-write uncertainty, input/output validation, bounded rendering, keyboard and pointer flows, import fidelity and packaging. Current primary references and versions are recorded in `api-research.md`: Chrome tabs/storage/permissions/service-worker/favicons APIs, Chromium 123 CSS baseline, the ARIA combobox pattern, Gemini generation and Notion 2026-03-11 page/batch limits. MPL 2.0 was selected from the research proposal's candidate using [Mozilla's guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/); readable source and license notices are included.

## Findings corrected during implementation/review

1. Early discard could lose the local placeholder URL and replace a tab ID. Preparation now waits for local navigation, discards only inactive completed placeholders and uses the returned ID. Native Chrome/Edge checks and a replacement-ID regression cover it.
2. Stash Undo restored library state but initially did not reopen closed pages. It now restores those pages before reversing the saved-library change. Older snapshots restore as copies after later edits. Actual worker/database failure checks cover interruption boundaries.
3. Full journals were being returned on routine refresh. A transactional metadata store now separates those summaries from large snapshots. Closed-page records have their own bounded retention.
4. Search originally redirected to the organiser. Both entry points now share action dialogs and a combobox controller. Multi-word contexts, stale data refresh, selected-result verbs and IME handling are checked independently.
5. Fixed list slices hid long groups. Paging and filtering now expose every link; live refresh retains focused controls and unfinished note text. Native pointer tests cover save, move and reorder.
6. Reusing one dialog element allowed a queued close event to cancel the next progress step. Separate elements now isolate dialog lifetimes. The UI transition regression and AI/Notion full-flow fixtures cover it.
7. Notion's one-request cap, ambiguous retries and incomplete progress reporting were replaced by durable bounded batches. Failed or uncertain writes have distinct states. Known confirmed progress can pause and continue without creating another page.
8. AI plans could overwrite changed notes or include more resources than the reviewed subset. Fingerprints now cover the complete relevant context, scoped IDs are validated and per-group acceptance is preserved. Real worker apply/Undo and UI cancellation checks pass.
9. Backup Undo retained newly introduced optional metadata. State replacement now removes keys absent from the earlier snapshot; an actual file-input import/Undo regression covers preferences and archive metadata.
10. Preview capture now rechecks URL/window/private state after conversion and invalidates in-flight results across navigation changes. Expiry and byte-budget eviction are verified against real IndexedDB with injected race states; the baseline still captures a real page through Chrome's toolbar permission.
11. Native bookmark export now commits its operation record before root creation. Imported empty groups are preserved. The granted-access fixture exercises actual bookmark APIs and import UI.
12. Duplicate review now resolves parked destinations, and the missing-placeholder recovery page's Library action remains usable. Bulk resume has bounded preparation, durable progress and cancellation.

## Evidence and residual limitations

54 unit tests, 47 distinct Chrome acceptance checks, 29-file static/package validation and an extracted-ZIP smoke run pass. Exact output paths and test-isolation distinctions are in `implementation-status.md`. Source/manifest scans found no fixture credentials, test endpoints or bundled competitor screenshots. The only localhost logic in production validates an explicitly user-configured local AI endpoint.

External account availability, browser-controlled permission prompts, old Chromium runtime testing, macOS-specific shortcuts and external app handlers remain environment-specific validation boundaries. No user account credentials, real browsing data or vault contents were used. These do not hide missing local implementation or require a project backend.
