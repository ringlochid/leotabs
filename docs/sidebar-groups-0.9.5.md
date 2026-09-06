# Open-tab groups — 0.9.5

The library sidebar now places each native browser group inside its own coloured container. Ungrouped tabs remain outside it, making membership clear. The header includes a fold control and tab count; folding survives refresh and library reload. Search temporarily reveals matching tabs without changing the saved fold preference.

Dragging a group header carries the whole group, including members hidden by folding or search. A drag preview shows the group name, count and website icons. Dropping onto a collection saves the group name, colour and members while leaving the browser tabs open. Group checkboxes support whole and partial selection, and range selection follows visible row order.

Validation: 95 unit tests passed. The extracted release passed 14 Chrome checks and 8 Edge checks with no exceptions. The final Edge run also verified keyboard focus restoration after group selection. Light and dark screenshots were visually reviewed.

Evidence:
- output/chrome-1788680914645/results.json
- output/edge-1788680996939/results.json
- output/unit-0.9.5.txt

Release: output/neo-0.9.5.zip. Reload the unpacked extension after replacing its files; the user browser installation was not changed by the disposable-profile checks.
