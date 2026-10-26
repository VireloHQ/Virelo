# Privacy

Virelo runs on the host computer and stores its catalog, settings, thumbnails, watch progress, favorites, cached HLS segments, and optional artwork in the configured data directory. Controller style and accent-color preferences are stored separately for each account and removed when that account is deleted.

## Default behavior

Virelo does not include telemetry, analytics, advertising, cloud account registration, or automatic update checks. The npm server stores its local accounts, password hashes, hashed session identifiers, library permissions, favorites and watch history in its own data directory. Login does not contact a cloud identity service. Administrators manage access locally; they are trusted to control the server and can inspect its stored data. Favorites and watch history are separate for each account. Existing personal data is copied to the first administrator when accounts are initialized.

New installations match filenames against Cinemeta during library scans and cache the returned metadata and artwork locally. Online matching and artwork downloads can be disabled independently by an administrator in Settings. Network access to the server requires an account, but HTTP does not encrypt traffic: use HTTPS or a trusted VPN on untrusted networks.

## Sharing, playback loudness and server announcements

Share links and QR codes are generated locally. They do not contain session
credentials, transfer account permissions or publish the host. Only a directly
connected localhost client can request the server's existing LAN addresses.
Personal playlists and account/settings URLs are replaced with the server home.

Optional volume leveling reads decoded audio locally during playback. The
device-local preference is stored in localStorage; samples and loudness estimates
are not uploaded, stored in the server database or written to original files.

Server administrators may send plain-text announcements. The local database
stores the message, sender reference, creation time, intended account IDs and
each recipient's read timestamp. Other users cannot read or change these records.
The administrator UI does not expose per-user read receipts, but the host owner
can inspect the database. Messages are pruned after 90 days during use and can
be withdrawn sooner. Deleting an account removes its recipient/read records;
messages it sent may remain for other recipients without the deleted sender
reference. Browser clients poll only this server. Virelo developers do not send
messages through this channel, and no email, OS push or third-party service is used.

## Optional activity monitoring

The npm server's **Settings → Admin → Monitor activity** is off by default.
When enabled, a notice appears before sign-in and in the signed-in application.
Only sessions that acknowledge the current notice are recorded; a policy change
requires a new acknowledgement, and older clients without the notice are not
monitored. This acknowledgement confirms notice delivery, not a separate consent
or a guarantee that a person read it.

Administrators can see recently active sessions, the current video, playback
state and position. Live presence expires after 90 seconds without an update and
is not saved across server restarts. The database stores successful sign-ins and
sign-outs, playback starts/pauses/resumes/stops, account and library operations,
metadata/server changes, and favorite/playlist changes. These activity records
contain timestamps, account references, an action and optionally a media ID, not
passwords, session tokens, IP addresses, full file paths, searches or page views.
Video titles are resolved using the viewing administrator's current library
permissions. Playback reports come from the client and are not tamper-proof.

Logs are kept for 30 days by default, with 7-, 30- and 90-day choices and a
10,000-event limit across the server. Expired events are pruned at startup, during
use and once per minute while running. Increasing retention applies only to new
events; existing events never outlive the limit in their original notice.
Reducing retention also shortens the lifetime of existing events.
Disabling monitoring stops new collection
but retains existing logs until expiry or explicit deletion. Administrators can
clear all logs or one user's events. Account deletion removes events involving
that account; a separate administrator action may record its deletion by ID.
These controls do not erase backups or separate HTTP/process logs maintained by
the host or a proxy. Operators are responsible for appropriate privacy notices
and use of monitoring on their server.

## Optional external requests

When online metadata is enabled, Virelo sends the parsed title, media type, release year when available, and season/episode numbers when applicable to Cinemeta. It downloads matched posters, backdrops, and episode images when artwork is enabled. An existing user-provided TMDB key, or the optional `VIRELO_TMDB_API_KEY` environment variable, makes Virelo use TMDB instead for backward compatibility and localized results. Disabling online metadata stops future provider requests initiated by Virelo.

## Optional external tools

The npm server can store custom CLI launchers configured by a localhost
administrator. Names, executable paths, arguments and optional public-address
settings are saved in the local database; recent stdout/stderr is held in memory
and available only to directly connected localhost administrators. Definitions
are not included in general settings or viewer responses. No command starts on
installation, save, page load or server restart.

Starting a command explicitly runs an external program with the server's OS
permissions and environment. That tool may contact its provider, transmit or
modify files, and keep its own credentials and logs. A tunnel can carry video,
metadata and authentication traffic through its operator's infrastructure;
encryption and retention depend on the chosen tool and provider. Review those
policies and avoid putting secrets in saved arguments. Virelo cannot promise
read-only filesystem behavior for user-supplied executables.

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

In **Account Manager → select a user → Data**, administrators can view counts
and separately clear that user's watch history, favorites, playlists or activity
log, or sign the user out on all devices. Each action requires confirmation.
These actions only change Virelo's database. They do not modify original videos,
shared libraries, metadata, thumbnails, artwork or another user's personal data.
Activity entries are shared server records: clearing a user's activity also
removes matching entries from the global activity log.

Administrators can view storage usage and clear unused playback cache in Settings.
This operates only on Virelo-generated playback files, not source videos or their
folders. It does not remove accounts, libraries, metadata, thumbnails, artwork,
favorites or watch history. Files needed by active playback and extracted subtitles
are retained; converted video and audio can be generated again when requested.
