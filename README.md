# Neo — Tabs & Collections

A local Chrome/Chromium extension for finding open pages, saving browser work and resuming only what you need. This repository is the implementation, separate from the earlier interactive concepts.

**Neo 0.8.0 redesigns the overlay around clear search scopes.** This window, All windows and Recently closed are visible choices; Audio is a filter. Individual close/mute controls, a separate session-history view, plain search prompts and labeled selection actions keep everyday work direct. The wider overlay has larger previews, a restrained backdrop and a compact list on short screens. The library sidebar shares the scope choices.

**Neo 0.7.2 adds Ctrl-drag copying and a shared Swap to collection action.** Drag saved tabs normally to move them; hold Ctrl to copy individual tabs, selections or whole groups. Open adds saved pages; Swap replaces the current unpinned session while retaining it for return. Both the library and overlay use the same action.

**Neo 0.7.1 adds confirmed workspace removal.** Remove any workspace from its menu, including its collections, saved tabs and notes. Cancel leaves everything intact; removing the last workspace creates a fresh empty one. Open browser tabs stay open.

**Neo 0.7.0 adds live collection switching and Previously open session history.** Return to retained tabs without reloading them; browse dated local snapshots and restore individual pages or a whole session. See [research, behavior and validation](docs/workona-0.7.md).

Neo 0.5.4 added notes directly inside collection cards. Add note focuses an inline editor without expanding the collection. Delete note removes it with Undo; expanding a collection no longer inserts an empty note automatically.

Neo 0.5.3 moved Settings to the top-right toolbar. A compact grouped menu gives instant theme and browsing controls, focused connection dialogs, and separate import/backup screens. See [settings UX validation](docs/settings-0.5.3.md).

Neo 0.5.2 clarified selection controls. Cleanup has a compact circular duplicate count, Done exits selection, and the separate Close tabs action has a visible label. Focus rings stay inside their controls. See [selection UI validation](docs/selection-0.5.2.md).

Neo 0.5.1 added a searchable Switch collection picker with optional saving. Choose a collection to switch immediately; Save current tabs creates a new collection automatically when checked.

Neo 0.5.0 made everyday actions direct and compact. Collection, group and link options use anchored menus. Open all opens fresh tabs immediately in the current window; Open in new window does the same in a new window. Stash always saves into a new collection with an optional close checkbox. Collections fold, the expand button becomes Restore, selection uses compact icon tools above the lists, and collection dragging shows a before/after insertion line. Organise with AI is visible in the library header. See [the 0.5 UX report](docs/direct-0.5.md). Earlier reports describe historical releases.

## Install the local build

1. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge).
2. Enable Developer mode, choose **Load unpacked**, and select `C:\Users\ring_\Desktop\Neo tab manger\extension`, or the folder extracted from [neo-0.8.0.zip](output/neo-0.8.0.zip). The project root is not an extension folder.
3. If Neo is already installed from this folder, click **Reload** on its existing extension card, then refresh open Neo library pages. Keep the existing installation to retain saved data and shortcuts. The toolbar button opens the library. Alt+Q opens the switcher.
4. Open the shortcut configuration to check or remap Alt+Q (switcher), Alt+Shift+K (search only), and Alt+Shift+L (library). Browser/OS conflicts can leave shortcuts unassigned.

Chrome/Chromium 123 or newer is required. No server, package installation, build step or account is needed for the local core. Node 22 or newer runs the development checks.

## Current behaviour

