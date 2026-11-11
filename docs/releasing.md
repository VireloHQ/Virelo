# Releasing

Git pushes and tags do not publish npm packages. CI builds and audits a tarball;
the package maintainer publishes it separately after approving the release.

## Prepare

1. Compare `npm view virelo version` with `apps/server/package.json`. Use a new,
   unpublished version in the workspace lock and the version fields of
   `apps/server/release-lock.json`. The latter pins only the dependencies in the
   standalone npm package and must match the server's production dependency ranges.
2. Update `apps/server/CHANGELOG.md` and review the changes since the published version.
3. Run the checks below with a supported Node.js version:

   ```sh
   npm ci
   npm run check
   npm run i18n:check
   npm run audit:package
   ```

   The package audit checks known dependency advisories, installs the actual
   archive in temporary storage and verifies the CLI, HTTP assets and initial
   administrator setup. It never uses personal libraries or publishes anything.
4. Merge after CI passes. Use the `npm-package` artifact from the matching CI
   run, or run `npm run build -w apps/server` then `npm run pack:release` from the
   repository root to write a standalone tarball under `.release/`.
   Do not pack or publish directly from the workspace directory.

## Publish manually

Sign in with an account that can publish `virelo`, then publish the newly checked
archive. For 0.6.1:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish ./.release/virelo-0.6.1.tgz --access public --registry=https://registry.npmjs.org/
```

Complete any npm authentication or two-factor prompt yourself. Never put a token
or one-time password in source files, logs or release notes. A dry run does not
prove publication permission. Published name/version pairs cannot be reused.

After publication, check `npm view virelo version` and
`npx --yes virelo@0.6.1 --version` before announcing the npm release. A previously
cached `npx virelo` installation may need `npx virelo@latest` to pick up the update.
