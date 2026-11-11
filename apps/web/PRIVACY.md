# Privacy

Virelo Web runs in the browser and does not upload selected video files.

## Stored on this device

The app stores its library index, generated thumbnails, settings, favorites, and watch progress in IndexedDB for the current site origin. Browsers that support persistent directory handles may also store the permission handle needed to reconnect a selected folder.

The original video files remain in their existing folders. Playback uses temporary browser-generated `blob:` URLs.

## Network behavior

Share links and QR codes are generated locally, without an external QR service.
They open the app only; local media, playlist IDs and file handles are not included.
Optional live volume leveling processes decoded audio on this device and stores
its on/off preference in localStorage. Optional scan-time audio analysis is
disabled by default. When enabled, per-track integrated loudness and true-peak
measurements are saved with the library index in IndexedDB. Audio samples are
not retained or uploaded, and original files are not modified. The browser-only app
has no administrator inbox or developer-originated notification feed.

Named playlists, their titles and video references are also stored in IndexedDB
for this browser and site origin. They are not shared or synced to another device.
Deleting a playlist does not affect source videos, favorites or watch history.
Clearing site data removes saved playlists as well as the local index.

Virelo Web loads its application files from the site that hosts it. It does not include analytics, advertising, account registration, external metadata providers, or automatic requests containing video titles and filenames.

## Removing access

Removing a library deletes its Virelo index and generated thumbnails. Folder permissions can also be revoked from the browser's site settings. Clearing site data removes all Virelo Web settings and local indexes for that origin.
