# Changelog

## Unreleased

- Share bounded media-tool scheduling across video conversion, audio, probing, subtitles and scanning. Reserve an audio/remux slot, fairly rotate waiting accounts, cancel abandoned work promptly and return retry information on overload. Limit decoder/encoder threads and background work, and verify multi-user behavior with isolated synthetic-media regressions.
- Honor compatible-video copying only for verified independent H.264 boundaries without reordered frames; safely re-encode other cases. Include source identity, duration and copy mode in segment cache fingerprints, preserving original files.

- Reuse existing library registrations when a folder is selected through a symlink or Windows junction, as well as normalized path spellings. Preserve stored paths, library/media IDs, permissions and personal state; keep distinct same-named directories separate.

- Rebuild the npm Account Manager around a searchable, compact user table and Profile/Libraries/Permissions/Data/Activity tabs. Group server administration separately, add confirmed per-user database-only data clears and session revocation, and keep original videos untouched.
- Add optional, visibly disclosed live activity and retained operation/playback logs. Default monitoring to off; require the current notice acknowledgement, scope titles to administrator library access, offer 7/30/90-day retention with a 10,000-event limit, and support filtered log review and deletion. Keep passwords, session tokens, IP addresses and file paths out of activity events.

- Add npm-only External tools settings for custom CLI launchers, with explicit start/stop, bounded process output, optional fixed or domain-scoped generated HTTPS addresses, and exact active Host allowlisting. Restrict every command API to direct localhost administrators, keep public cookies Secure, preserve localhost-only administration, and never auto-start tools. Document arbitrary-executable risks and provider-policy responsibilities.

- Keep the first touch on a hidden normal-player overlay reveal-only, without pausing playback, and restart its idle timer. Clear the pending touch intent when a gesture is cancelled.

- Replace the stacked mobile player panel with centered playback controls, top-edge tools and a 44px bottom seek strip over a light edge gradient. Keep title details below the inline video, retain the fullscreen title, fit landscape playback above navigation, and leave repeat in Settings and shuffle in the Queue or fullscreen without duplicating them over the inline picture.

- Make the Library's Playlists entry a filled, bordered navigation button with a list icon, direction arrow and 44px touch target. Keep it visible and usable beside sorting controls on mobile, with keyboard focus and normal link behavior.

- Use the full detail-page text column for titles, with natural wrapping and matching loading placeholders. Keep compact queue drag previews aligned with the pointer in both layouts. Reveal header search beside a fixed toggle, preserve immediate keyboard operation, and replace purple playlist-field frames with a neutral keyboard-focus underline.

- Replace the normal player's toolbar with a translucent media-control panel, title and remaining-time display, circular play/pause, 10-second rewind and 30-second forward. Keep shuffle, previous, next and repeat in a stable order, synchronize queue controls, and expose volume and Picture in Picture outside the ellipsis Settings menu.
- Add device-local 0.25–2× playback speeds with pitch preservation and matching converted-audio rates. Animate pointer-driven Settings and submenu changes, separate options from header dividers, fade idle controls downward, and keep keyboard/reduced-motion operation immediate. Correct recovery-message text contrast in the Web app.

- Add persistent named playlists with creation, renaming, ordered playback, shuffle, queue saving, video additions, drag/keyboard sorting, removal, undo and confirmed deletion. Keep playlists private to each npm account or local to the Web browser, preserve unavailable references and reject conflicting edits without modifying source files.

- Reduce manual quality/audio switching delays with two-second demand segments, fingerprinted shared playback probes and immediate bounded HLS level changes. Switch only the audio when video conversion is already active, start audio at the current position, and preserve pause and selected tracks. Keep versioned caches and source files separate.

- Add editable horizontal and vertical playback queues, including a desktop side panel, touch/keyboard drag sorting, shuffle, repeat toggling, play-next, queue-only removal, undo and reset. Save layout preferences on each device and keep current playback stable during edits and refreshes. Remove competing scroll snapping and load queues beyond 500 videos.

- Complete confirmation-dialog exits through the overlay lifecycle, including interrupted transitions. Read motion durations in milliseconds or seconds so production CSS minification preserves startup timing.

