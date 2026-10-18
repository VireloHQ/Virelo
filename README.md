<div align="center">
  <img src="https://raw.githubusercontent.com/VireloHQ/Virelo/main/web/public/virelo-icon-512.png" alt="Virelo" width="128" />

  <h1>Virelo</h1>

  <p>Turn any folder into a private, streaming-style video library.</p>

  <p>
    <a href="https://github.com/VireloHQ/Virelo/stargazers"><img src="https://img.shields.io/github/stars/VireloHQ/Virelo?style=flat-square&logo=github&label=Stars" alt="GitHub stars" /></a>
    <a href="https://github.com/VireloHQ/Virelo/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/VireloHQ/Virelo/ci.yml?style=flat-square&logo=github-actions&label=CI" alt="CI status" /></a>
    <a href="https://www.npmjs.com/package/virelo"><img src="https://img.shields.io/npm/v/virelo?style=flat-square&logo=npm&label=npm" alt="npm version" /></a>
    <a href="https://github.com/VireloHQ/Virelo/blob/main/LICENSE"><img src="https://img.shields.io/github/license/VireloHQ/Virelo?style=flat-square&label=License" alt="AGPL-3.0-only license" /></a>
  </p>

  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="#features">Features</a> ·
    <a href="#cli">CLI</a> ·
    <a href="#development">Development</a>
  </p>
</div>

> Virelo runs on your machine, keeps your video files where they are, and gives them a fast web interface with search, progress tracking, favorites, and Shorts.

## ⚡ Quick start

Run Virelo in the folder you want to serve:

```bash
npx virelo
```

Virelo scans the current directory, starts at `http://127.0.0.1:41777`, and opens in your browser. On first use or after upgrading from a version without accounts, create the first administrator using this localhost address on the PC running Virelo, then sign in to your library.

To serve another folder without changing directories:

```bash
npx virelo --media ~/Videos
```

### Termux

