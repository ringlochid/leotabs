# Neo 0.8.3 shortcut toggle

Alt+Q uses Chrome's open-switcher command as the single toggle owner. The renderer no longer also closes the overlay on the same key, avoiding two independent handlers for one shortcut. Alt+Q closes an existing search overlay as well as a switcher overlay, even when an inner menu is open.

On protected pages, the second command recognises Neo's own quick.html fallback UI and closes that popup, retaining the original browser window and its tabs. A quick.html page in a normal window closes only its own tab.

Validation includes rapid serialised toggle unit coverage, search-mode close, popup close, and a real Chrome command-path integration test for open/close/reopen, menus, source-tab preservation and protected pages. The integration test invokes the command implementation; synthetic renderer key events are separately checked to ensure they do not double-handle the shortcut. It does not automate the physical OS keypress.
