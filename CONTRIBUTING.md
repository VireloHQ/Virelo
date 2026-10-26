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

After building, `node scripts/audit-multiuser.mjs` checks simultaneous Range
requests from 16 accounts, shared cold/warm conversions, audio during a video
backlog, a 20-segment burst and shared native-process limits. It needs FFmpeg
and ffprobe, starts a separate server on an ephemeral localhost port, and removes
its generated media and isolated account data afterward. Reported timings are
local regression measurements, not a supported viewer count or network benchmark.

## Browser checks

`node scripts/audit-communication.mjs` checks locally generated QR/link sharing,
administrator publishing/withdrawal, private inbox read state and real decoded
audio with leveling on/off. Synthetic clips with different mastering levels
verify gain, manual volume, mute, seeking and Shorts. It uses an ephemeral server
and generated files, removes media/account fixtures, and keeps screenshots in
the reported temporary directory. Set `VIRELO_TEST_WEB_REPO` to include Web checks.

`node scripts/audit-playlists.mjs` verifies named-playlist creation, editing,
reopening, queue saves during playback, conflict recovery and confirmed deletion
on desktop and mobile using isolated storage and generated media. The Web checks
also cover the version-1 database upgrade, concurrent writes and temporarily
unavailable references. Set `VIRELO_TEST_PLAYLIST_SCENARIO` to `desktop`, `mobile`
or `small` to run one size. The npm checkout also accepts `VIRELO_TEST_WEB_REPO`.

The scripts in `scripts/audit-*.mjs` cover accounts, favorites, playback,
keyboard controls, responsive layouts and recovery states. They use generated
media, temporary databases and fresh browser contexts.

Install Playwright separately, or set `VIRELO_TEST_NODE_PACKAGE` to its
`package.json`. Set `VIRELO_TEST_CHROMIUM` to the Chromium executable when needed.
FFmpeg/ffprobe must be on PATH for playback audits. Run `npm run build` before
`node scripts/audit-accounts.mjs`; this checks the packaged server and UI together.
Some component audits expect a running Vite development server; inspect the script's
URL/environment options before running it. Never point audit tools at a personal library.

After building, `node scripts/audit-shorts-playback.mjs` checks real Shorts playback,
quality conversion, embedded subtitles, seeking, favorites and clip transitions at
desktop and touch widths using generated media and an isolated server. Set
`VIRELO_TEST_WEB_REPO` to a browser-only checkout to run the same checks there too.
Screenshots and test data are left in the reported temporary directory.
It also checks the normal player's consolidated Settings menu, single-row mobile
transport, audio choices, picture adjustments, keyboard navigation and fullscreen.
The switching checks use distinct synthetic audio tones to verify selected tracks
after forward/backward seeks, paused quality changes, audio-only changes without
video reloads, and returning to Original. Timings describe the test machine only.

`node scripts/audit-motion.mjs` checks stable content positions, Switch timing,
Dropdown dismissal, Modal focus/scroll locking and fixed-layout search controls
at desktop, portrait and landscape sizes, including keyboard and reduced-motion
operation. It also accepts `VIRELO_TEST_WEB_REPO` and uses isolated app data.
Set `VIRELO_TEST_SLOW_CPU=4` to repeat the checks with browser CPU throttling,
including rapid dialog dismissal during entry.

The `media-regressions` CI job installs FFmpeg and a pinned Playwright runtime,
then runs the full checks plus `audit-scan-repair.mjs`, `audit-accounts.mjs`,
`audit-startup-scan.mjs`, `audit-shorts-playback.mjs` and `audit-motion.mjs`
against synthetic media. It covers damaged/missing thumbnails, changed sources,
short clips, cache links, historical Windows IDs, account boundaries, deep links,
failed route/startup downloads, offline recovery and uninterrupted Shorts feeds.
The startup audit also checks non-video project folders, request latency during
discovery, stalled scripts/styles and stylesheet-failure recovery.

## Repository hygiene

`node scripts/audit-queue.mjs` starts an isolated Vite server with synthetic media
and mocked catalog data. It checks horizontal/vertical scrolling, touch and keyboard
drag sorting, shuffle, repeat, context menus, undo and uninterrupted playback on
desktop and mobile, including reduced motion. It never uses a personal library.
Set `VIRELO_TEST_QUEUE_SCENARIO` to `desktop`, `mobile`, `small` or `reduced`
to run one scenario. Queue edits affect only the current watch session; resetting
or leaving the queue does not change library contents or source media.

Keep generated builds, local credentials, personal media, browser profiles and
audit screenshots out of commits. Use synthetic paths and sample data in tests.
Preserve required license notices. Match Node type definitions to the minimum
supported runtime, and test dependency updates before merging.

The npm package is published separately from Git pushes. Do not publish or
create a release tag as part of ordinary development.
