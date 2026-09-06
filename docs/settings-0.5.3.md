# Neo 0.5.3 — Settings experience

The supplied Tabme screenshots guide placement, hierarchy and interaction: a top-right settings button opens an anchored list, while longer tasks open focused dialogs.

## Changes

- Settings moved from the sidebar brand row to the far right of the library toolbar.
- The grouped menu offers Theme, Show this window only, and Capture page previews directly. Changes save immediately. Capture access is requested only when enabling that feature.
- AI connection, Notion & Obsidian, and Domain rules each open their own form. Saving one section updates only that section's preferences and relevant credentials.
- Import data and Export & backup are distinct entries. Import features a prominent browser-bookmark option plus an expandable file section. Backup offers Neo JSON and alternative HTML/Markdown formats.
- Focused dialogs use a larger title, consistent padding, a plain close control and a dimmed, blurred backdrop. Data flows still use existing import preview and export implementations.
- Privacy/permissions, keyboard shortcuts and Help remain accessible from the menu.

## Validation

The ZIP was extracted and loaded into isolated Chrome. All 11 core and targeted checks passed without browser exceptions. Settings checks exercised toolbar placement, anchored menu behavior, immediate and persistent theme/scope changes, AI model saving without overwriting unrelated preferences, expandable import, switching to backup, and Escape returning focus to Settings. Screenshots of the menu, import and AI form were visually reviewed.

Browser evidence: `output/chrome-1788674150354/results.json`.

The test used local fixture collections and no real AI, Notion or bookmark import submission. Package validation checked all 37 files, entry points, syntax and generated overlay hashes. Existing capability and permission boundaries are retained.
