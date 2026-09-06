# Chrome and Edge favicon parity — 0.9.6

## Reproduction and cause

The supplied Chrome screenshot showed the original page title with Neo's icon in the native tab strip, while the library showed the correct site icon. Reproduced with Chrome 152.0.7977.76 using a green-and-white fixture icon distinct from Neo. Both restored tabs reported the expected PNG data URL through chrome.tabs, but one native tab still painted Neo's icon after immediate discard. Reloading only that local placeholder restored the correct visible icon without visiting its destination. This supports a discard/render timing defect; the browser API metadata alone is not a reliable native-paint readiness signal.

The previous fixture served Neo's own icon as the website icon. That was inadequate visual evidence and has been replaced with tests/fixtures/site-icon.png.

## Repair

Deferred restore retains the inert local placeholder rather than immediately discarding it. Original titles and cached site icons remain visible, and selection still navigates to the saved destination. The upgrade repair also reloads existing inactive discarded placeholders even when their API metadata looks correct. This extra repair runs once per installation upgrade; subsequent worker starts respect browser memory-saver discards. Generic missing identities continue using the existing repair path.

This trades the small local placeholder document's memory for dependable native identity. Destination websites remain unloaded until selected. No RAM benchmark is claimed, no new permissions were added, and active tabs or missing saved records are left alone.

## Verification

- 96 unit tests passed: output/unit-0.9.6.txt.
- Final packaged Chrome: 14 checks, no exceptions, output/chrome-1788681718310/results.json.
- Final packaged Edge: 8 checks, no exceptions, output/edge-1788681728842/results.json.
- Actual native window captures showed correct site icons in both browsers, beyond API assertions. Captures: C:/Users/ring_/AppData/Local/Temp/neo-native-chrome-fixed.png and C:/Users/ring_/AppData/Local/Temp/neo-native-edge-fixed.png.
- Tests verified zero destination-page or favicon network requests during deferred restore and upgrade repair, then destination loading on activation.
- The exploratory pre-fix Chrome run reproduced the icon defect; its later overlay check failed after interactive diagnostic changes. Final clean packaged regression runs passed.

## Research

Chrome documents the extension favicon cache endpoint at https://developer.chrome.com/docs/extensions/how-to/ui/favicons. Chromium's native icon path reads the favicon driver's image in https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/favicon/favicon_utils.cc. Current upstream source informed the metadata-versus-rendering investigation; the defect and fix were verified experimentally on the installed browser versions, not inferred from an upstream bug report.

Package: output/neo-0.9.6.zip. Replace the unpacked extension files and reload to run the upgrade repair. The user's installed extension and browser data were not modified during testing.
