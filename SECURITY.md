# Security

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub private vulnerability reporting for the `VireloHQ/Virelo` repository and include the affected version, reproduction steps, and expected impact.

## Runtime security updates

Virelo supports stable Node.js 22.23.4+, 24.22.1+ and 26.12.1+ within those release
lines. The CLI checks this before creating data or loading the server; direct
server creation also checks before initializing storage. Help and version output
remain available on unsupported runtimes. npm's `engines` declaration alone is
not sufficient because npm normally treats it as advisory.

These minimums include the
[October 2026 Node.js security fixes](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases),
including the Brotli decoder vulnerability CVE-2026-111497. Node's built-in fetch
decodes compressed responses from metadata and artwork providers, so local-only
listening and account authentication do not replace updating the runtime.

Keep Node.js and optional FFmpeg/ffprobe installations updated. `npm audit` checks
published npm dependency advisories, not the Node.js executable, system media
tools, operating system or hosting configuration. A clean audit is not a guarantee
that the entire installation is free of vulnerabilities.

## Network exposure

Virelo binds to `127.0.0.1` by default. All media, catalog and management APIs require an account, even on localhost. Only the account-status, login, initial-setup and logout endpoints are public. Initial administrator setup is restricted to a direct loopback connection and is atomic. The login screen does not list accounts.

Binding to `0.0.0.0` makes the service reachable from other devices. Authentication is not transport encryption: HTTP exposes credentials and cookies to anyone able to observe the connection. Use only a trusted LAN, a trusted VPN, or an HTTPS reverse proxy. At an HTTPS-terminating proxy, set `VIRELO_SECURE_COOKIES=1` on Virelo so session cookies are never sent over HTTP. Configure the proxy to overwrite, not append untrusted client forwarding headers. Virelo does not enable `trustProxy`.

Do not expose the Virelo HTTP port directly to the public internet.

## HTTP protections

Virelo validates `Host` and `Origin` headers and sends a restrictive Content Security Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a same-origin resource policy, and a no-referrer policy.

Loopback, private IPv4 ranges, link-local and private IPv6 ranges, `.local` names, and single-label LAN hostnames are accepted. A reverse proxy using another hostname must explicitly allow it:

```bash
VIRELO_TRUSTED_HOSTS=media.example.com virelo --host 0.0.0.0
```

This allowlist does not provide authentication.

Address ranges are checked as IP literals, not as DNS-name prefixes. Public
hostnames that resemble private addresses still require an explicit allowlist
entry or a running custom command's exact public hostname.

State-changing API requests require `X-Virelo-Request: 1` in addition to a valid session. Cross-origin requests are rejected and cross-origin credential sharing is not enabled. Session cookies are host-only, HttpOnly and SameSite=Strict. Passwords are stored using salted scrypt (N=32768, r=8, p=3); plaintext passwords and raw session tokens are not stored. Hashing concurrency and login attempts are bounded. Sessions expire after seven days at most or 24 hours without requests, with up to 32 sessions per account.

Downloaded metadata is limited to 16 MiB per JSON response and artwork to 32 MiB
per image. Limits count the received, decompressed bytes rather than trusting
`Content-Length`; oversized transfers are cancelled and partial images removed.

## Permissions and revocation

Library allowlists are checked on the server for collections, media IDs, source streams, range requests, artwork, subtitles and cached/converted playback. Hidden media returns 404. Viewer responses omit filesystem paths. Media and API responses use private, no-store caching; the service worker caches only the public application shell.

New users have no library access by default. Favorites and watch history are account-specific; only the first administrator inherits legacy personal data. Global settings, bulk metadata reset and account administration require administrator status. Regular users may receive specific playback, transcoding, library-management, scanning and metadata-editing permissions. Library management permits access to folders readable by the server and must only be granted to trusted users.

Changes to passwords, names, roles, permissions or enabled state revoke that user's sessions and close their active media responses. Deleting an account removes its personal state, not media files. The final enabled administrator cannot be disabled, demoted or deleted. Signing out clears the current session and its active media responses; tabs on the same origin synchronize account changes when browser messaging/storage is available. Data already downloaded, cached by older versions or buffered by a client cannot be recalled. Do not share an OS/browser profile when that distinction matters.

Administrators have full administrative trust even if their browsing is restricted to selected libraries: they can grant themselves access. This feature does not isolate mutually untrusted administrators or protect against someone who can read or modify the data directory. Protect OS permissions and backups accordingly.

Generated playback files must stay inside non-linked cache directories; cached
responses and cleanup reject symbolic links, junctions and hard-linked targets.
Registered library roots are canonicalized, and source reads must still resolve
inside the same granted library. Playback probes and subtitle conversion recheck
the current session, permissions and library access after asynchronous work.
Safe generated artwork can still be displayed when a source drive is offline.

If a configured or retained library overlaps the playback cache, startup skips
pruning and cache operations return `409` without removing that library. Sign-in,
management and direct original playback remain available. Use separate media and
data directories to restore conversion and cleanup.

Legacy roots reached through ancestor aliases, such as macOS `/var` and
`/private/var`, can be repaired by explicitly re-adding the same physical folder
through library management. This retains its library ID, media IDs, grants and
personal state. Canonical and alias spellings resolve to the same catalog entries.

A legacy root that is itself a symbolic link or junction is different: its target
may have changed. Re-adding the intended physical folder creates or selects a
canonical library without transferring the old root's grants or adopting its
media IDs/history. An administrator must review and grant the canonical library
explicitly. The ambiguous old library and personal records remain retained and
fail closed; do not edit database paths to bypass that protection. Generated
artwork accepts ancestor aliases above its approved folder, but not links at or
inside that folder.

