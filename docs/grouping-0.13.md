# Direct grouping UX — Neo 0.13

User-approved direction: local Group & sort with the later-requested regroup checkbox, visible rules and useful defaults, complete Undo,
varied persistent group colours, direct optional AI topic grouping, combined collection name/note/topics, normal Web Store handling.
This supersedes the ordinary grouping plan review and Web Store exclusion decisions in 0.12.

## Implemented flow

- The Open tabs three-bar menu contains Group & sort, Group by topic with AI, and native sorting. Grouping rules lives in Settings; Auto-group new tabs remains a sidebar switch. The later-requested compact Group panel remembers Include already grouped tabs. Applying runs locally without an AI plan; local grouping works without rules or credentials. Both live-tab and collection topic AI open their own options modal with the same remembered Include already grouped tabs choice. Included links are regrouped without existing group labels or memberships in the provider input; excluded groups retain their membership.
- Settings → Grouping rules opens a separate editor with website defaults, presets, current-tab suggestions, match counts, ordered priority, colours and advanced conditions. Tab/group context menus prefill rules.
- Website identities use the complete hostname while readable names use local aliases and the vendored Public Suffix List. Distinct services and identically named unrelated domains stay separate. Repository presets use {project}.
- The Group & sort apply action batches native group and ordering operations, persists once at the operation boundary, and returns one Undo action. Undo restores membership, order, labels, colours and collapsed state; records manual exceptions so automation does not immediately reverse it. Later structural edits prevent an old Undo from overwriting the new layout.
- Colours are random for new groups, avoiding already-used colours until the palette is exhausted. Existing colours remain stable and explicit rule colours take precedence.
- Organise collection with AI produces a collection title, concise metadata-based overview and cross-site topic groups in one request. Compact numeric link IDs reduce generated JSON. ChatGPT/Gemini/Claude share the AI chatbots topic; singleton groups are omitted. The combined operation supports Undo for both saved and active tracked collections, including browser layout and collection name/note. Provider latency is reported separately from local application time in the response.
- AI topic grouping uses one compact metadata request, applies directly, supports Cancel and rejects stale results. No individual name-suggestion buttons or AI-generated ordinary grouping plan modal remain. Space/all-spaces AI organisation has been removed at the user request; source-based collection research drafts remain.
- Web Store capture filtering and its setting have been removed; script-injection restrictions still belong to the browser.
- Rules/website grouping and collection auto-update have separate controls. Auto-group is an explicit On/Off switch in the sidebar. New automatic groups require at least two matching tabs; explicit and AI grouping also leave singleton results ungrouped; a single tab can join an existing group. Existing collection data and unrelated dirty work are preserved.

The later flash regression was independently reproduced with auto-group enabled: a completed AI topic group was immediately split into website groups by the next checkpoint, invalidating Undo. Explicit AI placement (including ungrouped results) and ordering are now remembered as user choices before the next checkpoint. Chrome and Edge regression checks verify stable topic groups, delayed Undo, and include/exclude modal behaviour. Saved-group name collisions cannot absorb links into an excluded group.

## Editing open groups

The user recordings showed that open-tab rows were draggable but native groups did not accept drops. The sidebar now accepts drops onto group headers (including folded groups), onto rows to insert before them, and into a visible drop-to-ungroup area. Native membership/order and the tracked collection update together. Each move has browser-level Undo, switches the sidebar to browser order so the new position is visible, and manual placement is remembered so background grouping does not move the tab straight back. Tab context menus also offer Move out of group.

## Flashing and singleton follow-ups

The 6.29-second user recording shows collection card heights jumping during updates. The library previously refreshed every 60 ms during native move events, and rebuilt collection cards used content-visibility with a 240px estimated height. New nodes lost their measured heights. Loads now report an in-progress layout and a generation check rejects snapshots spanning an operation. UI refreshes during mutations return a small busy response instead of reloading the full library; the UI waits for completion and skips unchanged list/card renders. Collection cards use real layout heights. Initial startup waits for a usable snapshot before creating controls. A browser regression observes DOM mutations during sorting and rejects intermediate redraws. Native Chrome tab-strip move animations remain controlled by the browser.

