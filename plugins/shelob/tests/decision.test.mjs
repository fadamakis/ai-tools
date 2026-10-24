import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDecision } from '../assets/review-decision.mjs';
import { reviewVerdict } from '../assets/report-model.mjs';
import { reviewExecution } from '../assets/review-execution.mjs';

function example() {
  const finding = (id, severity = 'warning') => ({ id, severity, title: id, message: 'A concrete review observation.', nextAction: 'Check it.', evidence: [] });
  return { source: { kind: 'github_pr', reviewMode: 'pr_only' }, freshness: { status: 'current' }, files: [],
    analysis: { codeReview: { required: true, status: 'failed' } },
    results: [
      { ruleId: 'CODEX-REVIEW', mode: 'codex', status: 'not_assessed', findings: [], reason: 'Codex CLI does not support the configured model fixture-model for this account.' },
      { ruleId: 'SCOPE-001', mode: 'deterministic', status: 'findings', findings: [finding('size')] },
      { ruleId: 'TEST-003', mode: 'contextual', status: 'findings', findings: [finding('delete-errors')] },
    ] };
}
function decide(report, publishing = {}) {
  return reviewDecision(report, { verdict: reviewVerdict(report.results, { report, runState: 'complete' }), execution: reviewExecution(report, { runState: 'complete' }), publishing });
}

test('a rejected native model keeps approval incomplete while preserving the useful optional comment separately from size advice', () => {
  const report = example(), original = JSON.stringify(report), decision = decide(report);
  assert.equal(decision.label, 'Needs review');
  assert.equal(decision.next, 'Choose review model');
  assert.match(decision.reason, /fixture-model/);
  assert.equal(decision.comments.label, '1 optional comment');
  assert.equal(decision.comments.advisory, 1);
  assert.equal(JSON.stringify(report), original);
});

test('discussed and posted markers reduce new comments without clearing blocking findings or unresolved coverage', () => {
  const report = example(); report.results[2].findings[0].severity = 'error';
  const decision = decide(report, { discussed: ['delete-errors'], comments: { size: { state: 'posted' } } });
  assert.equal(decision.label, 'Changes required');
  assert.equal(decision.comments.discussed, 1);
  assert.equal(decision.comments.posted, 1);
  assert.equal(decision.comments.required, 0);
  assert.equal(reviewVerdict(report.results, { report }).state, 'changes');
});

test('uncertain delivery must be checked; a historical approval does not make outdated source ready', () => {
  const report = example();
  let decision = decide(report, { comments: { 'delete-errors': { state: 'unknown' } } });
  assert.equal(decision.comments.label, 'Check comment delivery');
  decision = decide(report, { approval: { state: 'unknown' } });
  assert.equal(decision.next, 'Check GitHub');
  report.freshness = { status: 'outdated', message: 'The head commit changed.' };
  decision = decide(report, { approval: { state: 'posted' } });
  assert.equal(decision.state, 'stale');
  assert.match(decision.reason, /head commit changed/);
});

test('successful review allows approval independently of optional notes and discussed markers', () => {
  const report = example();
  report.analysis = { execution: { state: 'completed' }, codeReview: { required: true, status: 'completed' } };
  report.results[0].status = 'assessed';
  let decision = decide(report);
  assert.equal(decision.label, 'Ready to approve');
  assert.equal(decision.next, 'Approve with optional comments');
  decision = decide(report, { discussed: ['delete-errors'] });
  assert.equal(decision.label, 'Ready to approve');
  assert.equal(decision.next, 'Approve PR');
});
