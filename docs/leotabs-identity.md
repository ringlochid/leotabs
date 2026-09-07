# LeoTabs lion identity

Selected design: Soft lion. Canonical source: `extension/icons/lion.svg`.

## Final colour and shape contract

- Only the lion and its fine contour are painted; everything outside remains transparent.
- Default / no active collection: warm amber `#d18b2c`.
- Active collection: its exact configured fill colour, including when auto-update is paused.
- The contour is dark `#26313d` for light fills and light `#f7f9fc` for dark fills. This follows the existing luminance threshold; it does not depend on the webpage theme or alter saved collection colours.
- The 128-unit viewBox is tightly fitted. The packaged 16px icon paints across 16 columns and rows, with all four corners transparent. This is the painted bounding box, not a filled square.
- Toolbar canvas rendering, dynamic SVG favicon and packaged PNGs derive from the same paths. The default SVG is present in the HTML head before JavaScript loads.

The previous Library code explicitly selected lavender when no collection was active, while the toolbar fell back to the old purple PNG. Both paths now share one default. The worker also refreshes existing tab identities on startup. No browser-theme detection or animation is used.

## Design research, 8 September 2026

Visually inspected the current Chrome Web Store icons for [Todoist](https://chromewebstore.google.com/detail/todoist-for-chrome-planne/jldhpllghnbhlbpcmnajkpdmadaolakh), [Bitwarden](https://chromewebstore.google.com/detail/bitwarden-password-manage/nngceckbapebfimnlniiiahkandclblb) and [Raindrop](https://chromewebstore.google.com/detail/raindropio/ldgfbffkinooeloadekpmfoklnobpien). Todoist and Bitwarden pair one strong colour with white internal shapes; Raindrop uses a compact cluster of related blues. These are visual references, not comparative usability measurements or claims about every installed toolbar state.

Decision: retain the recognisable lion and one collection colour, with a contrasting contour rather than multiple decorative hues. Against a representative dark toolbar `#3b3b3b`, the former navy fill measures 1.01:1 and the new amber fill 3.97:1. On white or coloured backgrounds the contour provides additional separation. These ratios describe specified colours, not a guarantee for arbitrary themes or antialiased pixels. [W3C non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) explains both the 3:1 guideline and thin-edge antialiasing limits.

[Chrome action documentation](https://developer.chrome.com/docs/extensions/reference/api/action) specifies a 16-DIP toolbar icon and supports runtime canvas ImageData. Manifest/action icons use PNGs; the SVG remains the editable master and Library favicon.

## Generation

`node scripts/icons.mjs` generates `lib/identity-art.js` and transparent PNGs at 16, 20, 24, 32, 48, 64 and 128 pixels. The Windows `scripts/icons.ps1` entry point forwards to it. Install Sharp as build tooling with `npm install --no-save sharp`, or supply `--sharp=/path/to/sharp` to use an existing installation. No renderer is shipped as a runtime dependency.

## Verification

- 175 unit tests passed, including invalidation/retry, window isolation, exact collection fill, default restoration, contour contrast, transparent canvas and canonical-source checks.
- 32 browser-rendered fixture checks passed: PNG alpha/colour/size, actual Path2D rendering, mock-browser action calls across windows and switch/close, and real SVG favicon decoding.
- Visually inspected the current artwork at 16, 20, 24, 32 and 48 CSS pixels against light, dark and teal backgrounds.
- Package validation and diff whitespace checks passed; rebuilt `output/neo-0.13.0.zip`.
- The browser checks use a local rendering fixture, not the user's personal installed extension. Reload the extension and refresh existing Library tabs to apply these changes.

Local previews: `output/leotabs-lion-icons/visibility-comparison.png` and `runtime-preview.html` (the latter is served from the repository root because it imports production modules).
