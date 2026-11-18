import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCleanAudit } from '../scripts/dependency-audit.mjs';

const clean = () => ({ auditReportVersion: 2, metadata: { vulnerabilities: { total: 0 } }, vulnerabilities: {} });

test('clean reports pass; any advisory blocks both development and production dependencies', () => {
  assert.doesNotThrow(() => assertCleanAudit(clean(), 'dependencies'));
  for (const severity of ['low', 'moderate', 'high', 'critical']) {
    for (const label of ['build dependencies', 'installed production dependencies']) {
      const report = clean();
      report.metadata.vulnerabilities.total = 1;
      report.vulnerabilities.picomatch = { severity, via: [{ url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }] };
      assert.throws(() => assertCleanAudit(report, label), /contain known advisories: picomatch/);
    }
  }
});

test('failed, missing and inconsistent reports never pass as clean', () => {
  for (const report of [null, {}, { ...clean(), error: { code: 'NETWORK' } }, { ...clean(), vulnerabilities: [] },
    { ...clean(), metadata: undefined }, { ...clean(), metadata: { vulnerabilities: { total: -1 } } },
    { ...clean(), metadata: { vulnerabilities: { total: 1 } } }, { ...clean(), vulnerabilities: { picomatch: {} } }]) {
    assert.throws(() => assertCleanAudit(report, 'dependencies'));
  }
});
