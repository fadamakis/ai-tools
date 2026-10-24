import { isBlocking } from './finding-policy.mjs';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const createReportSession=()=>({query:'',severity:'all',category:'all',check:null,reading:false,drafts:{},chosen:[],copyStatus:{},prepared:{},instructions:{},suggestions:{},dismissedSuggestions:[],scroll:0,detailsOpen:false,expandedChecks:{}});

export function auditOutcome(result) {
  if (result.findings.length || result.findingRefs?.length) return 'attention';
  if (result.status === 'assessed') return 'passed';
  if (result.status === 'not_applicable') return 'not_applicable';
  return 'not_checked';
}

export function summarizeChecks(results) {
  const counts = { attention: 0, passed: 0, not_checked: 0, not_applicable: 0 };
  for (const result of results) counts[auditOutcome(result)]++;
  const state = counts.attention ? 'attention' : counts.not_checked ? 'not_checked' : counts.passed ? 'passed' : 'not_applicable';
  return { ...counts, total: results.length, state };
}

export function reviewVerdict(results, { report, runState } = {}) {
  const counts = summarizeChecks(results);
  const applicable = counts.total - counts.not_applicable;
  const completed = results.filter(result => ['assessed', 'findings'].includes(result.status) && auditOutcome(result) !== 'not_checked').length;
  const incomplete = applicable - completed;
  const findings = results.flatMap(result => result.findings);
  const errors = findings.filter(isBlocking).length;
  const stale = report?.source?.kind === 'github_pr' && report.freshness?.status !== 'current';
  const unread = report?.files?.some(file => file.limitation || file.binary) || report?.repository?.untracked?.length;
  const missingNative = report?.analysis?.codeReview?.required && applicable && report.analysis.codeReview.status !== 'completed';
  const unfinished = ['failed', 'interrupted'].includes(runState) || report?.analysis?.execution && report.analysis.execution.state !== 'completed' || incomplete || missingNative || !applicable || stale || unread || report?.status === 'incomplete';
  const running = ['preparing', 'awaiting_review'].includes(runState) && !['failed', 'interrupted', 'incomplete'].includes(report?.analysis?.execution?.state) && report?.analysis?.codeReview?.status !== 'failed';
  const state = errors ? 'changes' : running ? 'progress' : unfinished ? 'incomplete' : findings.length ? 'notes' : 'approve';
  const label = { approve: 'Approve', notes: 'Approve with notes', changes: 'Request changes', progress: 'Approval pending', incomplete: 'Approval blocked' }[state];
  const pending = `${plural(incomplete, 'check')} ${incomplete === 1 ? 'still needs' : 'still need'} review`;
  let reason;
  if (state === 'approve') reason = `${applicable === 1 ? 'The check' : `All ${applicable} checks`} passed.`;
  else if (state === 'changes') reason = `${plural(errors, 'high-severity finding')} ${errors === 1 ? 'blocks' : 'block'} approval.${incomplete ? ` ${pending}.` : ''}`;
  else if (state === 'notes') reason = `${plural(findings.length, 'nonblocking note')}. No changes required for approval.`;
  else if (stale && !running) reason = report.freshness?.message || 'PR freshness has not been checked. Rerun before relying on this review.';
  else if (['failed', 'interrupted'].includes(runState)) reason = 'Review execution did not finish.';
  else if (report?.analysis?.execution && report.analysis.execution.state !== 'completed' && !incomplete) reason = report.analysis.execution.reason;
  else if (missingNative && !running) reason = 'Native Codex review is incomplete.';
  else if (!applicable) reason = 'None of these checks apply to this change.';
  else reason = incomplete ? `${pending}.` : unread || report?.status === 'incomplete' ? 'Some source was not reviewed. See the review limits below.' : 'Finishing the review.';
  return { state, label, reason, coverage: { completed, applicable, percent: applicable ? Math.round(completed / applicable * 100) : 0 } };
}

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`;