- Consolidate normal-player quality, audio, subtitles, picture adjustments and repeat into Settings. Keep the mobile transport together, remove the redundant Back button and matching loading gap, and label Shorts audio/subtitle controls.

- Unify app motion with 160–250ms feedback, restrained fades and small surface scales. Keep page text and search layout stationary, use reversible dialog/dropdown transitions, and preserve immediate keyboard operation and reduced-motion preferences.

- Keep Shorts controls unobtrusive: remove icon discs and the back overlay while preserving accessible touch targets. Share the normal player's quality, audio and subtitle pipeline with Shorts, including account conversion permissions, selected tracks and Original Quality.

## 0.4.0 — 2026-10-24

### Upgrade notes

- Use stable Node.js 22.23.4+, 24.22.1+ or 26.12.1+ within those release lines. Earlier releases are rejected before data initialization or server startup; these minimums include the October 2026 security fixes, including CVE-2026-111497.
- All server access now requires a local account. After upgrading, open Virelo directly on the server PC using localhost to create the first administrator. That account inherits existing favorites and watch history; media files are unchanged. Existing API clients must sign in and include `X-Virelo-Request: 1` for state-changing requests.
- Startup folders are temporary unless explicitly saved in Libraries. Older indexed folders and personal state remain in the database and can be restored from Previously used folders.
- The project is now AGPL-3.0-only; see LICENSE for the terms and preserved permissions for older MIT releases.

### Changes

- Update both transitive fast-uri release lines to patched versions (3.1.9 and 4.2.3), addressing URI scheme spoofing, relative-reference normalization and host canonicalization advisories.
- Verify the packed release in CI with a fresh production-only installation, dependency audit, CLI and HTTP startup checks, and first-administrator setup in isolated temporary storage.

- Enforce the supported Node.js security baseline in package metadata and at runtime, including direct server creation. Keep help/version available on unsupported runtimes, add rejection-before-data tests, and test the latest patches of Node 22, 24 and 26 in cross-platform CI. Bound test-file concurrency to keep parallel server/media checks reliable.

- Keep cold startup responsive during folder discovery: bound traversal, skip dependency trees, use native recursive Windows monitoring without a startup crawl and distinguish TS recordings from TypeScript. Show a static loading screen independently of pending scripts/styles, recover failed startup CSS and finish active scans before shutdown.
- Harden rescan recovery for changed sources, invalid/truncated images, very short clips, failed generation retries and accurate completed/skipped counts. Bound media-tool processes and keep failed technical probes retryable.
- Remove recursive legacy-cache deletion from scanning. Extract subtitles atomically with shared jobs and source-specific cache keys; reject generated-path links and encode provider IDs within the artwork directory.
- Keep historical Windows IDs consistent for metadata, technical details, favorite UI state and Shorts deep links. Preserve the active Shorts feed during scan refresh, count artwork download failures and cache standalone startup recovery for offline use.
- Add media/browser regression CI alongside the cross-platform checks, using FFmpeg and pinned Playwright with synthetic data.
- Distinguish initial thumbnail generation from missing-thumbnail restoration in scan progress and completion counts.
- Repair thumbnails for every historical Windows case-variant media record, retaining IDs, favorites and watch history. Show each file only once in libraries, Home, favorites and Shorts, and prevent new case-variant duplicates.
- Recognize new web build files without a server restart. Show a recovery screen when startup scripts cannot load, and make navigation error explanations and details readable.
- Normalize library-section spacing and description widths, separating scan help and results from previously used folders while retaining mobile layout and disclosure controls.
- Left-align desktop Settings with the app gutter, widen navigation descriptions and let section descriptions use more horizontal space while preserving mobile section navigation.
- Make rescans restore missing or empty thumbnails and missing downloaded artwork even for unchanged videos, retry missing technical details, report repair counts and refresh library images after completion. Preserve original files and personal viewing data.
- Add administrator-only Data management with storage usage and confirmed cleanup of unused playback cache. Preserve source videos, active playback, extracted subtitles and personal/catalog data; refuse cleanup across media-library overlaps and filesystem links.
- Accept short passwords and PINs without complexity rules; preserve hashing, sign-in rate limits and optional localhost-only administration.
- Separate temporary startup folders from saved libraries. Keep UI-added libraries across startup folders, allow saving temporary/previous folders, and show only the active catalog in Account Manager.
- Preserve indexed media and personal state when deactivating a library; merge Windows path aliases without changing media IDs or grants, and avoid pruning during incomplete/offline scans.
- Group Account Manager into user selection, profile, role/status, library access, actions and network settings with visible section boundaries.
- Add Play all to Favorites in both players, including unloaded pages. Default new quality preferences to Original Quality while retaining explicit selections.
- Replace obsolete development run reports with current contribution and library-storage documentation.

