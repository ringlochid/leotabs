# Neo 0.8.4: restore native group folders

Library and Close now sit beside the view controls in the search row. Audio stays on the right of the lower navigation row, followed by Select / Done and the icon-only More actions button.

Native browser groups are folder-like cards again. They retain flat group-coloured frames and show up to four member previews in a small grid. Clicking a folder normally opens its member tabs inside the overlay. The All tabs button returns to the top level.

In selection mode, clicking a folder selects every tab in that group. Clicking a fully selected folder deselects it. Browse group opens its members without losing selection; returning to the top level shows a partial selection indicator (including aria-pressed=mixed). Clicking that partial folder selects the remaining members. Searching or filtering Audio still exposes matching individual tabs.

Existing Alt+Q toggle behavior remains unchanged. Real cached previews are used; unvisited pages retain their own placeholders.

Validation covers folder browsing, all/partial/cleared group selection, unchanged browser active tab during selection, swapped control rows, flat group colours, normal close/mute/scope actions, keyboard toggling and protected-page fallback. Unit results: output/unit-0.8.4.txt (87 passed). Release: output/neo-0.8.4.zip.

Chrome results: output/chrome-1788678245451/results.json (13 checks, zero exceptions). Screenshots of the restored folder cards, partial selection and narrow layout are in the same directory.
