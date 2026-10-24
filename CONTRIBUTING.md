# Contributing

Keep changes focused, add tests for changed behavior, and search existing issues
and pull requests before opening a change. Discuss large features or stored-data
and API changes first. Update public documentation when behavior changes.

New contributions are licensed under AGPL-3.0-only, as described in [LICENSE](LICENSE). Include any required copyright and license notices for third-party material. This does not change the terms under which earlier contributions were received.

Use stable Node.js 22.23.4+, 24.22.1+ or 26.12.1+ within those release lines.
Install dependencies with `npm ci`, then run
`npm run check` before opening a pull request. The check builds the server and
player, typechecks the web app, runs unit/API tests and checks the npm package contents.
CI tests all three supported Node lines on Windows, macOS and Linux, fetching the
latest patch rather than relying on the runner's cached runtime. Update the
runtime guard, package/lockfile engines and documentation together when changing
the supported security baseline.

After building, `npm run audit:package` packs and installs the actual archive with
production dependencies only, audits that installed tree, and checks CLI output,
HTTP startup, assets and first-administrator setup. It uses a fresh temporary
directory, reported in the output, and leaves those isolated fixtures for inspection.
It never uses a personal media folder or data directory and does not publish.

## Browser checks

The scripts in `scripts/audit-*.mjs` cover accounts, favorites, playback,
keyboard controls, responsive layouts and recovery states. They use generated
media, temporary databases and fresh browser contexts.

Install Playwright separately, or set `VIRELO_TEST_NODE_PACKAGE` to its
`package.json`. Set `VIRELO_TEST_CHROMIUM` to the Chromium executable when needed.
FFmpeg/ffprobe must be on PATH for playback audits. Run `npm run build` before
`node scripts/audit-accounts.mjs`; this checks the packaged server and UI together.
Some component audits expect a running Vite development server; inspect the script's
URL/environment options before running it. Never point audit tools at a personal library.

The `media-regressions` CI job installs FFmpeg and a pinned Playwright runtime,
then runs the full checks plus `audit-scan-repair.mjs`, `audit-accounts.mjs`
and `audit-startup-scan.mjs`
against synthetic media. It covers damaged/missing thumbnails, changed sources,
short clips, cache links, historical Windows IDs, account boundaries, deep links,
failed route/startup downloads, offline recovery and uninterrupted Shorts feeds.
The startup audit also checks non-video project folders, request latency during
discovery, stalled scripts/styles and stylesheet-failure recovery.

## Repository hygiene

Keep generated builds, local credentials, personal media, browser profiles and
audit screenshots out of commits. Use synthetic paths and sample data in tests.
Preserve required license notices. Match Node type definitions to the minimum
supported runtime, and test dependency updates before merging.

The npm package is published separately from Git pushes. Do not publish or
create a release tag as part of ordinary development.
