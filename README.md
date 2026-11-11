# Virelo

Virelo is a private video player for the files you already have.

- [Browser player](https://app.virelo.dev/) — opens local folders without an account. [Source and build instructions](apps/web/README.md)
- [Self-hosted server](https://www.npmjs.com/package/virelo) — start with `npx virelo`, or `npx virelo --here` to include the current folder. [Server and CLI documentation](apps/server/README.md)

The [official website](https://virelo.dev/) is maintained separately.

## Development

Use Node.js 22.23.4+, 24.22.1+ or 26.12.1+ within those release lines, and run from the repository root:

```sh
npm ci
npm run check
```

Build one edition with `npm run build -w apps/web` or `npm run build -w apps/server`.
See [contributing](CONTRIBUTING.md) and [npm releases](docs/releasing.md).

The player and server are [AGPL-3.0-only](LICENSE). Third-party assets and code keep their own licenses. The two editions have independent storage, permissions and release schedules.
