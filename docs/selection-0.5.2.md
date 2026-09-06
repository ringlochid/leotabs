# Neo 0.5.2 — Selection clarity

- The cleanup button owns both its broom icon and circular count, with a 3px gap. It sizes to its content instead of overflowing into Select. Counts above 99 display 99+; the accessible label retains the actual count.
- Select becomes the text Done in the library and overlay. Done ends selection without closing tabs. Saved collections also show text Done while selecting.
- Bulk Close tabs is labelled text, without an ambiguous standalone X. It stays disabled when no eligible tab is selected. Normal individual tab close controls are unchanged.
- The sidebar selection toolbar uses two compact rows above the tabs. Keyboard focus rings are inset so they cannot overlap nearby controls.

## Evidence

The supplied screenshots established the overflow and ambiguous icons. Native button semantics and changing action labels follow [WAI button guidance](https://www.w3.org/WAI/ARIA/apg/patterns/button/); changing Select to Done uses an ordinary button rather than a toggle with a changing accessible label.

The packaged extension was extracted and loaded in an isolated Chrome profile. All 11 core and targeted UI checks passed, with no browser exceptions. The targeted checks verified badge geometry, no horizontal overflow, keyboard focus geometry, visible labels, Done preserving tabs in both surfaces, and Close tabs closing only a selected fixture tab. Both screenshots were visually reviewed.

Results: `output/chrome-1788673903620/results.json`.
Screenshots: `selection-clarity-library.png` and `selection-clarity-overlay.png` in the same directory.

Package validation checked all 37 files, syntax, assets, entry points and generated overlay integrity. No backend behavior changed in this release.
