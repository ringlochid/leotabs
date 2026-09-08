# Space reordering

Drag a space name to move it before or after another space. The library reuses the collection drag preview, 28% source opacity, two-pixel accent insertion bar, wrapped-row boundary calculation, and reduced-motion-aware move animation. Space menus also offer Move left and Move right.

The `move-space` edit changes only the ordered `spaces` array through the existing atomic library mutation and recovery record. Selection uses the space ID, so moving a space does not change the selected space or collection membership. Undo restores the previous order. Invalid or deleted targets fail without removing the source space; adjacent and self drops do not create edits. Rename inputs and option buttons do not start drags.

Implementation follows the existing vanilla JavaScript/Chromium drag handlers and [MDN drag operations](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Drag_operations): write the drag payload and image at dragstart, accept the space navigation as the drop target, and clear feedback at dragend.

Initial validation: 178 unit tests passed, including bidirectional/end moves, stale targets, single-space behavior, unchanged memberships, and backup/migration order. An isolated library fixture uses production UI, IndexedDB mutation and Undo with test data. Dispatched drag-event checks covered both directions, cancellation, reload persistence, menu actions, and a two-pixel vertical marker across wrapped rows at 390px. Those synthetic events did not expose the native-event cleanup race described below.

## Native drop cleanup repair

The follow-up recording showed drag feedback but no saved reorder. A native pointer drag reproduced this in the isolated fixture: trusted dragover events showed the faded source, but by the trusted drop listener the source state had already been cleared. The document capture listener queued cleanup as a microtask. Native event dispatch can run a microtask checkpoint between listeners, so cleanup ran before the space navigation's drop handler. A synchronous `dispatchEvent` test kept its JavaScript stack active across the listeners and hid this race. See the [HTML callback cleanup rules](https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-a-callback).

Cleanup is now deferred with a timer until drop handling finishes. Native pointer drags with trusted events were verified before and after the repair: the previously ignored Coding-to-first drop now saves, the reverse drop moves Coding to the end, Undo restores its former position, and the order survives reload. The selected space and its collection remain unchanged. These checks used production UI and IndexedDB with fixture data; the installed extension and personal library were not modified.