- Require local accounts in the npm server. Add localhost-only first-administrator setup, sign-in/out, Account Manager, per-user library and action permissions, profile/password changes, administrator promotion, disabling/deletion, optional localhost-only administrator access and local CLI recovery. Isolate favorites and watch history, migrate legacy personal data to the first administrator, revoke sessions on account changes, and protect media, cached playback and artwork at the server boundary. Web-only Virelo is unchanged.

- Add a visible eight-ray spark burst when saving a favorite from Shorts, the video player or title details. Keep playback and button layout stable, cancel interrupted effects, and use a gentle fade for reduced motion.

- Open context menus beside the pointer, with edge-aware left/right placement and side-facing bubble tails. Open Video settings beside its context-menu row as a nested panel, preserving the parent menu and keyboard/focus behavior.

- Add a dedicated Video settings bubble with aspect-preserving fit/fill, 90° rotation and brightness, contrast and saturation sliders. Apply changes without reloading playback or modifying files, reset them for each video, and keep subtitles and controls unaffected. Native Picture in Picture retains the original view.

- Use frosted, rounded speech-bubble menus for playback quality, audio and subtitles, anchored to their toolbar buttons with a short entrance transition. Preserve standard background blur in production CSS, improve text contrast and provide an opaque fallback. Keep keyboard opening instant and respect reduced motion.

- Remember audio and subtitle choices across videos and reloads. Restore compatible track configurations without relying on container stream IDs; fall back to each video's defaults for changed, ambiguous or unsupported tracks without overwriting preferences.

- License the current project and new contributions under AGPL-3.0-only, permit commercial use under its terms, and add in-app source/license links. Preserve previously granted MIT permissions and third-party notices.

## 0.3.1 — 2026-10-09

- Match route and data-loading skeletons to the real Home, library, player, detail, settings and Shorts layouts, with restrained surfaces and reduced-motion support.

- Unify app, splash, favicon, social preview and PWA icons with the transparent Virelo logo; refresh asset references to avoid stale cached branding.

- Replace whole-film, all-rendition conversion with on-demand six-second video/audio segments. Preserve full-duration seeking and manual quality ceilings without encoding the skipped prefix or unrequested resolutions.
- Limit the shared playback cache to 512 MiB by default, prune legacy caches and least-recently-used files, protect active responses, limit encoders to two and cancel abandoned requests.

- Group player viewing controls, theme scrollbars, and add keyboard-accessible video context menus that work in fullscreen.
- Add explicit repeat-off, repeat-video and repeat-queue modes, retaining the choice between queued videos and supporting single-item queues.
- Replace framed queue cards with a compact filmstrip; scroll its rail with arrows, wheel, touch and keyboard without changing playback. Keep captions above wrapping controls on narrow screens.

## 0.3.0 — 2026-10-06

- Integrate Home categories into desktop navigation, restore compact featured-title dots and automatic rotation with hover/focus, hidden-tab, visibility and reduced-motion safeguards.

- Start Shorts card playback with the selected video, preserving randomized discovery afterwards and stable pagination; opening Shorts navigation still starts a fresh random feed.

- Improve media-row scrolling in both apps by cancelling wheel easing on button, keyboard and touch takeover, reversing immediately, and retaining native mobile swipes.

- Avoid repeating Recently added titles in the Home Movies shelf; show older library titles or omit the redundant row in small libraries.

- Preserve playback intent across browser-tab suspension; keep separate soundtracks running, catch video up on return, respect explicit/media-key pauses, and recover active Shorts without restarting inactive clips.

- Split player quality, audio and subtitles into independent toolbar controls with single-purpose, viewport-safe menus, keyboard navigation and fullscreen support.

