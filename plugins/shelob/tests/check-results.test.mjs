import test from 'node:test';
import assert from 'node:assert/strict';
import { checkResult, checkCounts } from '../app/check-results.mjs';

test('visible check results separate blocking failures, optional notes and missing execution', () => {
  const result = (status, findings = []) => ({ status, findings });
  assert.equal(checkResult(result('assessed')).id, 'passed');
  assert.equal(checkResult(result('findings', [{ severity: 'error' }])).id, 'failed');
  for (const severity of ['warning', 'info']) {
    assert.equal(checkResult(result('findings', [{ severity }])).id, 'notes');
  }
  for (const status of ['error', 'not_assessed', 'findings', 'unknown']) {
    assert.equal(checkResult(result(status)).id, 'not_checked');
    assert.equal(checkResult(result(status)).incomplete, true);
  }
  assert.equal(checkResult(result('error')).label, 'Could not run');
  assert.equal(checkResult(result('not_applicable')).id, 'not_applicable');
  const partial = checkResult(result('not_assessed', [{ severity: 'error' }]));
  assert.equal(partial.id, 'failed');
  assert.equal(partial.incomplete, true, 'a discovered blocker does not complete the check');
});

test('counts resolve shared findings and count checks once without mutating saved evidence', () => {
  const entries = [
    { result: { status: 'findings', findings: [{ severity: 'error' }, { severity: 'warning' }] } },
    { result: { status: 'assessed', findings: [], findingRefs: ['shared'] }, refs: [{ severity: 'error' }] },
    { result: { status: 'assessed', findings: [] } },
    { result: { status: 'assessed', findings: [], findingRefs: ['unknown'] }, refs: [] },
    { result: { status: 'error', findings: [] } },
    { result: { status: 'not_applicable', findings: [] } },
  ];
  const original = JSON.stringify(entries);
  assert.deepEqual(checkCounts(entries), { failed: 2, notes: 1, not_checked: 1, passed: 1, not_applicable: 1 });
  assert.equal(JSON.stringify(entries), original);
});
