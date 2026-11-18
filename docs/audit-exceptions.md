# Development audit exceptions

## GHSA-fc5q-39xc-vjpf — expires 2026-12-02 00:00 UTC

Reviewed on 2026-11-18. [The picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
has no published fixed version at this review. Malicious repeated-extglob
patterns can consume CPU. This exception accepts the remaining development risk;
it does not patch picomatch or claim the vulnerability is fixed.

The reviewed chain is Vite 8.3.8 / plugin-react 6.3.0, tinyglobby 0.2.17,
fdir 6.5.0 and picomatch 4.0.7. These are development-only lockfile entries.
Virelo uses Vite to compile trusted repository source and configuration, not to
process media or HTTP requests in the distributed server. The server uses
Chokidar 6 and glob/minimatch, not this chain. Browser builds do not import
picomatch. The npm archive/install checks exclude these build packages and
the installed production dependency audit still requires zero findings.

Repository Vite configs and plugins do not take glob patterns from media,
HTTP parameters or user settings. The Actions workflow runs `pull_request`
and main pushes with `contents: read`, not `pull_request_target`; no secrets or
publishing steps are passed to those jobs. Contributor PRs still execute
untrusted code and may exhaust an individual job's resources. This exception
does not certify contributor code as safe. Review source/configuration before
using release artifacts, and do not run unknown PRs with local credentials.

Do not expose the Vite development server to untrusted networks or feed
untrusted glob patterns to these tools.
The development server is not the supported self-hosted media server.

`npm run audit:package` permits only advisory source 1247710 at the reviewed
versions, locations and development-only status until the expiry above.
Changed versions/paths, extra advisories, malformed reports and production
findings fail closed. The exception is printed in audit output; raw
`npm audit` continues to report it. No environment flag disables the policy.

Before expiry, check for a maintained upstream fix, update the affected build
dependencies, then remove the exception and its validator once the full audit
is clean. Do not automatically extend the expiry or downgrade Vite to suppress
the warning. A failed or unavailable advisory service is not a passing audit.
