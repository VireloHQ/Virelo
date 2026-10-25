# Privacy

Virelo runs on the host computer and stores its catalog, settings, thumbnails, watch progress, favorites, cached HLS segments, and optional artwork in the configured data directory.

## Default behavior

Virelo does not include telemetry, analytics, advertising, cloud account registration, or automatic update checks. The npm server stores its local accounts, password hashes, hashed session identifiers, library permissions, favorites and watch history in its own data directory. Login does not contact a cloud identity service. Administrators manage access locally; they are trusted to control the server and can inspect its stored data. Favorites and watch history are separate for each account. Existing personal data is copied to the first administrator when accounts are initialized.

New installations match filenames against Cinemeta during library scans and cache the returned metadata and artwork locally. Online matching and artwork downloads can be disabled independently by an administrator in Settings. Network access to the server requires an account, but HTTP does not encrypt traffic: use HTTPS or a trusted VPN on untrusted networks.

## Optional external requests

When online metadata is enabled, Virelo sends the parsed title, media type, release year when available, and season/episode numbers when applicable to Cinemeta. It downloads matched posters, backdrops, and episode images when artwork is enabled. An existing user-provided TMDB key, or the optional `VIRELO_TMDB_API_KEY` environment variable, makes Virelo use TMDB instead for backward compatibility and localized results. Disabling online metadata stops future provider requests initiated by Virelo.

## Video files

Named playlists store titles and ordered media references in the server database,
separately for each account. Library access rules apply whenever they are opened
or edited. Deleting a playlist does not change media files, favorites or history.
Deleting an account also removes its playlists; a server administrator can still
inspect the database directly.

Temporary startup folders are active only for that server run. Their indexed
paths and personal viewing state can remain in the local database so that opening
the same folder later restores its history. Removing a saved library deactivates
it rather than erasing that index. Administrators can restore previous folders
from Libraries settings; regular users cannot list inactive folders. Deleting an
account removes its favorites and watch history, not the shared video files.

Virelo streams source videos only to clients connected to the Virelo server. Metadata matching never uploads video files to a third party.

## Data management

Administrators can view storage usage and clear unused playback cache in Settings.
This operates only on Virelo-generated playback files, not source videos or their
folders. It does not remove accounts, libraries, metadata, thumbnails, artwork,
favorites or watch history. Files needed by active playback and extracted subtitles
are retained; converted video and audio can be generated again when requested.
