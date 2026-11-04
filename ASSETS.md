# Player assets

The public player bundles the maintainer-supplied ribbon logo (`web/public/virelo-icon*.png`
and `favicon-*.png`), required font/icon notices, and the locally executed FFmpeg
runtime described in `LICENSES/FFmpeg-NOTICE.txt`. It does not include a film catalogue
or marketing screenshots and demo recordings.

The `.webp` ribbon variants are lossless encodes of the supplied 512px and 1024px
PNGs. The splash selects a resolution appropriate to the display and retains PNG
fallbacks; its design and motion timing are unchanged.

The official website's source, images, product facts, SEO files and capture tools
are maintained separately. Their last combined public snapshot is commit
`2b08b686d8216450b8855d123d9d90e04b80a287`. That Git history remains available;
previously granted MIT, AGPL and Creative Commons permissions are unchanged.
Legacy artwork in `assets/demo/` is not used or included in the player build.

Third-party packages, fonts, icons and previously published Blender excerpts retain
their own licenses and attribution requirements. The player license does not
relicense those third-party works. Branding is addressed separately in [BRANDING.md](BRANDING.md),
without revoking copyright permissions already granted.

Only contribute assets that can be redistributed under their recorded licenses.
Do not commit personal media, browser storage, credentials or generated audit files.
