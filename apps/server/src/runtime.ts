const minimumReleases = [[22, 23, 4], [24, 22, 1], [26, 12, 1]] as const;

export const SUPPORTED_NODE_RANGE = minimumReleases.map(version => `^${version.join('.')}`).join(' || ');
export const NODE_REQUIREMENT = minimumReleases.map(version => `${version.join('.')}+`).join(', ');

export function assertSupportedNode(version = process.versions.node) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  const [major, minor, patch] = match?.slice(1).map(Number) ?? [];
  const minimum = minimumReleases.find(release => release[0] === major);
  if (match && [major, minor, patch].every(Number.isSafeInteger) && minimum
    && (minor > minimum[1] || minor === minimum[1] && patch >= minimum[2])) return;
  throw new Error(`Unsupported Node.js ${version}. Virelo requires Node.js ${NODE_REQUIREMENT} within those release lines. Update Node.js before starting Virelo; these versions include the October 2026 security fixes (CVE-2026-111497).`);
}
