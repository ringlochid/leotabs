# Neo 0.9.2: full-width collection views

Removed the 860px expanded-view and 900px list-view width caps. Both now fill the main content area and align with its toolbar. Page padding and the regular grid layout remain.

Packaged Chrome validation: output/chrome-1788679686907/results.json. Fourteen checks passed with zero browser exceptions. Temporary layout probes confirmed the collection width equals the available content width at 2400, 1440 and 768 pixels, with no horizontal overflow. Expanded and list screenshots are in that folder. An initial invocation selected an obsolete overlay-layout suite; rerunning with the current --overlay-scopes suite passed.

Package: output/neo-0.9.2.zip. Verified extracted package: output/release-0.9.2-verified.
