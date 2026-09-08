# Browser regression tests

These scenarios follow [Chrome's end-to-end testing guidance](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing): load the unpacked extension in a real browser and check its UI, service worker, storage and native tab operations. They complement the unit tests run by `npm test` and use Node.js 22 with the Chrome DevTools Protocol.

Build first, then select the scenarios relevant to your change:

```sh
npm run build
npm run test:browser -- --list
npm run test:browser -- collection-drag saved-drag drag-placement
npm run test:browser -- save-flow recovery
npm run test:browser -- --all
```

The runner defaults to Chrome at its standard Windows installation path. `--edge` selects Edge; `--executable=/path/to/browser` supplies a different installation path. Use `--extension=/path/to/extension` to test a separate unpacked build. Switcher capture checks use Chrome's extension debugging API to grant temporary page access.

Each scenario starts a separate headless browser with a fresh profile and a local fixture server. Your regular browser profile is not used. Bulk checks open up to 500 disposable tabs and take longer than the focused UI checks.

AI and Notion scenarios use local HTTP fixtures and dummy credentials. Permission-dependent scenarios modify a copy of the extension inside their output directory. The Notion fixture redirects its API requests to the local server.

Results, failure details and screenshots are written to `output/browser/<scenario>-<id>/`. The runner exits unsuccessfully if any selected scenario fails and continues to report the remaining cases. It closes each test browser when the scenario finishes; profiles remain in ignored output for diagnosis.

To add coverage, put the case here and register its export, description and fixture requirements in `scenarios.mjs`. Use an existing scenario when the workflow is already covered. Assertions should verify user-visible behavior or data integrity; wait for the expected state rather than relying on a fixed delay. Keep fixtures self-contained so named cases can run independently.
