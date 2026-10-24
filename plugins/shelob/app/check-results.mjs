import { auditOutcome } from '../assets/report-model.mjs';
import { isBlocking } from '../assets/finding-policy.mjs';

// Presentation only: approval readiness and coverage retain their own calculations.
export const checkGroups = [
  { id: 'failed', label: 'Failed', symbol: '×' },
  { id: 'notes', label: 'Nonblocking notes', shortLabel: 'Notes', symbol: '!' },
  { id: 'not_checked', label: 'Not checked', symbol: '−' },
  { id: 'passed', label: 'Passed', symbol: '✓' },
  { id: 'not_applicable', label: 'Not applicable', shortLabel: 'N/A', symbol: '·' },
];

export function checkResult(result, refs = []) {
  const outcome = auditOutcome(result);
  const id = outcome === 'attention'
    ? [...result.findings, ...refs].some(isBlocking) ? 'failed' : 'notes'
    : outcome;
  const group = checkGroups.find(group => group.id === id);
  return {
    ...group,
    label: id === 'not_checked' && result.status === 'error' ? 'Could not run' : group.label,
    incomplete: outcome === 'not_checked' || !['assessed', 'findings', 'not_applicable'].includes(result.status),
  };
}

export function checkCounts(entries) {
  const counts = Object.fromEntries(checkGroups.map(group => [group.id, 0]));
  for (const entry of entries) counts[checkResult(entry.result, entry.refs).id]++;
  return counts;
}