The 4.05-second follow-up shows a lone Google page receiving a new group. Automatic grouping now waits for two eligible matching tabs. The native test creates one tab, confirms it remains ungrouped, turns the visible switch Off, creates a second and confirms grouping stays off, then turns On and verifies the pair joins one group. Existing groups and manual corrections remain intact.

## GPT-5 mini latency

The user confirmed gpt-5-mini. The previous Chat Completions request omitted reasoning_effort and verbosity. Fast live/collection organisation now explicitly sends reasoning_effort=minimal and verbosity=low for the original GPT-5 family (including dated snapshots); other model families and longer research tasks retain their existing requests. The selected model is unchanged. The official GPT-5 guide identifies minimal reasoning as the latency-sensitive option. The bundled name/note/group response uses compact integer link IDs and a short overview. These changes are request-level optimisations; real provider latency and semantic quality remain unmeasured because personal Chrome automation is blocked. A universal two-second remote-provider result is not established.

## Evidence and limits

- 152/152 unit tests passed (`output/ux-unit-results.txt`).
- Chrome's broader 29-check workflow/overlay regression passed with no exceptions (`output/chrome-1788764935317/results.json`).
- Final grouping, regroup checkbox, singleton exclusion, drag membership/order, complete Undo, AI cancellation/stale guards, combined collection AI and native GPT-5-mini request knobs passed in Chrome (`output/chrome-1788766561834/results.json`). The matching Edge functional run passed (`output/edge-1788766375426/results.json`); GPT-5-mini parameter changes were subsequently checked in unit tests and Chrome's local provider fixture.
- Rule editor layouts were inspected at 1440px and 390px, plus the narrow sidebar and compact Group panel. Fixture screenshots accompany their results.

The 20-run native grouping baseline included 30 loaded tabs, a pinned tab, an existing collapsed group and an active tracked collection. It measured from Group & sort's Apply click through the rendered result and persisted collection, including a cold worker on the first sample:

| Browser | Median | P95 | Cold | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Chrome (`chrome-1788765594374`) | 623 ms | 951 ms | 847 ms | 1155 ms |
| Edge (`edge-1788765523323`) | 888 ms | 1451 ms | 1451 ms | 2219 ms |

The baseline met the proposed P95 target, but **two seconds is not a hard bound**. A contended run while packaging checks were active reached Edge P95 2277 ms (`edge-1788765042670`); a final two-sample Chrome functional check measured 1158 and 2078 ms. The quick functional mode does not claim a performance pass. Timing varies with host load and browser API latency.

AI tests use a deterministic local provider and validate request shape and application/Undo, not real model quality or latency. No personal browser data or keys were used. Personal Chrome automation was rejected by its URL policy; no alternate route was used to access that profile. The user's two-second remote-AI target remains unverified. Their 14.46-second recording is evidence of a long visible wait, not a measured network timing breakdown.

Final package: `output/neo-0.13.0.zip`, 66 files. ZIP CRC and every extracted byte match the current extension source. SHA-256: `4cef39021c3183fcd65e4abb8a1b9228c24b9c8f3190cf84d586d84995b8a18e`. Module syntax, entry points, asset references, overlay source hashes and no mandatory host permissions passed.

Collection note readability follow-up: notes now use 15px main text, 1.65 line spacing, 12px/14px padding and a 100px minimum editor height. Visually checked with the actual stylesheet in isolated Chrome in light and dark themes; rebuilt the overlay and package.

Selection hover follow-up: replaced mouse focus-within styling with keyboard focus-visible styling on open-tab rows. Reproduced the unchecked checkbox staying visible before the fix; native Chrome and Edge checks now pass for deselection, pointer re-entry/exit, keyboard selection, and Select/Done mode.

Selection toolbar follow-up: Remove from collection is a text action matching the quiet Close tabs style. Selection count and selection controls occupy the first row; operations occupy the second. Repeated Rename group toolbar buttons were removed; inline/group-menu renaming remains. Chrome checks verify 1440px/390px fit, removal without closing browser tabs, Undo, and the previous hover regression.

Close-all follow-up: replaced the unlabelled close icon with a quiet red Close all text button on shared tab controls and the unassigned-session header. The tooltip clarifies the current window and pinned-tab exception. Native Chrome verified the text fits at 1440px and 390px. The close operation is unchanged.

