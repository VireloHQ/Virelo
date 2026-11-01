# Releasing

Git pushes and successful builds do not update the npm package. Prepare the
release on a pull request and publish only after its checks pass and the release
is explicitly approved. Do not push a `v*` tag or dispatch the Publish npm workflow
during preparation: both can publish automatically.

## Prepare

1. Compare `npm view virelo version` with `package.json`. Use a new, unpublished
   version in both `package.json` and the root entries of `package-lock.json`.
2. Update `CHANGELOG.md` and review the changes since the published version.
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
4. Merge the pull request after CI passes. From the unchanged, verified checkout,
   run `npm pack` and retain the printed archive filename and its SHA-256.

## Publish manually

Sign in with an account that can publish `virelo`, then publish the newly checked
archive. For 0.5.2:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish ./virelo-0.5.2.tgz --access public --registry=https://registry.npmjs.org/
```

Complete any npm authentication or two-factor prompt yourself. Never put a token
or one-time password in source files, logs or release notes. A dry run does not
prove publication permission. Published name/version pairs cannot be reused.

After publication, check `npm view virelo version` and
`npx --yes virelo@0.5.2 --version` before announcing the npm release. A previously
cached `npx virelo` installation may need `npx virelo@latest` to pick up the update.
