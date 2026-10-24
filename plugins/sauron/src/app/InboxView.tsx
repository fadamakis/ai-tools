import React, { useEffect, useId, useRef } from 'react';
import { Button } from '@ai-tools/ui';
import { Input } from '@ai-tools/ui';
import { Textarea } from '@ai-tools/ui';
import { SegmentedControl } from '@ai-tools/ui';
import { Select } from '@ai-tools/ui';
import type { SauronController } from './controller.js';
import type { SourceKind } from '../shared/contracts.js';
import { sourceKinds } from '../shared/contracts.js';
import { Icon, sourceLabels } from './icons.js';
import { labels } from './presentation.js';
import { UpdateStatus } from './UpdateStatus.js';
import { TaskReader } from './TaskReader.js';
import { operationId } from './operation.js';
import logo from '../../assets/sauron.png';

function SourceLabel({label}:{label:string}){return <><span className="sr-only">Filter by source: </span>{label}</>;}
function Dialog({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);const id=useId();
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} className="inbox-dialog" aria-labelledby={id} onCancel={close}>
    <header><h2 id={id}>{title}</h2><Button variant="ghost" color="secondary" uniform aria-label={`Close ${title.toLowerCase()}`} onClick={close}><Icon name="close"/></Button></header>{children}
  </dialog>;
}
export function InboxView({vm}:{vm:SauronController}){
  const disabled=vm.busy||!!vm.pending;
  const titleRef=useRef<HTMLInputElement>(null);
  const sourceRef=useRef<HTMLDivElement>(null);
  // The SDK select can unmount its popup before restoring focus.
  const restoreSourceFocus=()=>requestAnimationFrame(()=>sourceRef.current?.querySelector<HTMLElement>('[aria-haspopup="dialog"]')?.focus());
  useEffect(()=>{if(vm.adding)titleRef.current?.focus();},[vm.adding]);
  const submit=()=>{if(vm.draft.title.trim()&&!disabled)vm.save({kind:'create',input:{...vm.draft,operationId:operationId()}});};
  return <div className="inbox-app">
    <header className="inbox-bar"><div className="inbox-bar-inner"><div className="inbox-brand"><img src={logo} alt=""/><span>Sauron</span></div>
      <div className="inbox-header-actions">{vm.client?.mode==='Local preview'&&<Button uniform variant="ghost" color="secondary" aria-label={`Switch to ${vm.theme==='light'?'dark':'light'} theme`} onClick={()=>{const next=vm.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;vm.setTheme(next);}}><Icon name={vm.theme==='light'?'moon':'sun'}/></Button>}
        <Button variant="outline" color="secondary" size="md" disabled={!vm.client||vm.busy||vm.scanning} aria-busy={vm.scanning} onClick={vm.refresh}><Icon name="refresh" className={vm.scanning?'spinning':undefined}/>{vm.scanning?'Refreshing…':'Refresh'}</Button>
      </div></div></header>
    <main className="inbox-main"><section className="inbox-heading"><div><h1>Your attention list</h1><p className="inbox-muted">What needs you, and what can wait.</p></div>
      <Button color="primary" disabled={!vm.client||disabled||vm.adding} onClick={()=>vm.setAdding(true)}><Icon name="plus"/> Add task</Button></section>
      {vm.view&&<UpdateStatus view={vm.view}/>}
      {vm.adding&&<section className="inbox-composer" aria-labelledby="inbox-add-title"><h2 id="inbox-add-title">New personal task</h2>
        <form onSubmit={e=>{e.preventDefault();submit();}} onKeyDown={e=>{if(e.key==='Enter'&&e.target instanceof HTMLInputElement){e.preventDefault();submit();}}}>
          <label htmlFor="inbox-task-title">Task name</label><Input id="inbox-task-title" ref={titleRef} value={vm.draft.title} maxLength={160} required placeholder="What needs to get done?" disabled={disabled} onChange={e=>vm.changeDraft({title:e.target.value})}/>
          <label htmlFor="inbox-task-notes">Notes <span className="inbox-muted">(optional)</span></label><Textarea id="inbox-task-notes" rows={2} maxLength={400} placeholder="Add a next step or a little context" value={vm.draft.nextAction} disabled={disabled} onChange={e=>vm.changeDraft({nextAction:e.target.value})}/>
          <div className="inbox-composer-bottom"><div className="inbox-start"><span>Start in</span><SegmentedControl aria-label="Initial task state" size="md" pill={false} value={vm.draft.sourceState} disabled={disabled} onChange={value=>vm.changeDraft({sourceState:value})}><SegmentedControl.Option value="needs_you">Needs you</SegmentedControl.Option><SegmentedControl.Option value="waiting">Waiting</SegmentedControl.Option></SegmentedControl></div>
            <div className="inbox-composer-actions"><Button variant="ghost" color="secondary" disabled={disabled} onClick={vm.cancelDraft}>Cancel</Button><Button color="primary" disabled={disabled||!vm.draft.title.trim()} onClick={submit}>Save task</Button></div>
          </div></form></section>}
      <section className="inbox-list" aria-label="Task list"><nav className="inbox-nav" aria-label="Task states"><SegmentedControl aria-label="Active task states" size="md" pill={false} value={vm.filter} onChange={vm.selectState}>
        {(['needs_you','waiting'] as const).map(state=><SegmentedControl.Option key={state} value={state}>{labels[state]} <span className="inbox-count">{vm.count(state)}</span></SegmentedControl.Option>)}</SegmentedControl>
        <div className="inbox-secondary">{(['snoozed','done'] as const).map(state=><Button key={state} variant="ghost" color="secondary" size="sm" selected={state==='done'?vm.history:vm.filter===state} onClick={()=>vm.selectState(state)}>{state==='done'?'History':'Snoozed'} <span className="inbox-count">{state==='done'?vm.count('done')+vm.count('dismissed'):vm.count(state)}</span></Button>)}</div></nav>
        {vm.history&&<div className="inbox-history-nav"><SegmentedControl aria-label="History states" size="sm" pill={false} value={vm.filter} onChange={vm.selectState}>{(['done','dismissed'] as const).map(state=><SegmentedControl.Option key={state} value={state}>{labels[state]} {vm.count(state)}</SegmentedControl.Option>)}</SegmentedControl></div>}
        {vm.showTools&&<div className="inbox-toolbar"><Input type="search" aria-label="Search tasks" placeholder="Search tasks" value={vm.query} onChange={e=>vm.setQuery(e.target.value)}/>
          <div className="inbox-source-filter" ref={sourceRef} onKeyDownCapture={event=>{if(event.key==='Escape')restoreSourceFocus();}}><Select TriggerView={SourceLabel} size="md" block={false} value={vm.source} options={[{value:'all',label:'All sources'},...sourceKinds.map(value=>({value,label:sourceLabels[value]}))]} onChange={option=>{vm.setSource(option.value as SourceKind|'all');restoreSourceFocus();}}/></div><span className="inbox-result-count">{vm.items.length} {vm.items.length===1?'task':'tasks'}</span></div>}
        {vm.error&&<div role="alert" className="inbox-message"><strong>{vm.view?'Your list could not be updated.':'Your list could not be loaded.'}</strong><p>{vm.error}</p><Button size="sm" variant="outline" color="secondary" disabled={vm.busy} onClick={()=>vm.c.current?vm.readSaved():vm.setConnectionAttempt(n=>n+1)}>Try again</Button></div>}
        {vm.pending&&<aside className="inbox-message"><strong>Check an interrupted save</strong><p>Check whether it was saved. Retrying won’t create a duplicate.</p><div className="inbox-detail-actions"><Button variant="outline" color="secondary" size="sm" disabled={vm.busy||!vm.client} onClick={vm.readSaved}>Check saved state</Button><Button color="primary" size="sm" disabled={vm.busy||!vm.client} onClick={()=>vm.save(vm.pending!)}>Retry {vm.pending.kind==='create'?'task':'decision'}</Button><Button variant="ghost" color="secondary" size="sm" disabled={vm.busy} onClick={vm.cancelPending}>Cancel retry</Button></div></aside>}
        {vm.notice&&<div role="status" className="inbox-notice">{vm.notice}{vm.reopenTask&&!vm.busy&&<Button variant="ghost" color="secondary" size="sm" disabled={!!vm.pending} onClick={()=>vm.decide(vm.reopenTask!,'reopen')}>Reopen task</Button>}</div>}
        <div className="inbox-results">{!vm.view?(!vm.error&&<div className="inbox-empty">Loading your saved tasks…</div>):vm.items.length===0?(!vm.error&&<div className="inbox-empty"><Icon name={vm.hasFilters?'search':vm.filter==='waiting'||vm.filter==='snoozed'?'clock':'check'}/><h2>{vm.hasFilters?'No matching tasks':vm.emptyTitles[vm.filter]}</h2><p>{vm.hasFilters?'Try another search or clear your filters.':vm.emptyDescriptions[vm.filter]}</p>{vm.hasFilters&&<Button variant="outline" color="secondary" onClick={()=>{vm.setQuery('');vm.setSource('all');}}>Clear filters</Button>}</div>):<TaskReader key={vm.filter} vm={vm}/>}</div>
      </section><footer className="inbox-footer"><Button variant="ghost" color="secondary" size="sm" onClick={()=>vm.setDiagnostics(true)}>Diagnostics</Button></footer>
      {vm.dismiss&&<Dialog title="Dismiss this task?" close={()=>vm.setDismiss(null)}><p>It will stay dismissed if the same source update arrives again.</p><p className="inbox-context">{vm.dismiss.title}</p><div className="inbox-dialog-actions"><Button autoFocus variant="ghost" color="secondary" onClick={()=>vm.setDismiss(null)}>Cancel</Button><Button color="primary" onClick={()=>{vm.decide(vm.dismiss!,'dismiss');vm.setDismiss(null);}}>Confirm dismiss</Button></div></Dialog>}
      {vm.diagnostics&&<Dialog title="Diagnostics" close={()=>vm.setDiagnostics(false)}><p>{vm.client?.mode??'Connecting'} · Local store</p><dl><dt>Version</dt><dd>{__SAURON_VERSION__}</dd><dt>Automatic update mode</dt><dd>{vm.view?.coordination?.mode??'independent'}</dd><dt>Sync freshness</dt><dd>{vm.view?.coordination?.freshness.status??'never'}</dd><dt>Store ID</dt><dd>{vm.view?.storeId}</dd></dl><h3>Sample tasks</h3><p>Refresh checks Slack and Granola. These controls create separate test records.</p><div className="inbox-detail-actions"><Button size="sm" variant="outline" color="secondary" disabled={!vm.client||disabled} onClick={vm.seed}>Create synthetic task</Button><Button size="sm" variant="outline" color="secondary" disabled={!vm.client||disabled} onClick={vm.replay}>Replay incoming update</Button></div></Dialog>}
    </main></div>;
}
