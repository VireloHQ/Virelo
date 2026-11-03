# Bundled media

Virelo does not provide a movie catalogue. The library and player screenshots use licensed Blender film frames with synthetic viewing histories and favorites. The Shorts demonstration uses licensed Blender film excerpts, not a catalogue included with the player.

| Assets (paths relative to `web/public/` unless noted) | Provenance |
| --- | --- |
| `favicon-*.png`, `virelo-icon*.png` | Maintainer-supplied transparent ribbon logo. `virelo-icon.png` is the original PNG; smaller PNGs preserve its aspect ratio, colors and transparency. |
| `landing/hero-coast.webp` | Project-supplied coastal photograph, declared free to use. Converted to WebP at 2000 × 1121 with metadata removed; composition unchanged. The source license identifier and photographer attribution are not recorded. |
| `assets/demo/*-cinema.webp` (repository root) | Original project-created artwork from earlier captures. Not used by the current landing previews or included in the deployed site. |
| `landing/library-*.webp`, `landing/player-*.webp` | Captures of the current Virelo UI using an isolated demonstration library with Sintel, Big Buck Bunny, Spring, Caminandes 3 and Cosmos Laundromat frames. No personal browser storage or account data is used. |
| `landing/library-credits.txt` | Attribution, official film sources, license links and edits for the library/player screenshots. Linked visibly below the preview and included in built output. |
| `landing/shorts-blender-demo.mp4`, `landing/shorts-blender-demo.webp` | Actual Virelo Shorts screen recording and poster, captured with fresh browser storage. The three portrait clips are cropped, silent excerpts from Big Buck Bunny and Sintel, by Blender Foundation, licensed under CC BY 3.0. No downloaded social-media footage or third-party soundtrack is included. |
| `landing/shorts-blender-credits.txt` | Attribution, source URLs, edits and license links for the Shorts recording and poster. Linked visibly below the phone mockup and included in built output. |

Third-party footage, fonts, icon libraries and packages retain their own licenses; they are not relicensed as AGPL. Font and package license notices are included with the dependencies.

## Blender excerpt credits

- **Big Buck Bunny** — © copyright 2008, Blender Foundation / www.bigbuckbunny.org. [Official attribution requirements](https://peach.blender.org/about/). [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- **Sintel** — © copyright Blender Foundation | durian.blender.org. [Official attribution requirements](https://durian.blender.org/sharing/). [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

The film excerpts and their poster frames are cut, cropped to portrait, resized and muted. Two Sintel excerpts and one Big Buck Bunny excerpt are displayed inside the actual Virelo UI. No complete film is redistributed. The licensors do not endorse Virelo. Complete source and edit details are in `web/public/landing/shorts-blender-credits.txt`.

## Recreate the library and player previews

`node scripts/capture-landing-demo.mjs` starts a localhost-only Vite server,
seeds fresh browser storage and captures the unmodified current UI at desktop
and mobile widths. It requires Playwright, Chromium, FFmpeg/ffprobe and locally prepared
licensed demo inputs, not personal media. Set `VIRELO_DEMO_MEDIA_DIR` to a folder
containing `sintel-demo.mp4`, `sintel-1.jpg`, `bunny-1.jpg`,
`spring-sample-poster.jpg`, `caminandes-3-sample-poster-sharp.jpg` and
`cosmos-laundromat-sample-poster-sharp.jpg`. Use the sources and licenses in
`web/public/landing/library-credits.txt`. Raw working films are not redistributed
with this repository. `VIRELO_TEST_NODE_PACKAGE` can point to an installed
Playwright package's parent `package.json`; `VIRELO_TEST_CHROMIUM` and
`VIRELO_TEST_FFMPEG` can select the browser and encoder executables.

## Recreate the Shorts demo

Use a supported Node.js release (22.23.4+, 24.22.1+ or 26.12.1+ within those release lines), FFmpeg/ffprobe, Chromium and an installed Playwright package:

```sh
node scripts/capture-shorts-demo.mjs
```

Set `VIRELO_DEMO_MEDIA_DIR` to the folder containing the verified, silent 18-second working excerpts `sintel.mp4` and `bunny.mp4`. The default is ignored `node_modules/.cache/shorts-blender/sources/`. These working files are not bundled in the repository. The script verifies their SHA-256 hashes before recording:

| File | SHA-256 |
| --- | --- |
| `sintel.mp4` | `151f543969ebd4643aa0cde14e000d8d0559586f1e9ad693d427cf4179e4c8e2` |
| `bunny.mp4` | `9695b70ed5e4ae939b230dd50422ce5aed24bcc49c0e37c02f2e51365c60d1d7` |

For new source encodes, follow the source/offset details in the bundled credits, review the decoded footage and update these hashes and the script together. Do not substitute unverified files or a different soundtrack.

If Playwright or Chromium is installed outside this project, set `VIRELO_TEST_NODE_PACKAGE` to a `package.json` that can resolve Playwright and `VIRELO_TEST_CHROMIUM` to the browser executable. `VIRELO_TEST_FFMPEG` and `VIRELO_TEST_FFPROBE` can override the tool paths. The capture script starts a localhost-only Vite instance, uses a fresh browser context and an isolated demonstration catalog, verifies that all three clips appear, and checks the final video format, duration and decoding. Generated recordings and working files remain in a temporary directory printed by the script, never in a personal library.

## Social preview

The 1200 × 630 social image at 'og/virelo.png' is a resized, letterboxed export
of the project's Product Hunt device composition, not a generated image. It uses
the maintainer-supplied ribbon mark and isolated Virelo screenshots in laptop and
phone mockups. The on-screen films are Sintel (Blender Foundation, CC BY 3.0) and
Spring (Blender Foundation, CC BY 4.0). Stills are cropped and resized; attribution
is included in the image. Sources and license links are listed in
['landing/library-credits.txt'](web/public/landing/library-credits.txt).

## Adding media

Only contribute media that can be redistributed with this repository. Record demonstrations with project-created or explicitly licensed sample files and fresh browser storage; do not include personal libraries, downloaded social-media clips without permission, account credentials or private local paths. Document the source and any required license notices here.
