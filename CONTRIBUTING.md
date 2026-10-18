# Contributing

Keep changes focused, add tests for changed behavior, and search existing issues
and pull requests before opening a change. Discuss large features or stored-data
and API changes first. Update public documentation when behavior changes.

New contributions are licensed under AGPL-3.0-only, as described in [LICENSE](LICENSE). Include any required copyright and license notices for third-party material. This does not change the terms under which earlier contributions were received.

Use Node.js 22.16 or newer. Install dependencies with `npm ci`, then run
`npm run check` before opening a pull request. The check builds the server and
player, typechecks the web app, runs unit/API tests and checks the npm package contents.
CI also tests Node 24 on Windows, macOS and Linux.

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

## Repository hygiene

Keep generated builds, local credentials, personal media, browser profiles and
audit screenshots out of commits. Use synthetic paths and sample data in tests.
Preserve required license notices. Match Node type definitions to the minimum
supported runtime, and test dependency updates before merging.

The npm package is published separately from Git pushes. Do not publish or
create a release tag as part of ordinary development.
