# Contributing to LeoTabs

For substantial features, discuss the user problem before implementing. Small, focused bug fixes and documentation corrections are welcome. Be respectful and make feedback about the work.

## Development

Use Node.js 22+ and `npm ci`. Run `npm test`, `npm run build`, `npm run check` and `npm run package`. Documentation changes need `npm run docs:check`; website changes also need `npm run site:build` and `npm run site:check`. Load `extension/` in a disposable browser profile. Never test destructive operations against someone's everyday session.

Edit overlay sources under `extension/ui/`; rebuild and include changed `extension/overlay.js` and `extension/overlay-build.json`. Do not hand-edit the bundle. Keep existing database names and migration identifiers stable: historical `neo` persistence names preserve user data.

## Pull requests

Explain the concrete problem, resulting behaviour and validation. Use authentic screenshots with synthetic sample data for visual changes. Separate unrelated changes. Add meaningful tests for behaviour, especially data loss, recovery, identity and ordering. Never include browser profiles, API keys, private tabs, ZIPs or diagnostic recordings.

New network requests, permissions, dependencies and retained data need an explicit rationale. Update privacy disclosures and the audit when handling changes. Keep integrations optional and permissions minimal. Treat AI responses as untrusted data; never execute them.

Contributions use MPL-2.0. Keep SPDX headers and third-party attribution, and submit only work you have the right to contribute. No CLA or copyright assignment is requested. Maintainers may decline changes outside the product's purpose or maintenance capacity.

Report vulnerabilities privately under SECURITY.md. Ordinary support: support@ringlochid.me.

## Documentation and repository hygiene

Keep `docs/` user-facing: tasks, settings, integration setup, limits and troubleshooting. The website renders these same Markdown files. Use headings, paragraphs, non-nested lists, tables, links and fenced code; raw HTML is escaped. Add every guide to `docs/README.md` and verify links. Put development setup here; keep personal research, execution logs, release checklists and browser profiles outside the repository.

Use synthetic data in fixtures. Keep `.env` files, keys, recordings and generated output out of commits. Before publishing source, scan both the current candidate and reachable history with Gitleaks (`gitleaks dir` and `gitleaks git --log-opts="--all" --redact`). Use the repository config; its sole allowlist is generated SHA-256 values in the overlay build manifest, which `npm run check` verifies. Inspect every finding rather than broadly excluding tests or source. Store scan reports outside the repository. Removing a current file does not remove prior commits; rotate any exposed credential and coordinate a history rewrite if needed.
