import assert from 'node:assert/strict';

export function assertAuditReport(report) {
  assert.ok(report && !report.error && report.auditReportVersion === 2, 'npm audit must return a valid report');
  const findings = report.vulnerabilities;
  assert.ok(findings && typeof findings === 'object' && !Array.isArray(findings), 'missing audit findings');
  const total = report.metadata?.vulnerabilities?.total;
  assert.ok(Number.isSafeInteger(total) && total >= 0, 'missing vulnerability count');
  assert.equal(total, Object.keys(findings).length, 'incomplete audit report');
  return findings;
}

export function assertCleanAudit(report, label) {
  const findings = assertAuditReport(report);
  assert.equal(Object.keys(findings).length, 0, label + ' contain known advisories: ' + Object.keys(findings).join(', '));
}