- Saving captures URLs, titles, groups, order and notes in IndexedDB. It records recovery information before closing any tab. Pinned or subsequently changed instances stay open. Undo restores closed pages as well as the local library change.
- Collection menus offer direct **Open all** and **Open in new window**, with no chooser or progress modal. These additive actions create fresh tabs and load their websites. Use collection Select for opening a subset. Switch collection and Recovery retain deferred preparation for their separate workflows. Open reports completion in a notification and exposes Cancel while running.
- Stash always creates a new collection. Its small popover offers “and close them,” Stash tabs and Cancel. Drag tabs into an existing collection to save them there. The library and overlay share this exact flow.
- Notes and library edits persist locally; JSON, Markdown and bookmark HTML exports stay portable. Imports add separate copies after preview. [Library backups](docs/backup-format.md) include saved preferences/rules and an inert recovery log, excluding credentials and browser session state.
- Spaces contain collections. Create a collection from the final add row; create a space with the top `+`. New collection/group names are selected inline. Click a title to rename it. Collection options include moving it to another space. Hover a saved link and click its `×` to remove it; Undo remains available.
- Both switcher and library search support `@` collection scope and `/` commands. Scoped search lists only that collection's saved links, without extra live/history copies. Save tabs and Switch collection are visible in the main toolbar. Switch collection shows a searchable list and a Save current tabs checkbox. Choosing a row opens that collection and closes the old work, keeping pinned tabs. Saving is checked by default and creates a new collection automatically; clear it to switch without adding a collection. Undo and Recovery retain the close snapshot.
- Alt+Q opens a centered, translucent switcher over the current page. Select enters a separate management mode; Escape exits that mode before closing the switcher. Protected Chrome/extension pages use a bounded extension window because Chrome blocks script injection there. This is a browser experience; it does not replace the Windows desktop switcher.
- Clicking a saved link, including a result inside an @ collection scope, always creates a new browser tab. Bulk Open also creates fresh tabs; it does not reuse existing pages. Drag an open group header to save all its eligible pages, or a saved group header to move it between collections. Moving/removing a group's last link removes that emptied group; intentionally empty groups remain.
- Hover or focus a saved link's note button to read its note. Click to keep it open; Escape, Close, or clicking outside dismisses it.
- Notion creates reviewed snapshots in durable batches. Progress can pause and continue; uncertain writes are not blindly retried. Markdown files remain available without a Notion connection.
- Preview images preserve aspect ratio and are capped at 960 × 720 pixels, without enlarging small sources. Cards are bounded at 340 CSS pixels. Capture is optional, active-page-only, capped at 50 MB and excluded in private windows. Missing previews remain usable. Keys are stored locally in trusted extension contexts, separate from export; this is not keychain encryption.

## Development checks

```
npm test
npm run build
npm run check
node scripts/browser-check.mjs --chrome --polish --search --integrations --recovery --scale --bulk --previews --interactions
node scripts/browser-check.mjs --chrome --redesign
node scripts/browser-check.mjs --chrome --organizer-ux --unified-ux --direct-ux --previews
node scripts/browser-check.mjs --chrome --native-bookmarks --connections
npm run package
```

The browser check uses a fresh task-owned headless Chrome profile and local fixture pages. It never operates the user's normal browser profile. It records destination requests to prove deferred resume does not eagerly load sites, exercises real tab/group/storage APIs, and saves theme/reflow screenshots under `output/`. Omit `--chrome` for the basic Edge route. Connection fixtures use dummy keys, pre-granted permissions in an isolated manifest copy, and localhost service responses; they do not prove access to a user's account. The production manifest keeps those permissions optional.

## Boundaries

Recovery reopens saved URLs and groups; it cannot restore arbitrary unsaved forms, authentication or web-app memory. An interrupted close is never automatically replayed against browser tab IDs after restart. Export before uninstalling, which deletes local extension data. Remote exports have separate outcomes and cannot be undone as local edits.

AI/Notion require the user's own credentials and configured destinations. Live paid provider calls were not exercised with user credentials. Help & privacy is bundled in the extension and available from Settings. The ZIP was independently extracted, checksum-verified and loaded in Chrome; no Chrome Web Store publication or real-profile installation was performed.

## License

The code and accompanying project assets use [MPL 2.0](LICENSE), the file-level copyleft candidate in the research proposal. Source and license notices are included in the extension package. There are no runtime third-party library dependencies or bundled competitor screenshots.
