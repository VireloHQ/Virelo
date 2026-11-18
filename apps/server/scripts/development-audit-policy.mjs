import assert from 'node:assert/strict';
import { assertAuditReport } from './dependency-audit.mjs';

export const PICOMATCH_EXCEPTION = {
  advisory: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  expires: '2026-12-02T00:00:00Z'
};
const reviewedVersions = {
  picomatch: '4.0.7', fdir: '6.5.0', tinyglobby: '0.2.17',
  vite: '8.3.8', '@vitejs/plugin-react': '6.3.0'
};

// Only this reviewed build-time advisory is deferred; production audits have no exceptions.
export function checkDevelopmentAudit(report, lock, now = Date.now()) {
  const findings = assertAuditReport(report);
  if (!Object.keys(findings).length) return false;
  assert.ok(Number.isFinite(now) && now < Date.parse(PICOMATCH_EXCEPTION.expires), 'picomatch exception expired; review upstream fixes');
  const visit = (name, trail = []) => {
    assert.ok(!trail.includes(name), 'cyclic audit chain');
    const finding = findings[name], version = reviewedVersions[name];
    assert.ok(finding && Object.hasOwn(reviewedVersions, name), 'unreviewed audit dependency: ' + name);
    assert.ok(Array.isArray(finding.nodes) && finding.nodes.length === 1, 'unreviewed dependency paths: ' + name);
    const path = 'node_modules/' + name, entry = lock.packages?.[path];
    assert.equal(finding.nodes[0], path, 'unreviewed dependency location: ' + name);
    assert.ok(entry?.dev === true && entry.version === version, 'exception requires the reviewed dev-only version: ' + name);
    assert.ok(Array.isArray(finding.via) && finding.via.length, 'missing advisory chain: ' + name);
    for (const via of finding.via) {
      if (typeof via === 'string') visit(via, [...trail, name]);
      else {
        assert.ok(name === 'picomatch' && via?.name === 'picomatch' && via.dependency === 'picomatch'
          && via.source === 1247710 && via.url === PICOMATCH_EXCEPTION.advisory
          && via.range === '<=4.0.7' && via.severity === 'high', 'unreviewed advisory: ' + name);
      }
    }
  };
  for (const name of Object.keys(findings)) visit(name);
  return true;
}
