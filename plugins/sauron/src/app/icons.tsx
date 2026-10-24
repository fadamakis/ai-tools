import React from 'react';
import type { SourceKind, Task } from '../shared/contracts.js';

export const sourceLabels:Record<SourceKind,string>={manual:'Personal',slack:'Slack',jira:'Jira',github:'GitHub',calendar:'Calendar',meeting:'Meetings'};
export function sourceOf(task:Task):SourceKind {
  if(task.provider==='personal')return 'manual';
  if(task.provider==='slack')return 'slack';
  if(task.provider==='granola')return 'meeting';
  if(task.provider==='jira'||task.provider==='github'||task.provider==='calendar')return task.provider;
  if(task.sourceKind)return task.sourceKind;
  // Older sample records predate the explicit sourceKind field.
  const segment=task.sourceUrl?.split('/')[3];
  return segment && ['slack','jira','github','calendar','meeting'].includes(segment)?segment as SourceKind:'manual';
}
export function Icon({name,...props}:{name:string}&React.SVGProps<SVGSVGElement>){
  const paths:Record<string,React.ReactNode>={
    back:<path d="m14 6-6 6 6 6"/>,
    forward:<path d="m10 6 6 6-6 6"/>,
    reading:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 4v16m4-11h3m-3 4h3"/></>,
    plus:<path d="M12 5v14M5 12h14"/>,
    check:<path d="m5 12 4 4L19 6"/>,
    refresh:<><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.36 6.36L3 16M8 16H3v5"/></>,
    search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    clock:<><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,
    arrow:<path d="M7 17 17 7M7 7h10v10"/>,
    sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2m-3-9-1.5 1.5M5.5 18.5 4 20M4 4l1.5 1.5m13 13L20 20"/></>,
    moon:<path d="M20 14A8 8 0 0 1 10 4 8 8 0 1 0 20 14Z"/>,
    manual:<><circle cx="12" cy="8" r="3"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/></>,
    slack:<><path strokeWidth="3.5" d="M9 4v10M4 9h10m1 1v10m-5-5h10"/><path strokeWidth="3.5" d="M4 4h.01M20 4h.01M4 20h.01M20 20h.01"/></>,
    jira:<><path fill="currentColor" stroke="none" d="m12 2 10 10-10 10L2 12Zm0 6-4 4 4 4 4-4Z"/></>,
    github:<><path d="M9 19c-4 1-4-2-6-2m12 5v-3.5c0-1 .1-1.5-.5-2 4-.5 6.5-2 6.5-6a5 5 0 0 0-1.5-3.5c.2-1 .2-2-.5-3.5-2 0-3 1-3.5 1.5a13 13 0 0 0-7 0C8 4.5 7 3.5 5 3.5 4.3 5 4.3 6 4.5 7A5 5 0 0 0 3 10.5c0 4 2.5 5.5 6.5 6-.6.5-.5 1-.5 2V22"/></>,
    calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2"/></>,
    meeting:<><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-4v12l-6-4"/></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]??paths.manual}</svg>;
}
export function SourceBadge({task}:{task:Task}){
  const kind=sourceOf(task);
  const label=task.provider==='granola'?'Granola':task.provider==='personal'?'Personal':kind==='manual'?'Manual':sourceLabels[kind];
  return <span className="source" aria-label={`${label}${task.provider==='manual'?' sample task':' task'}`}>
    <span className={`source-icon ${kind}`}><Icon name={kind}/></span>
    <span>{label}</span>
  </span>;
}