- Persist manual quality ceilings across videos and reloads in both apps; preserve lower-source playback, stop rather than increase quality on conversion failures, and keep HLS initial loads and portrait streams within the saved limit.

- Enrich Home with next episodes, unwatched discoveries, short movies and metadata-driven genre shelves; group series, filter Movies/Series and browse featured titles without automatic rotation.
- Resolve only displayed Home thumbnails in the browser-only app and add responsive, keyboard and shelf-curation regression coverage.
- Remove persistent Shorts play/pause controls, move sound above Like, shuffle each Shorts visit and preserve clip alignment on rotation.
- Respect pause/play intent during quality and audio preparation, cancel stale source restores, and keep preparation overlays off paused playback.
- Add a settings-level bulk metadata reset across all libraries, preserving files, thumbnails, favorites and watch progress without automatic rematching.
- Replace browser confirmation dialogs with Virelo-styled accessible modals, including cancellation, pending protection and inline error/retry.
- Contain field focus, flatten native seek tracks, and fix context-menu event propagation and keyboard focus.
- Keep queue selection stable on refresh and add repeatable browser/FFmpeg regression audits.

- Start playable videos directly on LAN connections instead of waiting for Auto quality renditions; prepare adaptive HLS only after sustained buffering.
- Keep preparation indicators off already-playing video and retain the session's bandwidth estimate between adaptive videos.
- Start compatible HLS from completed segments while conversion continues, copying H.264 video when only audio needs conversion.
- Preserve playback positions during progressive HLS handoffs and keep interrupted caches and failed conversion jobs from being mistaken for ready playback.

## 0.2.1 — 2026-08-22

- Fixed first-play audio fallback starting before FFmpeg had finished writing the converted HLS playlist.
- Stabilized converted audio playback by retrying audio start and resynchronizing it with the video clock.

## 0.2.0 — 2026-08-22

- Added selectable audio tracks and embedded text subtitles to the video player.
- Added progressive, audio-only AAC/HLS fallback for AC-3 and other browser-incompatible codecs without re-encoding compatible video.
- Added cached adaptive HLS playback with Auto bandwidth selection and manual quality controls based on each video's source resolution.
- Fixed playback duration and saved progress while switching adaptive quality levels.
- Made localhost playback direct-play the original file without preparing adaptive variants; LAN playback still defaults to Auto.
- Remembered the selected quality between videos and capped it at each video's source resolution instead of upscaling.
- Made overflowing library and folder chips scroll horizontally with a mouse wheel while preserving native trackpad and touch scrolling.
- Smoothed mouse-wheel movement across overflowing library and folder chip rows.
- Stabilized audio track switching by preserving the video clock, waiting for audio metadata before seeking, and resuming the audio clock after buffering.
- Restored playback positions after HLS source switches without reapplying the item's old saved progress.
- Kept hover previews at the card's original size and removed redundant preview playback controls.

## 0.1.2 — 2026-08-15

- Added setup-free movie and series metadata matching with automatic poster, backdrop, and episode artwork downloads.
- Kept user-provided TMDB keys as an optional compatibility path for localized metadata.
- Added a visible Play All queue with previous, next, automatic advance, and folder-loop behavior.
- Added a current-video loop control and made normal playback start automatically.
- Improved Termux folder watching by ignoring hidden directories and using polling where required.

## 0.1.1 — 2026-08-14

- Improved responsive headers, typography, settings controls and mobile playback navigation.
- Fixed player controls auto-hiding on desktop, phones and tablets.
- Fixed fullscreen playback on iPad.
- Added a dedicated not-found page and normalized dark-theme control states.
- Removed the in-app PWA install prompt.
- Use fixed port `41777` by default for a stable PWA origin, with `--port 0` and `--random-port` available when a conflict occurs.

## 0.1.0 — 2026-08-08

- Initial Virelo release.
- One-command `npx` startup with localhost-only default binding.
- Local library scanning, change watching, SQLite catalog and watch progress.
- Streaming-style responsive React UI built with HeroUI v3 and Phosphor Icons.
- HTTP Range direct play and local FFmpeg HLS fallback.
- Local thumbnail generation and movie/series filename parsing.
- Explicit opt-in TMDB metadata enrichment and separate artwork permission.
- Host/origin validation and restrictive browser security headers.
