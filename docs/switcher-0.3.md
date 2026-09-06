# Neo 0.3 — floating switcher and organizer repairs

## Research and decisions

The user's 9.32-second recording shows previews repeatedly disappearing into placeholders while the overlay is idle. The source recreated every tile and requested its image again on the 2.5-second refresh. The light overlay over a dark organizer was a separate CSS cascade bug: the injected host's important `all` reset overrode its normal `color-scheme` declaration.

Reviewed before implementation on September 6, 2026:

- [Microsoft acrylic guidance](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic): a translucent material gives temporary surfaces depth and separates them from underlying content. Neo uses a bounded panel with a blurred translucent background, visible page margins, and no entrance animation.
- [Microsoft selection-mode guidance](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/selection-modes): explicit multiple selection exposes checkboxes and a command bar; selecting an item should not navigate. Neo's Select/Done control changes click behavior, counts selected tabs, and enables only applicable operations. Clicking outside doesn't accidentally discard selection mode; Escape exits it first.
- [W3C hover/focus content guidance](https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus): additional content should be dismissible, hoverable, and persistent. Notes open on hover/focus, accept pointer movement into their surface, pin on click, and close with Escape or Close.
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs): browser grouping, ungrouping, activation and creation are separate operations. A live tab activates its instance; a saved link now creates a fresh tab. Native tab/group actions run in the extension worker.

The Windows screenshots supplied by the user are the visual reference for the floating panel and page previews. The organizer keeps its existing Tabme/Notion-inspired spaces and colored collections. No competitor screenshot is bundled in the extension.

## Behavior

- Stable preview DOM and per-session image requests replace placeholder rebuilding. Polling reconciles changed data without detaching unchanged cards. Theme changes update the existing surface.
- Default mode switches live pages and browses a group's pages. Select mode supports individual tabs and whole groups, grouping, inline rename, ungroup, close, and closure Undo. Keyboard navigation and a focus loop remain inside the switcher.
- Saved link clicks and scoped-search link results always open a new tab, even when matching URLs are already open. Bulk Resume keeps its existing explicit reuse/deferred-loading workflow.
- Native group headers drag their members into a collection. Saved group headers move the group and links together, including collapsed groups. Link identity and group metadata are preserved; a rare destination group-ID collision is remapped safely.
- Moving, deleting, or reassigning the last link of a populated group prunes that group's empty container. Intentionally empty groups are retained. The library mutation and its Undo snapshot are committed together.
- Note controls expose the note without opening the link editor or website.

## Validation

The Chrome harness uses fresh disposable profiles and localhost pages, never the user's normal browser tabs. Focused checks exercise the actual injected bundle, real tab/group APIs and native pointer drag payloads. It checks image identity and decoding continuously across more than three polling intervals, both injected color schemes, narrow layout, selection actions, inline text preservation, drag/drop, notes and fresh saved-link opening.

Final release verification:

- `npm run check`: all 34 packaged files, module syntax, entry points, bundle source hashes, assets and optional-host-permission boundary passed.
- `npm test`: 61 passed, 0 failed.
- `node scripts/browser-check.mjs --chrome --organizer-ux --extension=output/release-0.3-1788664140402`: 18 passed, no runtime exceptions. [Exact results](../output/chrome-1788664153366/results.json).
- The preview test samples loaded image nodes every 30 ms across 8.2 seconds of idle polling and a theme update; no image becomes disconnected or undecoded. Both injected light and dark modes are also checked by computed style.
- Native pointer drags verify the browser's actual drag payload and production handlers for native group capture, saved group movement, and moving each last member out.
- Screenshots inspected: [dark switcher](../output/chrome-1788664153366/switcher-dark.png), [light switcher](../output/chrome-1788664153366/switcher-light.png), [Select mode](../output/chrome-1788664153366/switcher-select.png), [narrow layout](../output/chrome-1788664153366/switcher-narrow.png), and [readable note](../output/chrome-1788664153366/note-preview.png). These use localhost test pages, not fabricated product captures.
- Release: `output/neo-0.3.0.zip`, 412,416 bytes, 34 files. SHA-256: `70cf2b89f0c8a2c77c38fff9f78eb343f69182c91884ac779f76e038396952a7`. Every extracted file hash matched the package inventory before Chrome loaded the extracted copy.

The 0.3 validation is scoped to these changes and the harness's core save/resume checks. It does not claim a new large-library stress run or live account integration test.

## Platform boundary and update

Ordinary web pages host the floating overlay without navigation. Chrome blocks injection into protected internal pages; those use a centered, bounded extension window, not a maximized page. A browser extension cannot draw the Windows desktop's native task switcher over browser chrome or other applications. Previews show previously captured pages; unavailable captures remain labeled rather than being fabricated.

Reload the existing Neo card at `chrome://extensions`, then refresh any open Neo library page. Keep the same `extension` directory and existing installation so saved data and shortcut bindings remain associated with it. No user-profile reload or store publication is claimed by the isolated tests.