On Android, install a current Termux release from [F-Droid](https://f-droid.org/packages/com.termux/) or [Termux GitHub releases](https://github.com/termux/termux-app/releases), then run:

```bash
pkg update && pkg upgrade
pkg install nodejs ffmpeg
termux-setup-storage
npx virelo --media "$HOME/storage/shared/Movies" --no-open
```

Open `http://127.0.0.1:41777` in your browser. Pass `--media` explicitly instead of starting Virelo from your Termux home directory so package caches and other personal files are not treated as a media library.

If port `41777` is already in use, let the operating system choose an available one:

```bash
npx virelo --media ~/Videos --random-port
```

<details>
<summary><strong>Windows example</strong></summary>

```powershell
npx virelo --media "C:\Users\You\Videos" --random-port
```

</details>

## ✨ Features

| | | |
| --- | --- | --- |
| 📚 | **Library** | Recursive scanning, folders, search, and sorting. |
| ▶️ | **Playback** | Range streaming, seeking, watch progress, and queue controls. |
| 🎛️ | **Video settings** | Fit or crop to fill, rotate in 90° steps, and adjust brightness, contrast and saturation without modifying files or changing quality. |
| 📱 | **Shorts** | A vertical feed for portrait videos with swipe-friendly controls. |
| 💜 | **Favorites** | Save videos and Shorts with the heart; browse every saved item in Favorites. |
| 🖼️ | **Artwork** | Automatic movie and series metadata, posters, backdrops, and episode images. |
| 🌐 | **Responsive UI** | Works on desktop, tablet, and mobile screens. |
| 📦 | **PWA** | Install Virelo as an app when supported by your browser. |
| 🔒 | **Private by default** | Localhost binding, local accounts, per-user library permissions, no telemetry, and no advertising. |

## 🧭 CLI

```text
virelo [options]

-m, --media <path>  Use a media directory (repeatable)
-d, --data <path>   Store data and cache in this directory (default: ~/.virelo)
-H, --host <host>   Bind address (default: 127.0.0.1)
-p, --port <port>   HTTP port (default: 41777; use 0 for an available port)
    --random-port   Select an available HTTP port automatically
    --no-open       Do not open a browser
    --reset-password <username>
                    Recover an administrator's password locally, then exit
-h, --help          Show help
-v, --version       Show version
```

### Common commands

```bash
# Serve the current directory
npx virelo

# Serve multiple directories
npx virelo --media ~/Movies --media ~/Clips

# Use a custom data directory
npx virelo --media ~/Videos --data ~/.config/virelo

# Allow access from a trusted local network
npx virelo --host 0.0.0.0

# Select an available port explicitly
npx virelo --port 0
```

If `--media` is omitted, Virelo serves the directory where the command is run. Supplying `--media` replaces that default for the current run.

## 🎞️ Media support

Virelo recognizes common movie and episode naming patterns:

```text
Movies/
  Blade Runner (1982).mkv

Series/
  Example Show/
    Season 01/
      Example.Show.S01E01.mkv
      Example.Show.S01E02.mkv
```

Supported containers include MP4, M4V, MKV, WebM, MOV, AVI, WMV, MPEG, TS, M2TS, FLV, OGV, and 3GP. Browser codec support determines whether a file can play directly.

## 🧰 Optional tools

Virelo works without FFmpeg for formats supported by the browser. Installing `ffmpeg` and `ffprobe` adds:

- thumbnails and media probing
- codec detection
- selectable audio tracks and embedded text subtitles
- on-demand audio-only AAC/HLS fallback for incompatible audio, without re-encoding video the browser can already play
- Auto video quality that adapts to network conditions, plus manual resolution selection up to the source quality

Virelo can automatically match filenames to movie and series metadata, then cache posters, backdrops, and episode artwork locally. Configure this from **Settings → Metadata**. Source video files are never sent to the metadata provider.

Audio and subtitle choices, including subtitle Off, are saved in your browser. Compatible track configurations restore the selected track even if stream IDs or order change. Different configurations use that video's defaults without overwriting the saved choices; ambiguous or unsupported tracks are not guessed.

## 💾 Data

The default data directory is `~/.virelo`:

```text
~/.virelo/
  virelo.db
  thumbnails/
  artwork/
  cache/
    segments-v1/  # requested video/audio segments, shared size limit
    hls/          # extracted text subtitles and legacy caches
```

Videos stay in their original folders and are never copied into the data directory. Use `--data <path>` to choose another location.

The current directory or `--media` folders are temporary for the current run.
Use **Settings → Libraries → Save library** to keep one, or **Add folder** to save
any other readable folder. Saved libraries remain available when Virelo starts
elsewhere using the same data directory. Previous startup folders do not fill
Account Manager; administrators can restore them from **Previously used folders**.
Older databases retain those folders and their watch history without guessing
which ones were intentionally saved. See [Library storage](https://github.com/VireloHQ/Virelo/blob/main/docs/libraries.md).

New playback sessions default to **Original Quality** on both local and network
connections. Explicit quality choices are remembered. Favorites has **Play all**
to queue the entire matching collection, including items beyond the first page.

Converted playback uses **six-second segments generated only when the browser requests them**, at the requested resolution/audio track. Choosing Auto does not pre-convert every rendition or the whole movie. Directly playable files still use HTTP Range playback without conversion. At most two segment encoders run concurrently; abandoned requests are cancelled.

Playback cache is limited to **512 MiB by default** across video and audio. Unused least-recently-used files are removed automatically; currently served segments are protected. Legacy whole-film caches are included in the budget and pruned on normal server startup. Originals, the library database, artwork and thumbnails are outside this playback-cache budget. Deleted converted segments can be regenerated from the originals when needed.

Set `VIRELO_CACHE_MAX_MB` before starting the server to change the playback-cache budget (128–65536 MiB). This controls disk usage, not the browser's short playback buffer.

Administrators can open **Settings → Data management** to view the data directory
and storage used by the database, thumbnails, artwork and playback cache. **Clear
cache** removes only unused generated playback files, with confirmation. Active
segments, extracted subtitles and unrelated files are retained. The cache is
recreated as needed; accounts, library settings, metadata, favorites and watch
history are not reset. Cleanup is refused if the cache overlaps a current or
previous media library, or contains filesystem links.

Virelo is a player: it never deletes, moves, renames or edits source video files.

**Scan** also checks the files behind cached images, even when source videos have
not changed. Missing, empty or invalid/truncated image containers are regenerated,
and missing technical details are probed again. Changed videos get fresh thumbnails;
short clips fall back to their first frame if necessary. Cached image checks inspect
container headers and endings, not every decoded pixel. Missing downloaded artwork is fetched again when online
metadata and images are enabled; manually cleared metadata stays cleared. The
scan result reports completed video checks, additions, updates, newly generated
and restored thumbnails, and errors (including failed artwork downloads).
Lists and failed images refresh after completion without a page reload. A playing
Shorts feed keeps its ordering until you leave it, so a scan cannot switch its video.
Source changes use a separate subtitle cache key rather than deleting cache folders.

## 🔐 Network access

Virelo binds to `127.0.0.1` by default. To access it from another device on a trusted LAN:

```bash
npx virelo --host 0.0.0.0
```

Startup prints a URL for every detected IPv4 address the server listens on, including Wi-Fi, Ethernet, VPN and virtual adapters, with adapter names. With `--host ::`, it also prints browser-compatible IPv6 addresses (and IPv4 addresses if dual-stack listening is available). Scoped/link-local IPv6 addresses that browsers cannot open are omitted. URLs use the actual selected port, including `--random-port`.

Local-only startup explains how to enable network access. Displayed addresses do not guarantee reachability: routing, firewall rules and Virelo's Host allowlist still apply.

The npm server requires a local Virelo account. On first use (including upgrades), open the server's localhost address **on the PC running Virelo** to create the first administrator. Remote devices cannot claim an unconfigured server. Existing favorites and watch history are copied to this first account; video files and libraries are preserved.

In **Settings → Account Manager**, administrators can add, disable or delete users, reset passwords, promote other administrators, and choose each account's allowed libraries. New users see no libraries until granted access. You can select all libraries (including future additions), or an explicit list. Library access applies to search, Home, Shorts, playback, subtitles and artwork, not just navigation. Favorites and watch history are separate for every account.

Passwords may be short PINs; no minimum length or complexity rule is imposed.
Use a stronger password or localhost-only administration on untrusted networks.

Playback, transcoding, library management, scanning and metadata editing can be granted separately to regular users. Adding/removing libraries is a trusted filesystem-management permission: that user can add folders readable by the server. Global server settings and Account Manager remain administrator-only. Administrators may limit their own browsing, but can change permissions, so this is not a security boundary between administrators.

Accounts without conversion permission play the original quality and default audio without overwriting saved playback preferences. Source formats unsupported by the browser still need an administrator to allow conversion.

Use **Settings → Account** to change your display name, username or password (with the current password), or sign out. Account and permission changes invalidate existing sessions. Do not share administrator credentials.

Account Manager also offers **Administrators can only access from localhost**. Change this option on the server PC. It blocks all administrator access from non-loopback connections, including normal browsing, while regular users can still connect over the network. Forwarding headers cannot turn a remote request into a local request. A local reverse proxy or tunnel that hides the client address is an exception: see [SECURITY.md](SECURITY.md) before using this option behind a proxy.

If you forget an administrator password, stop Virelo, then run this **locally on the server PC**, using the same data directory:

```bash
virelo --data /path/to/virelo-data --reset-password your-username
```

This prints a new temporary password once, re-enables that administrator, and revokes their sessions. Restart Virelo, sign in on localhost and replace the password in Account settings. Omitting `--data` uses the default data directory. Recovery never deletes libraries or video files.

Passwords do not encrypt HTTP traffic. Use a trusted LAN, HTTPS reverse proxy or a trusted VPN; do not expose the HTTP port directly to the internet. For HTTPS termination at a proxy, set `VIRELO_SECURE_COOKIES=1` and configure the trusted Host as described in [SECURITY.md](SECURITY.md).

See [SECURITY.md](SECURITY.md) before exposing Virelo beyond the host computer.

## 🛠️ Development

```bash
git clone https://github.com/VireloHQ/Virelo.git
cd Virelo
npm ci
npm run check
node dist/cli.js --no-open
```

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the server and web app |
| `npm run typecheck:web` | Type-check the web app |
| `npm test` | Run the test suite |
| `npm run check` | Build, type-check, test, and inspect the npm package |
| `npm run dev:web` | Start the Vite development server |
| `npm run dev:server` | Build and run the server in watch mode |

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

<details>
<summary><strong>Stack</strong></summary>

The web app uses React, Vite, HeroUI, Tailwind CSS, TanStack Router, TanStack Query, Zustand, Phosphor Icons, and hls.js. The server uses Fastify, Node SQLite, chokidar, and optional FFmpeg tools.

</details>

## 🚀 Releases

Version tags matching `v*` trigger the npm publish workflow. Configure the repository's `NPM_TOKEN` secret before creating a release tag.

```bash
npm version patch
git push --follow-tags
```

The package name `virelo` and the CLI command `virelo` are intentionally the same, so the published package starts with `npx virelo`.

## 🤝 Contributing

Issues and pull requests are welcome. If you find a bug, include your operating system, Node.js version, Virelo command, and the relevant terminal output.

## 🔒 Privacy

Virelo has no telemetry, analytics, advertising, cloud account registration, or automatic update checks. Server accounts and permissions stay in your local data directory. Metadata matching sends parsed filenames and media identifiers only; video files remain on your device. An administrator can disable online metadata and artwork in Settings.

See [PRIVACY.md](PRIVACY.md) for details.

## 📄 License

Copyright (c) 2026 Virelo contributors.

The current project is licensed under the [GNU Affero General Public License, version 3 only (AGPL-3.0-only)](LICENSE). Commercial use and sale are permitted under its terms. Distribution requires the corresponding source, and modified versions that users access over a network must offer those users the corresponding source at no charge. Private modifications used only by their author do not need to be published.

Source and build instructions are available in [this repository](https://github.com/VireloHQ/Virelo). When distributing or hosting a modified build, provide the source and build instructions for that exact build and update the app's source link. Your video files and library data are not subject to this source-code requirement.

This change does not revoke permissions already granted for copies previously released under MIT. The original notice is preserved in [LICENSES/LEGACY-MIT.txt](LICENSES/LEGACY-MIT.txt); it does not license new changes under MIT. Third-party dependencies and assets retain their own licenses and required notices.

The software is provided without warranty; see [LICENSE](LICENSE) for the full terms.
