# Neo 0.7: session switching and Previously open

## Research and decision

Workona separates saved resources from live workspace tabs. Clicking a space switches its tabs in the current window. Inactive tabs are moved to a minimized browser window, preserving live page state instead of closing and recreating them. Its Previously open control browses dated session backups and restores individual tabs or whole sessions. Workona documents hourly backups during active work and cloud/device synchronization. [Official tab-manager documentation](https://workona.com/help/tab-manager/) · [Extension documentation](https://workona.com/help/extensions/)

The supplied 71-second video was sampled at five-second intervals. It visually corroborates sidebar switching and the Previously open popover; the video’s speed/memory illustrations are marketing, not measured benchmarks. Frames: `output/workona-video-contact.jpg`. The supplied screenshots also informed the timestamp navigation and restore action.

For Neo, keep collection titles editable and add an explicit one-click “Switch to [collection]” action below each header. This avoids accidentally replacing the browser’s working tabs while renaming, folding, expanding or dragging a collection. The searchable Switch collection picker remains available with its Save current tabs checkbox.

## Delivered behavior

- Save current tabs checked: retain existing live tabs in one shared minimized holding window per originating browser window. Returning moves the same tabs back, with native groups and pinned-tab protection. Saved collection contents are not overwritten, and switching no longer creates repeated “Saved…” collections.
- The first unassigned browsing session appears as Previous browsing session in the picker. The active collection is labeled Current; retained destinations show Resume.
- Save unchecked: close outgoing tabs after the destination has opened successfully. A recovery snapshot is still recorded. Normal Open all continues to add pages without switching.
- Previously open: dated window/collection snapshots, older/newer controls, native group labels, a scrollable tab list, single-page restore and Restore N tabs. Closed browser windows are included instead of being discarded by the old flat recently-closed mapper.
- Capture changed tab sets after browsing changes and on switches, with a service-worker-safe one-minute alarm backstop. Identical captures deduplicate. Local retention: at most 200 snapshots, at most 30 days. This is not a full browsing-history recorder.
- The settings-update Undo toast is suppressed, as requested.

## Implementation and limits

`lib/sessions.js` uses Chrome tab/group moves. Live browser IDs are stored in `chrome.storage.session`; durable URL/group snapshots use the new IndexedDB timeline store (database v3). Writes precede source moves/closes. Failed destination creation leaves source tabs available; move failures attempt to return moved tabs without deleting their contents. A marker validates ownership of holding windows. Inactive tabs are excluded from Neo’s open-tab/search list.

[Chrome tab-group move API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups#method-move)

Closing the holding window releases its live state; returning restores saved URLs and reloads pages. Browser/extension restart also clears live-ID associations; dated snapshots remain available through All windows. Chrome may independently discard tabs under memory pressure. No cross-device sync is claimed. The timeline is local to this installation and is not included in the existing portable library export.

Native recently-closed entries are browser-wide and labeled accordingly; the window selector filters Neo’s own snapshots. Restore adds/reuses pages in the current window; it does not replace current work. Native whole-window restoration follows Chrome’s original-window behavior.

## Validation

83 automated unit checks pass, including same-ID/group restoration, shared holding-window isolation, failed writes, failed destination opening, unchecked-save recovery and bounded/deduplicated history.

The packaged extension is tested in a disposable real Chrome profile: live JS draft value survives a round trip, native tab/group IDs survive, holding windows are minimized, inactive tabs are excluded from open tabs, no collection duplicates are created, closed holding-window fallback works, and individual/whole-session restoration and history navigation work. Both themes and the existing core/overlay flows are checked. Production browser tabs were not changed by testing.

Final evidence: `output/unit-0.7.0.txt`, `output/chrome-1788675361158/results.json` (15 checks, zero exceptions), `previously-open-dark.png`, `session-switch-picker.png` in that browser-output directory. Both screenshots were visually inspected.

Verified archive: `output/neo-0.7.0.zip` (40 extension files, 514377 bytes); extracted and tested at `output/release-0.7.0-final`.
SHA-256: `AE90FB9A30BDC9B9A90E5A5FFE2E0E3B36D2C8F7FFDA390B56F1AEBDF78772DE`.
