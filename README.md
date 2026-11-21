<div align="center">
  <img src="https://raw.githubusercontent.com/VireloHQ/Virelo/main/apps/web/web/public/virelo-icon-512.png" alt="Virelo" width="88" />
  <h1>Virelo</h1>
  <p><strong>Turn your video folder into a streaming-style library. No uploads required.</strong></p>
  <p>
    <a href="https://app.virelo.dev/"><strong>Try in your browser</strong></a>
    &nbsp;·&nbsp;
    <a href="https://virelo.dev/setup">Self-host it</a>
    &nbsp;·&nbsp;
    <a href="https://virelo.dev/">Website</a>
  </p>
</div>

![Virelo library with movie posters and a continue-watching row](https://virelo.dev/landing/library-movies-desktop.webp)

*Example library. Virelo does not include movies or other media.*

Virelo gives videos you already own a place to browse and watch. Open a folder directly in your browser, or run a self-hosted server for a library shared on your own network.

## Try it

**In your browser — no signup or installation**

1. Open **[app.virelo.dev](https://app.virelo.dev/)**.
2. Choose a folder containing your videos and grant the browser read access.
3. Browse your library, make playlists, and pick up where you left off.

The browser version reads files from your device. Your videos are **not uploaded** to Virelo, and your library state stays in your browser. Folder access and playback depend on your browser's capabilities and supported codecs.

**Self-hosted — for your own network**

From a folder containing your videos, run:

```sh
npx virelo --here
```

Or run `npx virelo` to start without implicitly adding your current folder. The server has its own account setup and supports multiple users, library permissions, optional movie/series metadata, and network playback. See the [server and CLI guide](apps/server/README.md) and [setup guide](https://virelo.dev/setup).

## What you get

| | Browser player | Self-hosted server |
| --- | --- | --- |
| Start | Open a website and pick a folder | Run `npx virelo` |
| Account | Not required | Required |
| Video files | Stay on your device | Served by your server |
| Library | Thumbnails, search, favorites, playlists, and watch progress | Shared libraries with user permissions |
| Playback | Videos, your own Shorts, and supported local-format conversion | Streaming over your trusted network with FFmpeg |

Both editions are open source, but have independent storage, permissions, and release schedules. The browser player does **not** make a folder available to other devices.

### Your videos, your interface

- **A library worth browsing:** posters and thumbnails, search, folders, favorites, and continue watching.
- **Playlists and queues:** save an order, shuffle, and return later.
- **Your own Shorts:** swipe through portrait videos from your collection.
- **Playback controls:** subtitles, audio tracks, speed, picture adjustments, and optional volume leveling where supported.
- **Personalize it:** player layouts, accent color, and five interface languages.

![Virelo player preview](https://virelo.dev/landing/player-desktop-v2.webp)

*Sample media is for illustration only. Features and codec support differ by edition and browser.*

## Project links

- **[Live web player](https://app.virelo.dev/)** — try Virelo with your own files.
- **[Self-hosted setup](https://virelo.dev/setup)** — run Virelo on your computer.
- **[Web player docs](apps/web/README.md)** · **[Server docs](apps/server/README.md)**
- **[Issues](https://github.com/VireloHQ/Virelo/issues)** · **[Discussions](https://github.com/VireloHQ/Virelo/discussions)** — feedback, bugs, and ideas are welcome.

If Virelo is useful to you, starring this repository helps other people discover it.

## Development

Use Node.js 22.23.4+, 24.22.1+ or 26.12.1+ within those release lines. From the repository root:

```sh
npm ci
npm run check
```

Build either edition with `npm run build -w apps/web` or `npm run build -w apps/server`. Read the [workspace structure](docs/workspace.md), [contributing guide](CONTRIBUTING.md), and [release documentation](docs/releasing.md).

Virelo's player and server are licensed under [AGPL-3.0-only](LICENSE). Third-party code and assets retain their own licenses. The [official website](https://virelo.dev/) is maintained separately.
