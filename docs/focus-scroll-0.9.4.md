# Neo 0.9.4: keyboard focus scroll clearance

The supplied recording shows a partially visible first row after returning with ArrowUp. Native focus scrolling reveals only the button border box, omitting the card padding and outer focus ring. In the reproduced 0.9.3 case, scrollTop stayed at 10 instead of returning to 0, clipping the upper edge and making the card look shorter.

Arrow navigation now focuses with preventScroll and explicitly reveals the full card with 8px clearance inside the results scroller. It does not scroll the overlay or underlying page. The same bounded reveal helper is used for search-result navigation and focus after closing a tab.

Validation: 95 existing unit tests pass. Packaged Chrome run output/chrome-1788680600266/results.json has 14 checks and zero browser exceptions. The regression fails on 0.9.3 (10px residual scroll) and passes on 0.9.4 (0px), including repeated down/up cycles and a partially visible first row. Card height, first-row position and overlay height remain unchanged; the full focus ring is inside the viewport. Short-viewport coverage also passed in output/chrome-1788680461674. Geometry JSON and screenshots are in each run folder. Package: output/neo-0.9.4.zip.
