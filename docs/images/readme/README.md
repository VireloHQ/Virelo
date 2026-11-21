# README artwork

These are real Virelo screenshots, not generated interface illustrations.
`scripts/render-readme-assets.mjs` wraps the public screenshots in a 28px rounded
canvas and exports WebP with transparent corners. The source screenshot pixels
are otherwise unchanged apart from WebP encoding. No CSS support on GitHub is
required. Both images are 1440×810 and individually bounded to 500 KB.

Sources:

- Library: <https://virelo.dev/landing/library-movies-desktop.webp>
- Player: <https://virelo.dev/landing/player-desktop-v2.webp>
- Full preview credits: <https://virelo.dev/landing/library-credits.txt>

The library is an illustrative metadata collection, not a set of included
movies. Posters/backdrops are supplied by Cinemeta and MetaHub and belong to
their respective rightsholders; they are not licensed under Virelo's AGPL.
Attribution is not a grant of rights to those posters.

Player frame: **Sintel**, © Blender Foundation, <https://durian.blender.org/>.
License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
The original frame is from the public Virelo player preview; only the outer
image corners and encoding have changed.

The two SVG links are self-contained vector artwork with rounded backgrounds;
they contain no scripts, external fonts or embedded remote images.

Regenerate from the monorepo root after installing workspace dependencies:

```powershell
$env:VIRELO_TEST_CHROMIUM = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node scripts/render-readme-assets.mjs
```

Omit the browser override if Playwright Chromium is installed. No private Site
source or personal library data is copied into this public repository.
