import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDevelopmentAudit } from '../scripts/development-audit-policy.mjs';
import { assertCleanAudit } from '../scripts/dependency-audit.mjs';

const now = Date.parse('2026-11-18T00:00:00Z');
const advisory = { name: 'picomatch', dependency: 'picomatch', source: 1247710,
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', range: '<=4.0.7', severity: 'high' };
function fixture() {
  const versions = { picomatch: '4.0.7', fdir: '6.5.0', tinyglobby: '0.2.17', vite: '8.3.8', '@vitejs/plugin-react': '6.3.0' };
  const via = { picomatch: [advisory], fdir: ['picomatch'], tinyglobby: ['fdir', 'picomatch'],
    vite: ['tinyglobby', 'picomatch'], '@vitejs/plugin-react': ['vite'] };
  return {
    report: { auditReportVersion: 2, metadata: { vulnerabilities: { total: 5 } },
      vulnerabilities: Object.fromEntries(Object.keys(versions).map(name => [name, { via: structuredClone(via[name]), nodes: ['node_modules/' + name] }])) },
    lock: { packages: Object.fromEntries(Object.entries(versions).map(([name, version]) => ['node_modules/' + name, { version, dev: true }])) }
  };
}

test('only the reviewed dev-only chain may proceed before its expiry', () => {
  const { report, lock } = fixture();
  assert.equal(checkDevelopmentAudit(report, lock, now), true);
  assert.throws(() => assertCleanAudit(report, 'installed production dependencies'), /contain known advisories/);
  assert.throws(() => checkDevelopmentAudit(report, lock, Date.parse('2026-12-02T00:00:00Z')), /expired/);
  assert.throws(() => checkDevelopmentAudit(report, lock, NaN), /expired/);
});

test('production paths, duplicate copies and changed versions are never waived', () => {
  for (const name of Object.keys(fixture().report.vulnerabilities)) {
    for (const change of ['production', 'version', 'copy']) {
      const { report, lock } = fixture();
      if (change === 'production') delete lock.packages['node_modules/' + name].dev;
      if (change === 'version') lock.packages['node_modules/' + name].version = '999.0.0';
      if (change === 'copy') report.vulnerabilities[name].nodes.push('other/node_modules/' + name);
      assert.throws(() => checkDevelopmentAudit(report, lock, now), /reviewed|paths/);
    }
  }
});

test('new advisories, additional findings and broken chains stop the audit', () => {
  for (const change of ['id', 'range', 'severity', 'another', 'package', 'empty', 'cycle', 'missing']) {
    const { report, lock } = fixture();
    const finding = report.vulnerabilities.picomatch;
    if (change === 'id') finding.via[0].source++;
    if (change === 'range') finding.via[0].range = '*';
    if (change === 'severity') finding.via[0].severity = 'critical';
    if (change === 'another') finding.via.push({ ...advisory, url: 'https://github.com/advisories/GHSA-other' });
    if (change === 'package') { report.vulnerabilities.other = { via: ['picomatch'] }; report.metadata.vulnerabilities.total++; }
    if (change === 'empty') finding.via = [];
    if (change === 'cycle') finding.via = ['vite'];
    if (change === 'missing') delete report.vulnerabilities.fdir;
    assert.throws(() => checkDevelopmentAudit(report, lock, now));
  }
});

test('clean reports need no waiver; failed or incomplete reports do not count as clean', () => {
  const clean = { auditReportVersion: 2, metadata: { vulnerabilities: { total: 0 } }, vulnerabilities: {} };
  assert.equal(checkDevelopmentAudit(clean, {}, Date.parse('2027-01-01')), false);
  for (const invalid of [null, {}, { ...clean, error: { code: 'NETWORK' } }, { ...clean, vulnerabilities: [] }, { ...clean, vulnerabilities: undefined },
    { ...clean, metadata: undefined }, { ...clean, metadata: { vulnerabilities: { total: -1 } } },
    { ...clean, metadata: { vulnerabilities: { total: 1 } } }]) {
    assert.throws(() => checkDevelopmentAudit(invalid, {}, now));
  }
});
