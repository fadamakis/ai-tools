import React from 'react';
import { Quiet } from './ui.jsx';
import { checkCounts, checkGroups, checkResult } from './check-results.mjs';

const summaryOrder = ['failed', 'passed', 'notes', 'not_checked', 'not_applicable'];

export function CheckStatus({ result, refs }) {
  const status = checkResult(result, refs);
  return <span className={`check-result-badge ${status.id}`}><span aria-hidden="true">{status.symbol}</span>{status.label}</span>;
}

export function CheckResults({ entries, total, enhanced, busy, open, expandedOutcome }) {
  const counts = checkCounts(entries);
  const shown = summaryOrder.filter(id => id === 'failed' || id === 'passed' || counts[id] > 0);
  return <section className="check-results" aria-label="Check results">
    <div className="check-results-heading"><h2>Check results</h2><span>{entries.length === total ? `${total} checks` : `${entries.length} of ${total} checks · Filtered`}</span></div>
    <div className="check-stats" style={{ '--check-stat-columns': shown.length }}>{shown.map(id => {
      const group = checkGroups.find(group => group.id === id);
      const actionLabel = id === 'notes' ? 'Show checks with nonblocking notes' : id === 'not_checked' ? 'Show unchecked checks' : `Show ${group.label.toLowerCase()} checks`;
      const content = <><span className="check-stat-count"><span aria-hidden="true">{group.symbol}</span>{counts[id]}</span><span className="check-stat-label">{group.shortLabel || group.label}</span></>;
      const props = { className: `check-stat ${id}`, 'data-empty': counts[id] === 0 };
      return enhanced
        ? <Quiet key={id} {...props} disabled={busy || counts[id] === 0} aria-label={`${actionLabel} (${counts[id]})`} aria-controls="checks-panel" aria-expanded={expandedOutcome === id} onClick={() => open(id)}>{content}</Quiet>
        : <div key={id} {...props}>{content}</div>;
    })}</div>
  </section>;
}
