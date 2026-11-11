# Workspace structure

| Directory | Responsibility |
| --- | --- |
| `apps/web` | Browser player: local folder permissions, IndexedDB, browser playback and conversion, backup/import and PWA. |
| `apps/server` | Self-hosted CLI, console and HTTP server, with its own browser client: accounts, server settings, SQLite, local files and native media tools. |
| `packages/core` | Media contracts and pure catalog, folder-name and playback logic. No browser APIs or Node.js filesystem dependencies. |
| `packages/web-ui` | Shared React playback controls, Shorts controls, queue, playlist dialogs, library explorer, settings navigation, i18n presentation and their styles. |

Choose the appropriate edition when changing storage, routing, authentication or
available Settings sections. Shared UI is compiled against each edition's
`@edition` alias for browser-specific providers and localization. Its media
operations use the narrow `MediaServicesProvider` adapter, backed by IndexedDB
or the authenticated HTTP API. Keep native playback and account authorization
out of the shared UI. Future desktop and mobile clients can reuse core contracts
and logic without importing React or either server implementation.

Run `npm ci` at the repository root. `npm run dev:web` starts the standalone
player. Run `npm run build -w apps/server` before `npm run dev:server`; use a
separate test data folder when exercising self-hosted behavior. Run
`npm run check` and `npm run i18n:check` before changing shared packages.

The [Web deployment](../apps/web/README.md#cloudflare-workers-static-assets)
and [npm release](releasing.md) are independent. The private marketing site is
not part of this workspace. Do not copy its source, credentials or build
artifacts here.