Workspace AI removal: removed Organise this space and its scope/review UI. Old library AI requests fail before provider permission/key lookup or network calls. Native Chrome checks confirm the menu removal, zero provider requests for space/all-space scope, and functioning live-tab topic organisation. Collection AI and deliberate filing into a chosen collection remain available.

Native drag-start follow-up: earlier tests dispatched DOM drag events and missed a real gesture cancellation. A mouse-driven Chrome test reproduced dragstart immediately followed by dragend. Showing the in-flow Ungroup target moved the source rows and cancelled the native drag. The target is now fixed at the bottom of the sidebar; tab-title buttons are explicitly draggable with a grab cursor. Native Chrome and Edge mouse tests verify the source does not shift, single/multiple selected tabs move between actual browser groups, Ungroup works, row-to-row reordering works, and Undo restores native order. Input interception and native drag delivery use the documented Chrome DevTools Input API.

Auto-update audit: normal switching now flushes the outgoing active collection; current/global Pause flushes pending changes first. See docs/auto-update-audit.md for the complete update/pause matrix, remaining saved-card editing gap and proposed explicit save destinations / Save as active collection.

Duplicate-control cleanup: the library keeps Close all only in the main current-window area; the sidebar copy is removed. The old AI tools menu is a direct Group by topic action, and its sidebar-menu duplicate is removed. Library Settings omits duplicate window-filter, Auto-group, Rules and Import entries; the sidebar owns those controls. Saved-card menus omit Add link, Add group and Rename where the footer/name already provides them; group Rename menu duplication is removed. The main sidebar Save button is hidden while the selected-tabs toolbar provides Save. Selected-tab Close and collection Remove remain because their scopes differ. The floating switcher retains its own controls. Chrome and Edge native checks verified one Close all, responsive layout and selection behaviour; Chrome verified the direct topic flow.

## Research basis

- https://chromedevtools.github.io/devtools-protocol/tot/Input/ (native drag interception and delivery for mouse-driven regression checks).

- https://help.gettoby.com/support/solutions/articles/66000530625-ai-grouping
- https://help.gettoby.com/support/solutions/articles/66000530626-ai-sort-tabs
- https://github.com/loilo/auto-group-tabs
- https://github.com/metaory/smart-tab-groups
- https://developer.chrome.com/docs/extensions/reference/api/tabGroups
- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.openai.com/api/docs/guides/latency-optimization (combine requests and reduce generated structured output).
- Public Suffix List data: https://publicsuffix.org/list/public_suffix_list.dat (MPL-2.0, retrieved 7 September 2026).

No commit, push or publication is part of this change.


Open-tab menu follow-up (supersedes earlier direct-button placement): removed the highlighted grouping row and Rules shortcut. Both grouping actions now live under …; Grouping rules is back in Settings. Title, Website and Most recent first sort actual unpinned browser tabs in the current window and preserve existing groups. Title uses group names for block order and tab titles within each group; Website uses the first sorted member hostname; Recent uses the most recently accessed member. Sorting runs once, supports Undo and captures the active collection when tracking is on. Both tab surfaces always reflect browser order; the old display-only Browser order choice is removed. Native Chrome and Edge fixtures passed menu placement, Title sort, collection mirroring, pinned/group preservation and full Undo. All 152 unit tests pass. API references checked: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-move and https://developer.chrome.com/docs/extensions/reference/api/tabGroups#method-move .

Settings now offers Collapse all collections. It stores the existing collapsed flag for every collection across spaces in one undoable library operation, without changing contents or tracking. Package syntax and source-byte checks pass.

Save-flow follow-up: the Save popover is two mutually exclusive checkboxes (close or adopt as active); switch dialogs default to unchecked create-new or update-source according to current association, with unconditional Timeline capture. Configured AI names new minimal saves asynchronously, retaining time and respecting manual edits/content changes. See auto-update-audit.md. Protocol is now 20 so stale UI/worker combinations request a reload. Native Chrome/Edge fixtures and 155 unit tests cover the implementation.

Tabme reference UI refresh: see [UI refresh and native drag verification](ui-refresh.md) for the wider sidebar, shared typography, compact toolbar, simplified collection/rule UI, drag scrolling and current verification evidence.
