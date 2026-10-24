export const severityLevels = {
  error: { label: 'High', description: 'Blocks approval: a supported bug or explicit rule violation that needs fixing.' },
  warning: { label: 'Medium', description: 'Nonblocking: worth checking or improving before merge.' },
  info: { label: 'Low', description: 'Nonblocking: a small improvement or useful observation.' },
};

export const findingSeverity = finding => severityLevels[finding.severity] ? finding.severity : 'warning';
export const isBlocking = finding => findingSeverity(finding) === 'error';

// Older reports have no prepared comment. Keep them useful without changing them.
export function commentDraft(finding) {
  if (finding.comment?.trim()) return finding.comment.trim();
  const short = (text, limit) => text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
  return [short(finding.message || finding.title, 360), short(finding.nextAction || '', 200)].filter(Boolean).join(' ');
}

export function commentBody(finding, draft = commentDraft(finding)) {
  const location = finding.evidence?.find(item => item.path !== '@description');
  return `[${severityLevels[findingSeverity(finding)].label}] ${finding.title}\n\n${draft.trim()}${location ? `\n\n${location.path}${location.line ? `:${location.line}` : ''} (${location.side === 'before' ? 'before' : 'after'} change)` : ''}`;
}
