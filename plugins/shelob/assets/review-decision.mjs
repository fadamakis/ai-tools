import { isBlocking } from './finding-policy.mjs';

// Mechanical counts are review prompts, not ready-made requests to the author.
export function isAdvisory(finding, result) {
  return !isBlocking(finding) && result.mode === 'deterministic'
    && ['SCOPE-001', 'SCOPE-002', 'TEST-002'].includes(result.ruleId);
}

export function commentSummary(results, publishing = {}) {
  const counts = { required: 0, optional: 0, advisory: 0, discussed: 0, posted: 0, uncertain: 0 };
  for (const result of results) for (const finding of result.findings) {
    const receipt = publishing.comments?.[finding.id];
    const kind = receipt ? receipt.state === 'posted' ? 'posted' : 'uncertain'
      : publishing.discussed?.includes(finding.id) ? 'discussed'
      : isAdvisory(finding, result) ? 'advisory' : isBlocking(finding) ? 'required' : 'optional';
    counts[kind]++;
  }
  const label = counts.required ? `${counts.required} blocking comment${counts.required === 1 ? '' : 's'}`
    : counts.optional ? `${counts.optional} optional comment${counts.optional === 1 ? '' : 's'}`
    : counts.uncertain ? 'Check comment delivery' : counts.posted ? 'Comments sent'
    : counts.discussed ? 'Comments already discussed' : 'No comments suggested';
  return { ...counts, label };
}

export function reviewDecision(report, { verdict, execution, publishing = {} }) {
  const comments = commentSummary(report.results, publishing);
  const nativeError = report.results.find(result => result.ruleId === 'CODEX-REVIEW')?.reason;
  const failed = ['failed', 'interrupted'].includes(execution.state);
  const modelError = failed && /model .*not support|not support.*model/i.test(nativeError || '');
  // Initial reports have not performed the final freshness check yet. Pending
  // work stays in progress; a saved report without a receipt still fails closed.
  const stale = report.source?.kind === 'github_pr' && report.freshness?.status !== 'current'
    && (Boolean(report.freshness) || execution.state === 'completed');
  const approval = publishing.approval;
  const state = approval && approval.state !== 'posted' ? 'uncertain'
    : stale ? 'stale' : approval ? 'approved'
    : verdict.state === 'changes' ? 'changes'
    : failed ? 'failed' : verdict.state === 'progress' ? 'progress'
    : verdict.state === 'incomplete' ? 'incomplete' : 'ready';
  const label = { approved: 'Already approved', uncertain: 'Check approval delivery', changes: 'Changes required',
    stale: 'Needs a fresh review', failed: 'Needs review', progress: 'Review in progress', incomplete: 'Needs review', ready: 'Ready to approve' }[state];
  const next = state === 'approved' ? 'View approval' : state === 'uncertain' ? 'Check GitHub'
    : state === 'changes' ? 'Review blocking findings' : modelError ? 'Choose review model'
    : state === 'stale' || failed ? 'Rerun review' : state === 'progress' || state === 'incomplete' ? 'Continue review'
    : comments.optional ? 'Approve with optional comments' : 'Approve PR';
  const reason = state === 'approved' ? 'Shelob recorded a GitHub approval for this review.' : state === 'uncertain' ? 'Confirm delivery on GitHub before trying again.'
    : state === 'stale' ? report.freshness?.message || 'Check the current PR before relying on this review.' : failed ? nativeError || execution.reason : verdict.reason;
  return { state, label, next, reason, comments, setupFailed: modelError,
    execution: { ...execution, reason: failed ? nativeError || execution.reason : execution.reason } };
}
