import assert from 'node:assert/strict';

export function assertCleanAudit(report, label) {
  assert.ok(report && !report.error && report.auditReportVersion === 2, 'npm audit must return a valid report');
  const findings = report.vulnerabilities;
  assert.ok(findings && typeof findings === 'object' && !Array.isArray(findings), 'missing audit findings');
  const total = report.metadata?.vulnerabilities?.total;
  assert.ok(Number.isSafeInteger(total) && total >= 0, 'missing vulnerability count');
  assert.equal(total, Object.keys(findings).length, 'incomplete audit report');
  assert.equal(total, 0, label + ' contain known advisories: ' + Object.keys(findings).join(', '));
}
