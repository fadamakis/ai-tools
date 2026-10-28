import { evidenceChecks, evidenceFreshness } from '../shared/evidence.mjs';

export function attentionReason(task, at = Date.now()) {
  if (task.archivedAt || task.stage === 'done') return '';
  if (task.status === 'blocked') return task.nextAction || task.summary || 'Resolve the blocker before continuing.';
  if (task.status === 'unverified') return task.nextAction || 'Check the imported task against current evidence.';
  if (task.pr?.checks === 'failed') return 'CI failed. Check the pull request.';
  const checks = evidenceChecks(task);
  const stale = ['verify', 'review'].map(kind => evidenceFreshness(task, kind)).find(item => item.status === 'stale' || item.status === 'unavailable');
  if (stale) return stale.reason;
  if (['failed', 'blocked'].includes(checks.verify?.result)) return 'Verification needs attention.';
  if (['findings', 'blocked'].includes(checks.review?.result)) return 'Review findings need attention.';
  if (task.head && [task.pr?.head, ...Object.values(checks).map(check => check.head), task.evidence?.head].some(head => head && head !== task.head)) return 'Evidence is for an earlier revision. Check again.';
  if (task.pr?.checkedAt && at - Date.parse(task.pr.checkedAt) > 24 * 60 * 60 * 1000) return 'PR status was checked over a day ago. Check again.';
  return '';
}

export function displayTitle(task) {
  const escaped = task.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return task.title.replace(new RegExp(`^${escaped}(?:\\s*[:–—-]\\s*|\\s+)`, 'i'), '') || task.title;
}

export function cardNextAction(task) {
  if (task.stage === 'done') return '';
  const reason = attentionReason(task);
  if (reason) return reason;
  const generic = /^(Resume the next incomplete Workbench stage\.?|Start Workbench\.?|Continue\.?)$/i;
  return [task.nextAction, task.summary].find(text => text?.trim() && !generic.test(text.trim())) || '';
}

export function taskLaunch(task, continuation = false) {
  if (!task) return { action: 'Start new chat', title: 'Start a task', description: '' };
  if (task.threadId && !continuation) return { action: 'Resume original chat', title: 'Resume task', description: 'Continue in the original chat and its existing environment.' };
  if (task.threadId) return { action: 'Start new chat', title: 'Start a new chat', description: 'Continue this task in a new chat using its saved progress. The original chat stays available.' };
  return { action: 'Start task', title: 'Start task', description: 'Start a chat for this task. Workbench checks any saved progress before continuing.' };
}

export function taskStatus(task) {
  return { active: 'In progress · reported', unverified: 'Unverified', complete: 'Merge verified', blocked: 'Blocked', paused: 'Paused', waiting: 'Waiting' }[task.status] || task.status;
}

export function repositoryLocation(path) {
  const segments = path.split('/').filter(Boolean);
  return segments.length > 2 ? `…/${segments.slice(-2).join('/')}` : path;
}

export function evidenceLabel(task, kind) {
  const check = evidenceChecks(task)[kind], value = check?.result;
  if (!value || value === 'unverified') return 'Not checked';
  if (task.stage === 'done') return `${value} · historical`;
  if (check.snapshot) { const freshness = evidenceFreshness(task, kind); return `${value} · ${freshness.status} · ${freshness.reason}`; }
  if (!task.head || !check.head) return `${value} · unbound · revision not recorded`;
  return check.head === task.head ? `${value} · unbound · recorded commit only` : `${value} · unbound · earlier revision`;
}

export const launchStatus = { prepared: 'Chat requested', dispatching: 'Sending request', queued: 'Creating chat', sent: 'Waiting for task confirmation', accepted: 'Chat confirmed', uncertain: 'Receipt unconfirmed', failed: 'Handoff failed' };
