<div align="center">
  <img src="https://raw.githubusercontent.com/VireloHQ/Virelo-Web/main/web/public/virelo-icon-512.png" alt="Virelo" width="128" />
  <h1>Virelo Web</h1>
  <p>Turn a local video folder into a private streaming-style library, entirely in your browser.</p>
</div>

## What it does

Virelo Web runs at [app.virelo.dev](https://app.virelo.dev). Choose a folder and the app builds a local library with thumbnails, search, favorites, watch progress, queues, and Shorts. The product website is [virelo.dev](https://virelo.dev).

### Backups and browser migration

In **Settings → Export / Import**, export either settings only or your library and settings. Library backups include folder registrations, favorites, watch progress, metadata, and playlists, but not video files, artwork, or folder access permissions. Backups contain private library information; store and share them accordingly.

Importing settings updates preferences without replacing your library. Importing a library requires an empty browser library to prevent overwriting existing data. Reconnect each folder in Settings after importing; the original video files are never changed.

Users arriving at `virelo.riyo.me/app` with saved data can export it before opening the new app. The old library remains available from that migration screen; a redirect alone cannot move browser storage to another origin.

This repository contains the standalone player. The official marketing website and setup pages are maintained separately and are not part of this open-source distribution. Building or self-hosting the player does not require private website source or credentials.

Video files are read through browser file APIs. They are not copied to Virelo, uploaded to a server, or sent to a third party.

## Features

- Share the app using the labelled button in Settings → Sharing or beside video actions. The locally generated QR has rounded modules/corners and a centered Virelo logo embedded in the downloadable PNG. This opens Virelo on another device; it does not transfer local videos, folders, playlists or permissions.
- Optional **Settings → Playback → Volume leveling**, also available in the player's Audio menu, attenuates loud audio without amplifying quiet recordings. It is off by default, saved on this device and shared by normal videos, Shorts and selected tracks. Manual volume/mute still apply and the 30ms lookahead is unchanged.
- **Settings → Libraries → Analyze audio during scans** optionally measures each audio track's integrated LUFS and true peak. It is off by default; long scans take longer. Cached measurements allow constant, non-positive gain targeting −18 LUFS with −3dB peak headroom, preserving each video's quiet/loud contrast. Unanalyzed tracks use live stereo estimates. Source files are never changed or uploaded; browser audio processing support is required.
  Browser analysis currently supports files smaller than 2 GB, up to 64 audio tracks, 8 channels and 192 kHz. Larger or unsupported recordings keep live leveling; the self-hosted server can analyze larger files with native FFmpeg.
- Folder selection with the File System Access API and a compatible folder-input fallback.
- Local indexing, thumbnails, favorites, settings, and progress stored in IndexedDB.
- Named playlists stored in the same browser, with ordered playback, shuffle, queue saving, drag/keyboard sorting and confirmed deletion. Removing a playlist never changes source files, favorites or watch history.
- Direct playback from temporary `blob:` URLs, with pitch-preserving 0.25–2× speed and synchronized converted audio.
- Video settings: fit or crop to fill, rotate in 90° steps, and adjust brightness, contrast and saturation without modifying files or changing quality. Adjustments reset for each video and do not apply to native Picture in Picture.
- Selectable embedded audio and text subtitle tracks for Matroska videos.
- Audio and subtitle preferences, including subtitle Off, retained across videos and reloads. Compatible track configurations restore the choice; changed, ambiguous or unsupported tracks use the video's defaults without overwriting preferences.
- Local AC-3/E-AC-3 to AAC audio conversion when the browser cannot decode the selected track.
- Local AVI playback and thumbnails, including Xvid/DivX, with on-demand AVC/AAC conversion, selectable audio, quality changes and seeking. Original video files are never rewritten.
- Responsive Home, Library, Favorites, Details, Player, and Shorts views.
- Installable PWA shell.
- No accounts, analytics, advertising, metadata providers, or file uploads.

## Appearance

Open **Settings → Appearance** to choose Virelo, Streamline, Theater or Centerstage controller layouts and an accent color. Custom colors are adjusted for readable controls. Appearance settings are stored in this browser; there are no accounts or server-side preferences. Controller layouts apply to normal videos; Shorts keep their vertical controls. No video files are changed.

## Browser behavior

Live volume leveling is disabled on Safari/iOS WebKit to avoid native-HLS
audio-routing problems. Original playback remains available. The implementation
does not claim full-file EBU R128 or true-peak mastering conformance.

The player, library and settings support English, Japanese, Simplified Chinese, Korean and Russian. They initially follow the browser's preferred supported language, with English as the fallback. Change language in **Settings → Appearance → Language**. The choice is shared across tabs and the official website on the same origin; if browser storage is blocked, it remains available in the current tab. Translations are bundled with Virelo. User filenames, titles and playlist names are not translated. See [Localization](docs/LOCALIZATION.md) to add a language.

Folder access requires a secure context, so production must use HTTPS. Browsers that can persist directory handles can reconnect the same folder after permission is granted. The fallback keeps selected files available for the current session and may ask for the folder again after a reload.

Selecting an already registered folder with direct folder access refreshes the
existing library instead of creating a duplicate, preserving its ID and personal
state. Different folders with the same name remain separate. The folder-input
fallback cannot expose a unique directory identity, so same-name selections must
use **Reconnect** rather than Add folder; ambiguous selections are never merged.
Previously created duplicate entries are not automatically deleted.

Playback support still depends on the video formats and codecs supported by the browser. For Matroska files, Virelo Web can convert selected AC-3/E-AC-3 audio to AAC and extract SRT/SSA/ASS subtitles entirely on the device. Where browser encoders are available, lower video qualities are prepared incrementally from the current position. No media is uploaded and original files stay unchanged.

AVI playback loads a self-hosted FFmpeg WebAssembly decoder only when needed
(approximately 10 MB compressed on first use). Input files are mounted read-only;
only four-second playback segments are generated, and paused playback does not
convert the rest of the file. Seeking starts a new window at the requested time.
"Original" retains the source resolution but requires AVC/AAC conversion for
browser compatibility. Browsers must support MediaSource with AVC/AAC. AVI files
must be smaller than 2 GB; unusually high resolutions, damaged files and unsupported
codecs can still fail. Embedded AVI subtitles are not currently extracted. On
slower devices or for larger AVI files, use the [local Virelo server](https://github.com/VireloHQ/Virelo).
Native MP4/WebM playback does not load this decoder. See the
[FFmpeg notice and corresponding-source links](LICENSES/FFmpeg-NOTICE.txt).

Open **Playlists** from Library or desktop navigation. Add videos from their
details or save a playback queue, then use **Save changes** to keep order/name
edits. Browser playlists are not cloud-synced; clearing this site's browser data
also removes them. Missing library references are retained and skipped during
playback. Concurrent edits cannot silently overwrite each other.

## Development

Use stable Node.js 22.23.4+, 24.22.1+ or 26.12.1+ within those release lines.
These minimums match the CLI and include the
[October 2026 security fixes](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
The deployed web player itself does not require Node.js on the viewer's device.

```bash
npm ci
npm run dev
```

Run the complete local check with:

```bash
npm run check
```

With FFmpeg and Playwright available, run `npm run build` followed by
`node scripts/audit-avi.mjs` to verify AVI playback, thumbnails, audio selection,
seeking and source-file integrity against the built app.

## Build and deploy

```bash
npm run build
```

Deploy the generated `dist` directory to a static host. No Worker, Pages Function, server process, database binding, or API key is required.

### Cloudflare Pages

Connect `VireloHQ/Virelo-Web` using **Pages Git integration** and use:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | React (Vite) |
| Root directory | Repository root (leave empty), not `web` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | `22.23.4`, pinned by `.node-version` |

If `NODE_VERSION` is already set in the dashboard, align it with `.node-version`. Do not set the install command to omit development dependencies: TypeScript and Vite are build dependencies. For push-triggered builds, create a Git-integrated Pages project rather than a Direct Upload-only project. See the [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [Node.js version settings](https://developers.cloudflare.com/pages/configuration/build-image/).

Vite copies `_headers`, `_redirects`, and `404.html` from `web/public` to `dist`. Only application routes receive the SPA shell; missing scripts and styles return a real 404. HTML, the manifest, and the service worker revalidate on each load, while hashed `/assets/` files use immutable caching. The CSP permits same-origin LP video, local `blob:` media/workers, and WebAssembly audio codecs without allowing JavaScript `eval` or third-party connections.

To test these host rules locally (Vite preview does not apply them):

```bash
npm run build
npx wrangler pages dev dist
```

Verify `/`, `/settings`, `/library`, `/playlists`, and a direct `/watch/<id>` URL on `app.virelo.dev`. That hostname exposes the player without an `/app` prefix; local and other deployments keep the existing `/app` routes. Retaining the same HTTPS origin preserves browser library storage and settings; a preview or another hostname has separate browser storage. The official site's root and setup URLs are provided by a separate deployment. This repository keeps `vercel.json` for rollback compatibility; it is not used by Pages.

### Deployment verification

After a Git-triggered build succeeds, run `npm run verify:deployment` (or pass
another production URL). This checks player routes, scripts, the full AGPL license,
PWA assets and missing-module handling. Marketing pages and their SEO checks run
in the separate website project. A successful push alone does not deploy
a site. When a repository is recreated, reconnect it in the hosting dashboard;
the same repository URL can refer to a different repository ID.

`node scripts/verify-app-migration.mjs` additionally checks the live domain migration,
backups, language handoff, mobile settings and offline PWA in disposable Chromium
profiles. It never opens or modifies your normal browser profile.

### Workers Builds

The same static build can be hosted with Workers Builds. Reconnect the existing
Worker to the intended repository and production branch, and keep its build
command and static asset directory aligned with `npm run build` and `dist`.

### Recommended headers

```text
Cross-Origin-Opener-Policy: same-origin
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## Privacy

See [PRIVACY.md](PRIVACY.md). Browser permission controls remain the source of truth: removing a library clears its Virelo index, while site settings can revoke the browser's underlying folder permission.

## Bundled media

See [ASSETS.md](ASSETS.md) for the provenance of the logo, sample artwork, screenshots and original Shorts recording, and instructions to recreate the demo without private files or third-party footage.

## License

Copyright (c) 2026 Virelo contributors.

The player is licensed under the [GNU Affero General Public License, version 3 only (AGPL-3.0-only)](LICENSE). Commercial use and sale are permitted under its terms. Distribution requires the corresponding source, and modified versions that users access over a network must offer those users the corresponding source at no charge. Private modifications used only by their author do not need to be published.

The separately maintained official website is not included in this player license. Previously granted MIT and AGPL permissions remain unchanged, including for website material in this repository's earlier history. The last combined public snapshot is `2b08b686d8216450b8855d123d9d90e04b80a287`. See [BRANDING.md](BRANDING.md) for the separate branding policy; it does not restrict lawful self-hosting or revoke existing copyright permissions.

Source and build instructions are available in [this repository](https://github.com/VireloHQ/Virelo-Web). When distributing or hosting a modified build, provide the source and build instructions for that exact build and update the app's source link. Your video files and library data are not subject to this source-code requirement.

Permissions for any material previously received under MIT are unchanged. The legacy Virelo MIT notice is preserved in [LICENSES/LEGACY-MIT.txt](LICENSES/LEGACY-MIT.txt); it does not license new changes under MIT. Third-party dependencies and assets retain their own licenses and required notices.

The software is provided without warranty; see [LICENSE](LICENSE) for the full terms.
