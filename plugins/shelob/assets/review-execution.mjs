export function reviewExecution(report, { runState, assessmentData } = {}) {
  const native = report.analysis?.codeReview;
  const scope = report.source?.kind === 'github_pr' ? report.source.reviewMode === 'pr_only' ? 'PR-only' : 'Local copy'
    : native?.required ? 'Local changes' : report.analysis?.contextual ? 'Rule review' : 'Code scan';
  const outcome = (state, title, reason) => ({ state, label: `${title} · ${scope}`, reason });
  if (runState === 'interrupted') return outcome('interrupted', 'Interrupted', 'Review execution was interrupted. Start a fresh review.');
  if (runState === 'failed' || native?.status === 'failed') return outcome('failed', 'Failed', 'A required review step failed. See the saved error below.');
  if (runState === 'preparing') return outcome('pending', 'Preparing', 'Reading the selected source.');
  if (runState === 'awaiting_review' || ['pending', 'running'].includes(native?.status) && !assessmentData && runState !== 'complete') {
    return outcome('pending', 'Review in progress', native?.status === 'running' ? 'Native Codex review is running.' : 'Required review steps are pending.');
  }
  if (report.analysis?.execution && !assessmentData && !(runState === 'complete' && report.analysis.execution.state === 'pending')) return report.analysis.execution;
  const submitted = assessmentData?.snapshotId === report.snapshot?.id ? assessmentData : null;
  if (submitted?.execution?.status === 'incomplete') return outcome('incomplete', 'Incomplete', submitted.execution.reason);
  const ruleIds = new Set(submitted?.assessments?.map(item => item.ruleId));
  const pending = report.results.filter(result => {
    if (result.status === 'error') return true;
    if (!['contextual', 'codex'].includes(result.mode) || ['assessed', 'findings', 'not_applicable'].includes(result.status)) return false;
    if (result.ruleId === 'DESCRIPTION-001' && !report.description?.text) return false;
    if (result.mode === 'codex') return !submitted?.codeReview || submitted.codeReview.outputDigest !== native?.outputDigest;
    return !ruleIds.has(result.ruleId);
  });
  if (native?.required && report.files?.length && native.status !== 'completed') {
    return outcome('incomplete', 'Incomplete', 'Native Codex review did not finish.');
  }
  if (pending.length) return outcome('incomplete', 'Incomplete', `Required steps did not finish: ${pending.map(result => result.ruleId).join(', ')}.`);
  return outcome('completed', 'Completed', 'The selected review steps finished. Coverage and approval readiness are listed separately.');
}
