# LeoTabs website

Static landing, privacy, permissions, support and changelog pages, plus the user guides in docs/. No framework, external fonts, analytics or remote embeds. The only browser script is `website/theme.js`, which remembers a Light/Dark/System preference locally under `leotabs-site-theme`. With JavaScript unavailable, the site follows the system theme and all content remains usable. The privacy article comes from `extension/privacy.html`; edit it there. User guides are sourced from `docs/*.md` and rendered at `/docs/`; do not maintain a second guide copy in HTML. Other pages live in `website/pages/`.

Run `npm run site:build` then `npm run site:check`. Preview **only** `output/site/` with a local static server, for example `python -m http.server 8770 --bind 127.0.0.1 --directory output/site`. Do not expose the repository root to a public web server.

The website and repository README share the user-approved screenshots in `website/assets/`. `library.png` comes from `Screenshot 2026-09-08 194704.png`; `switcher.png` comes from `Screenshot 2026-09-08 194818.png`. Both are unchanged 1920 × 1200 captures. Preserve their proportions and update the alt text when replacing them. Use captures approved for publication, and check visible content before adding new images.

## Before website publication

The public URL is configured as `https://ringlochid.me/leotabs/`, hosted by GitHub Pages. The `origin` field is the complete website base URL, including its trailing slash and any subpath. Run `node scripts/build-site.mjs --release` then `npm run site:check`; the checker verifies every page's canonical URL. Setting `origin` to null produces a noindex preview. Keep the hosting disclosure in `extension/privacy.html` accurate.

Publish the generated website to the separate public repository `ringlochid/leotabs-website`. Deploy the same files under `leotabs/` in `ringlochid/ringlochid.github.io`, whose existing main-branch Pages deployment serves the custom domain. Preserve every other file in that repository, especially its root index, CNAME and existing project paths. Do not configure a second Pages site or CNAME on the website repository: its role is to hold the public website files. No cross-repository deployment token is stored. Verify the domain's Pages build and live URLs after each publication.

Publish **only website files**, never the extension repository or its history. GitHub Pages does not apply the optional `_headers` file emitted for other static hosts; the HTML contains the site's Content Security Policy. A robots.txt inside the project subpath does not control crawling of the whole domain; keep the existing domain-level crawler settings unchanged.

`storeUrl` is the verified live Chrome Web Store listing and is required for the installation buttons. The header links to `ringlochid/leotabs` on GitHub; repository visibility is managed separately from website publication. The GitHub mark comes from [Primer Octicons](https://github.com/primer/octicons/blob/main/icons/mark-github-24.svg), with its MIT licence retained in `assets/octicons-LICENSE.txt` and copied into the published site.

After publication, verify the deployed guides and `/privacy/`, `/support/` and `/permissions/` pages without a login. Check mobile and keyboard navigation and keep the dashboard's homepage, support and privacy URLs aligned with the deployed site. Building locally does not prove deployment.

Google Search Console verifies the URL-prefix property using `website/verification/google345c4ce523429af8.html`. The build copies this file unchanged to the website root, serving it at `/leotabs/google345c4ce523429af8.html`. Keep it in future deployments after verification succeeds.

`/uninstalled/` is the extension's post-uninstall destination. It offers optional email feedback and data-retention information, with no form service, analytics or identifier parameters. Keep the page live before shipping an extension package that registers this URL. It is deliberately marked noindex. The first-install guide is bundled in the library as `extension/ui/onboarding.js` and can be reopened from Settings or Help. There is no separate welcome website or page.
