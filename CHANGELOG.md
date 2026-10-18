# Changelog

## Unreleased

- Add administrator-only Data management with storage usage and confirmed cleanup of unused playback cache. Preserve source videos, active playback, extracted subtitles and personal/catalog data; refuse cleanup across media-library overlaps and filesystem links.
- Accept short passwords and PINs without complexity rules; preserve hashing, sign-in rate limits and optional localhost-only administration.
- Separate temporary startup folders from saved libraries. Keep UI-added libraries across startup folders, allow saving temporary/previous folders, and show only the active catalog in Account Manager.
- Preserve indexed media and personal state when deactivating a library; merge Windows path aliases without changing media IDs or grants, and avoid pruning during incomplete/offline scans.
- Group Account Manager into user selection, profile, role/status, library access, actions and network settings with visible section boundaries.
- Add Play all to Favorites in both players, including unloaded pages. Default new quality preferences to Original Quality while retaining explicit selections.
- Replace obsolete development run reports with current contribution and library-storage documentation.

## 0.4.0 — 2026-10-17

Upgrade note: all server access now requires a local account. After upgrading, open Virelo directly on the server PC using localhost to create the first administrator. That account inherits existing favorites and watch history; media files are unchanged. Existing API clients must sign in and include `X-Virelo-Request: 1` for state-changing requests. The project is now AGPL-3.0-only; see LICENSE for the terms and preserved permissions for older MIT releases.

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
