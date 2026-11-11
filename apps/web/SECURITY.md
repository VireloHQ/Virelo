# Security

## Reporting vulnerabilities

Report suspected vulnerabilities privately to the Virelo maintainers. Do not include private video paths, browser data, or media files in a report.

## Hosting requirements

Serve Virelo Web over HTTPS. The app is static and does not require a server API, database, account system, or secrets.

Build with a patched stable Node.js release: 22.23.4+, 24.22.1+ or 26.12.1+
within those release lines. `.node-version` pins the Pages build to 22.23.4;
any dashboard `NODE_VERSION` override must match. This is a build requirement,
not a Node.js installation requirement for people using the browser-only player.

Use restrictive response headers, including `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a Content Security Policy limited to the application origin plus `blob:` media and images.

## Local permissions

Folder access is controlled by the browser. Virelo Web requests read access only. It does not modify or delete source video files.