If an ambiguous old library already occupies the exact canonical media path in
the database, rescanning skips that file rather than transferring its ID or
personal history to the new library. To index those files without modifying the
originals, use a separate data directory (a fresh catalog), retain the old data
directory as a backup, and explicitly recreate the approved grants. Personal
history is not automatically merged between catalogs.

These checks do not isolate an attacker with the same OS/filesystem privileges.
Such an attacker can race file operations or change the database and originals
directly. Run Virelo under a non-administrator OS account and protect its data.

## Activity monitoring and user data

Activity configuration, live sessions, retained events and per-user data controls
are administrator-only APIs. Monitoring is disabled initially and records only
sessions acknowledging the current, visibly disclosed policy. Policy revisions
invalidate previous acknowledgements. The enable/disable policy operation itself
can be recorded for the administrator changing it. This is notice delivery, not
a compliance or consent mechanism. Existing clients without the notice are not
monitored. Successful operations use an explicit event allowlist; request bodies,
passwords, tokens, IP addresses and filesystem paths are not copied into activity
events. Titles are resolved through the viewing administrator's library scope.

Playback state and positions are client-reported and can be omitted or falsified;
these logs are not a tamper-proof security audit. Live reports are bounded and
expire after 90 seconds. Events are retained for the configured 7/30/90 days,
bounded to 10,000 records, and periodically pruned. Disabling monitoring stops
collection without deleting retained events. User-data clears require the same
authentication and same-origin protections as other administrative mutations,
and operate on account-owned database rows only. Session revocation also closes
active media responses; deleting history, favorites or playlists never changes
original files or shared libraries. See [PRIVACY.md](PRIVACY.md) for retention,
notice and deletion details.

## Localhost-only administrators

Passwords and PINs have no minimum length or complexity requirement; an empty
password is not accepted. A 1024-byte limit bounds hashing input. Passwords are
salted and hashed with scrypt, and sign-in attempts are rate limited. Short PINs
are intended for trusted local use, not exposure to the public Internet.

The optional **Settings → Admin** restriction blocks administrator accounts unless the direct socket peer is loopback and there are no forwarding headers. It applies to login and existing sessions, not just management endpoints. Regular users remain accessible over the network. Change the restriction only from a direct localhost connection on the server PC; changing it revokes other administrator sessions.

Proxy markers include `Forwarded`, `X-Forwarded-*`, `X-Real-IP`,
`CF-Connecting-IP` and `True-Client-IP`. Their presence denies local-only
capabilities; their values never grant them.

**A local reverse proxy, SSH tunnel, or port forward can make a remote client appear to be localhost.** No HTTP application can recover an original address that such an intermediary discards. Do not use the localhost-only option as a guarantee against remote access behind a header-stripping loopback proxy or tunnel. Preserve forwarding headers (Virelo treats those connections as non-local), and enforce remote administrative restrictions at the proxy/firewall as well. This setting is not an OS-level sandbox.

## Custom command execution

External tools is an explicit local administrator capability to run arbitrary
executables with the Virelo process's OS permissions. It is not a sandbox. A
registered command can modify or delete files, including source media, or expose
services; the read-only media-player behavior does not constrain external tools.
Never register untrusted commands, execute Virelo as an OS administrator for this
feature, or use it with mutually untrusted local administrators.

All command APIs, including configuration, process state and output, require a
fresh administrator session and a direct loopback peer with a literal loopback
Host and no forwarding headers. LAN connections, public-host requests and local
reverse proxies cannot invoke them. State-changing requests also require the
same-origin Origin check and `X-Virelo-Request: 1`. Do not weaken these checks or
publish a proxy that strips forwarding headers and rewrites Host to localhost.

Definitions and arguments are stored in the local database, separately from
public settings. Output is plain text, bounded to the last 32,768 characters per
command, held in memory and not added to the HTTP request log. Tools can still
print secrets or write their own logs; protect the data directory and prefer the
tool's own credential store. Executables receive the server environment, run from
the data directory without interactive stdin, and are spawned without an
implicit shell. Explicitly launching a shell still grants that shell full access.

Public hostnames are allowed only while their registered process is running.
Generated URL discovery is opt-in and scoped to the configured domain; only an
exact HTTPS origin without credentials, path, query or fragment is accepted.
Provider login, authorization, content policies and traffic limits remain the
operator's responsibility. Process state does not guarantee tunnel health or
that all buffered or previously downloaded data has been revoked after stopping.

Before public access, create accounts locally, use strong unique passwords, and
verify from an external connection that anonymous media requests are denied and
local-only administration remains blocked. Short PINs are still supported but
are not appropriate Internet-facing credentials. Keep the public `Host` and
proxy markers intact; do not rewrite requests to look like direct localhost
traffic. For Cloudflare, review [`httpHostHeader` and Access settings](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/).
An additional proxy authentication policy and edge rate limits can restrict
who reaches the sign-in endpoint. Virelo's login throttling uses the socket
peer, so clients behind a shared proxy share its attempt budget.

## Local administrator recovery

Stop the server and run `virelo --data <existing-data-directory> --reset-password <administrator-username>` on the server PC. A temporary password is printed to the terminal; change it immediately after signing in on localhost. Recovery requires filesystem access, does not run through an HTTP endpoint, and revokes that administrator's sessions. Treat the terminal output as a secret. Keep the data directory private and avoid capturing recovery output in shared logs.
