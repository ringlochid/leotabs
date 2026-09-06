# Neo 0.5.4 — Inline collection notes

Add note creates and focuses an editor inside its existing collection card. It keeps the board and collection size unchanged. Notes save when editing finishes, as before. A visible Delete note action clears a saved note and offers Undo; deleting an empty draft simply removes its editor. Expanded collections only show a note when one exists or Add note was chosen.

Validation: the packaged ZIP was extracted and tested in isolated Chrome. All 11 core and targeted checks passed with no browser exceptions. Notes were exercised through Add, edit, reload, Delete, Undo and empty-draft removal in normal and expanded views. The card screenshot was visually reviewed. Package checks verified all 37 files and the generated overlay.

Evidence: `output/chrome-1788674309532/results.json` and `note-in-card.png`.
