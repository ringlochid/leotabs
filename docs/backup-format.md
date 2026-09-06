# Neo portable formats

`neo-tabs`, version 1, contains exported collections. `neo-backup`, version 1, adds spaces, allowlisted settings and a reference recovery log. Neither format is a dump of browser or extension storage. Spaces are an additive field: older files without spaces import into the default space. New backups preserve collection `spaceId` membership; import remaps space IDs with collection membership so existing spaces remain intact. A library supports up to 100 spaces.

A library backup preserves collection and link IDs in the file, collection timestamps, group structure, colours, collapsed state, notes, saved preferences, configured model/endpoint/vault/page IDs and domain rules. Import validates the structure and creates fresh collection/group/link IDs before merging.

Credentials, preview images, browser sessions, closed-page history, full earlier library snapshots, pending Notion bodies and live tab IDs are excluded. Recovery metadata is label/date/original status only; it is restored as an inert archived log. It cannot drive a browser operation. This avoids replaying IDs from another browser session or computer.

The import review optionally restores preferences. It never grants optional permissions or imports API keys. Automatic preview capture is disabled after restoring preferences until the user enables it in Settings. Existing collections are kept, and the import is covered by the normal local undo snapshot.

Bounds: input files up to 20 MB, up to 2,000 collections / 50,000 links after merge, up to 50 domain rules and 100 imported log entries. The importer rejects unsupported schema versions and unknown JSON shapes instead of silently resetting data. HTML flattens deeper nesting into group paths, retaining distinct same-name and empty groups. Markdown preserves headings, link titles/URLs and link notes; arbitrary Markdown formatting is not a complete Neo backup.
