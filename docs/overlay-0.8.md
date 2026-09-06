# Neo 0.8.0: scoped overlay and visual refinement

The implementation follows the approved research direction and the supplied Tab Switcher Ultra photos as references. Ultra’s [store listing](https://chromewebstore.google.com/detail/tab-switcher-ultra-%E2%80%93-the/egfpenlgkaahbopdghjbmkfbpkfogeje) describes its keyboard switching and individual close controls. Neo retains its own collection/session workflows and click/Enter activation. [NN/g icon guidance](https://www.nngroup.com/articles/icon-usability/) informed visible action labels; [W3C combobox guidance](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) informed input and dismissal behavior.

## Behavior

- The overlay starts in This window. All windows expands the scope, with a window label on each result. Changing scopes preserves a plain-text query. No matches in This window offers Search all windows.
- Recently closed shows dated individual tabs and expandable closed windows. Reopen tab opens a page; Restore window restores the Chrome session. Session history is a separate view of Neo snapshots, with individual and whole-session restore. These same closed-session rows are used by the library sidebar.
- The library sidebar now has This window / All windows / Recently closed controls. Its existing Previously open timeline remains available below the list.
- Audio filters open tabs by audible or muted state. The filter remains active when results become empty. Mute/Unmute is available beside applicable tabs.
- Every individual unpinned open tab has a close control. Closing it leaves the overlay open and preserves the current active browser tab when closing a background tab. Middle-click and Delete on a focused tab result also close it. Delete inside search edits text and cannot close a tab. Pinned tabs require unpinning first.
- Collections and Actions are visible entry points, so @ and / syntax is optional. Collections opens a dedicated browser; selected collections expose Open and Swap through the shared action functions. Routine open-tab searches no longer mix saved/closed resource types.
- Selection reveals labeled Save tabs, Group, More and Close N tabs actions. Done exits selection. More contains Ungroup and Rename group. Escape exits the current editing/selection step or dismisses the overlay.
- The wider, rounded overlay uses a restrained blurred backdrop and a readable surface. Larger preview cards have stable action positions and focused outlines. Short viewports initially use a compact list; users can choose Previews. A single labeled Clear action replaces duplicate clear icons. The redundant horizontal collection strip is hidden in favor of the dedicated collection view.

The optional Alt-release quick-switch mode remains deferred as recommended in the research priority; the main overlay stays open until a deliberate selection or dismissal.

## Validation

The real-Chrome disposable-profile checks cover preserved queries, cross-window filtering, individual close without activation, reopening closed tabs, separate session history, audio filtering/unmute, visible collection Open/Swap actions, labeled selection actions, Actions-menu access, safe Delete editing, Escape dismissal, matching library sidebar scopes and 620px reflow. Light, dark and narrow screenshots were inspected. Missing-preview placeholders remain honest; no previews were fabricated. No production browser tabs were used for testing.

Final evidence: 85 unit checks passed (`output/unit-0.8.0.txt`), and 12 real-Chrome checks passed with zero exceptions (`output/chrome-1788676684820/results.json`). Package: `output/neo-0.8.0.zip`; extracted and tested at `output/release-0.8.0-verified`. Screenshot files in that browser-output directory include `overlay-scopes-dark.png`, `overlay-recently-closed.png`, `overlay-collections.png`, and `overlay-scopes-narrow.png`.
