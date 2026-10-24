import React, { useEffect, useRef, useState } from 'react';
import { Input, Quiet, Select } from './ui.jsx';
import { severityLevels } from '../assets/finding-policy.mjs';
import { CheckStatus } from './CheckStatus.jsx';
import { checkGroups, checkResult } from './check-results.mjs';

export function ChecksPanel({ report, visible, selectedId, session, change, close, selectCheck, outcome, setOutcome }) {
  const search = useRef(null);
  const [filters, setFilters] = useState(session.category !== 'all' || session.severity !== 'all');
  const matching = visible.filter(({ result, refs }) => outcome === 'all' || checkResult(result, refs).id === outcome);
  const filtered = session.query || session.category !== 'all' || session.severity !== 'all';
  useEffect(() => { search.current?.focus({ preventScroll: true }); }, [outcome]);

  function moveFocus(event, index) {
    const at = matching.findIndex(item => item.index === index);
    const next = event.key === 'ArrowDown' ? Math.min(at + 1, matching.length - 1)
      : event.key === 'ArrowUp' ? Math.max(at - 1, 0) : null;
    if (next !== null) {
      event.preventDefault();
      event.currentTarget.closest('.check-list').querySelector(`[data-check-index="${matching[next].index}"]`)?.focus();
    }
  }

  return <section id="checks-panel" className="checks-panel interactive-only" aria-label="Checks" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); }
  }}>
    <div className="checks-search">
      <Input ref={search} id="search" type="search" aria-label="Search checks" placeholder="Search checks, rules or files" value={session.query} onChange={event => change({ query: event.target.value })}/>
      <Quiet size="sm" aria-expanded={filters} onClick={() => setFilters(!filters)}>Filters{session.category !== 'all' || session.severity !== 'all' ? ' · Active' : ''}</Quiet>
    </div>
    {filters && <div className="check-filter-options">
      <div><label htmlFor="category">Category</label><Select id="category" value={session.category} options={['all', ...new Set(report.results.map(result => result.category))].map(value => ({ value, label: value === 'all' ? 'All categories' : value }))} onChange={option => change({ category: option.value })}/></div>
      <div><label htmlFor="severity">Severity</label><Select id="severity" value={session.severity} options={[{ value: 'all', label: 'All severities' }, ...Object.entries(severityLevels).map(([value, level]) => ({ value, label: level.label + (value === 'error' ? ' · Blocking' : '') }))]} onChange={option => change({ severity: option.value })}/></div>
    </div>}
    <div className="checks-scope"><span role="status">{outcome === 'all' ? 'All checks' : checkGroups.find(group => group.id === outcome)?.label} · {matching.length}</span>
      {outcome !== 'all' && <Quiet size="sm" onClick={() => setOutcome('all')}>Show all checks</Quiet>}
      {filtered && <Quiet size="sm" onClick={() => change({ query: '', category: 'all', severity: 'all' })}>Clear filters</Quiet>}
    </div>
    <div className="check-list" aria-label="Checks">{checkGroups.map(({ id, label }) => {
      const items = matching.filter(({ result, refs }) => checkResult(result, refs).id === id);
      return items.length > 0 && <section className="audit-group" key={id}><h2>{label}<span>{items.length}</span></h2>{items.map(({ result, index, refs }) =>
        <button type="button" data-check-index={index} key={result.ruleId} className={`check-row ${selectedId === result.ruleId ? 'is-selected' : ''}`} aria-current={selectedId === result.ruleId ? 'true' : undefined} onClick={() => selectCheck(result.ruleId)} onKeyDown={event => moveFocus(event, index)}>
          <span className={`status-icon ${id}`} aria-hidden="true">{checkResult(result, refs).symbol}</span>
          <span><strong>{result.findings.length === 1 ? result.findings[0].title : result.title}</strong><small>{result.ruleId} · {result.category}</small></span>
          <CheckStatus {...{ result, refs }}/>
        </button>)}</section>;
    })}{!matching.length && <p className="empty">No checks match these filters.</p>}</div>
  </section>;
}
