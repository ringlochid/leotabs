# Alt focus while the switcher is open

The recording shows bare Alt moving focus to Chrome's menu button while the overlay remains visible. The previous key containment used only `stopPropagation`, which keeps keys away from the webpage but does not cancel their browser default action. [Chromium documents Alt as a menu-focus key on Windows](https://www.chromium.org/developers/accessibility/windows-accessibility/).

The overlay now cancels the default action for the Alt key itself on both keydown and keyup, in a capture listener on its host. This includes the keyup from the opening shortcut. The host receives focus immediately after mounting so the guard also covers loading and error states. Closing removes the guard and restores the prior page focus. The standalone switcher uses the same guard.

The guard does not cancel other keys in Alt combinations, Ctrl/Meta-modified Alt, or AltGraph. The existing shortcut commands and arrow navigation remain unchanged. It does not use a global keyboard lock or take control of browser settings.

Validation: unit tests cover repeated Alt presses, release without a preceding keydown, shortcut/navigation keys, AltGr, and listener removal. The built closed-shadow overlay was exercised with trusted native key events in an isolated Chromium fixture: two Alt presses had defaultPrevented on keydown and keyup; the next Right arrow focused the second result; Alt followed by typing still filtered search; Close restored the launch button's focus. The fixture verifies DOM event cancellation and navigation, not the installed Chrome window's native toolbar.
