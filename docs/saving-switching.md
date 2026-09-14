# Save and reopen tabs in Chrome or Edge

Save your open browser tabs as a LeoTabs collection so you can close a project and reopen its links later. Collections can keep groups and notes alongside the links. The same workflow works in Chrome and compatible versions of Edge, without an account or an AI connection.

## Save a project for later

1. Open LeoTabs from the lion icon, or press **Alt+Shift+Q**.
2. In **Open tabs**, select the pages you want to save, or leave them unselected to save the eligible tabs in the window.
3. Choose **Save tabs** beside Open tabs. Leave **and close them** unchecked to keep working, or check it when you want to put the project away.
4. Choose **Save tabs** or **Stash tabs**, then give the new collection a name such as “Research — next draft”. Add a note about what you need to do next.
5. Return to the collection and choose **Open** to reopen its links. Choose **Open in new window** from its menu if you want a separate window.

For example, save an assignment brief, two reference pages and a draft document as one collection. Closing those tabs after saving clears the window; opening the collection later restores the links. Save changes inside the document's own app before closing it: a collection does not preserve unsaved forms, scroll position or a page's full application state.

To keep several projects separate, see [organizing tabs and bookmarks by project](library.md). Before changing browser profiles or installations, [export a backup](import-export.md).

## Choose Save, Open or Switch

Choose an action based on whether you want to keep browsing, put work away, or replace the current window's task.

| Action | Result |
| --- | --- |
| Save tabs / Stash tabs | Create a new collection from eligible open tabs; closing is an option |
| Drag into an existing collection | Save the dragged links in that collection while keeping the browser tabs open |
| Open | Open fresh tabs from a collection without replacing your current work |
| Open in new window | Open the collection in a separate browser window |
| Switch | Make a collection current in this window, with choices for the outgoing work |
| Close current collection | Close its managed tabs after saving recovery information |
| Close all currently open tabs | Close the current window's unpinned tabs with recovery information for eligible pages |

## Save tabs

Use **Save tabs**, the tray icon beside **Open tabs**, in the library or switcher. Select tabs first to limit the action. This dialog creates a new collection; it does not have a destination picker.

Local files, including PDFs opened from your device, behave like New Tab pages: they stay visible in open tabs but are excluded from saved collections, Auto-update and reopening. Online PDFs remain ordinary web pages. Older saved local-file links are skipped when reopening a collection.

**and close them** closes the tabs after saving. The confirmation button reads **Stash tabs** when this is checked, or **Save tabs** when it is not. Choosing **Stash tabs** from the search command list opens the dialog with closing selected.

**and switch to new collection** makes the new collection current in this window without reopening its tabs. It requires all unpinned tabs in that window. Closing and switching to the new collection are mutually exclusive.

Dragging open tabs or an open group into an existing collection saves copies of their links. It does not close the original tabs.

If AI has been configured with a saved key and access, a new save can receive an automatic descriptive name. Saving does not wait for that result, and a manual rename is respected. [Understand automatic AI naming](ai.md).

## Open saved work

Choose Open to add fresh tabs, or Open in new window from the collection menu to keep it separate. Use Select if you only want some links. Saved pages can be deferred until activated rather than all loading at once.

An individual saved link always opens a new tab. It does not simply focus an existing copy of the same URL.

## Switch between tasks

Choose **Switch** on the destination collection. Read the outgoing-work choices before confirming. With no active collection, saving current tabs as a new collection is unchecked by default. With an active collection, updating that collection from the current tabs is also a separate, unchecked choice.

A one-time update does not automatically enable ongoing Auto-update. Recovery information is kept for supported switching operations even if you do not retain an outgoing collection.

Pinned browser tabs stay open. Local files, browser-internal and other extension pages are not saved as ordinary links; these utility pages may close during a switch or stash and cannot be reopened by Undo. Saving a URL does not capture unsaved form input or a website's in-memory state.

## Auto-update

The current collection's **Auto-update** switch controls whether changes to this window update its saved links and layout. Pause it to keep the saved collection fixed while you browse elsewhere.

Frequent title changes are combined into short updates. Auto-update records earlier collection versions without creating a full-library Undo snapshot for each change.

Resuming Auto-update immediately updates the saved collection from the window's current tabs, then follows later changes. Check the open tabs before resuming. If the same collection is already tracking another window, switch to that window instead of expecting two windows to update it at once.

**Settings → Auto-update all collections** changes this preference globally for existing, open and new collections. Auto-update and **Auto-group new tabs** are independent: one updates saved work, the other organises live tabs.

Use [Undo, Timeline and version history](recovery.md) if a supported action needs to be reversed.
