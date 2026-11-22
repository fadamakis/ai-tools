import {Dialog} from './Dialog.js';
import {RecoveryNotice} from './RecoveryNotice.js';
import {DiagnosticsView} from './DiagnosticsView.js';
import {OrganisationReview} from './OrganisationReview.js';
import {OrganisationDialog} from './OrganisationControls.js';
import {SourceControls} from './SourceControls.js';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@ai-tools/ui';
import { Input } from '@ai-tools/ui';
import { Textarea } from '@ai-tools/ui';
import { SegmentedControl } from '@ai-tools/ui';
import { Select } from '@ai-tools/ui';
import type { SauronController } from './controller.js';
import type { SourceKind, WorkArea } from '../shared/contracts.js';
import { sourceKinds, workAreas } from '../shared/contracts.js';
import { Icon, sourceLabels } from './icons.js';
import { labels, areaLabels } from './presentation.js';
import { UpdateStatus } from './UpdateStatus.js';
import { TaskReader } from './TaskReader.js';
import { operationId } from './operation.js';
import logo from '../../assets/sauron.png';
import {devBuildId} from '../shared/build-info.js';

function SourceLabel({label}:{label:string}){return <><span className="sr-only">Filter by source: </span>{label}</>;}
function AreaLabel({label}:{label:string}){return <><span className="sr-only">Filter by area: </span>{label}</>;}
function TopicLabel({label}:{label:string}){return <><span className="sr-only">Filter by topic: </span>{label}</>;}
function TaskFilter({kind,TriggerView,value,options,onChange}:{kind:string;TriggerView:React.FC<{value:string;label:string}>;value:string;options:{value:string;label:string}[];onChange:(value:string)=>void}){
  const ref=useRef<HTMLDivElement>(null);
  const restoreFocus=()=>requestAnimationFrame(()=>ref.current?.querySelector<HTMLElement>('[aria-haspopup="dialog"]')?.focus());
  return <div className={`inbox-filter inbox-${kind}-filter`} ref={ref} onKeyDownCapture={event=>{if(event.key==='Escape')restoreFocus();}}>
    <Select TriggerView={TriggerView} size="md" pill={false} dropdownIconType="chevronDown" block value={value} options={options} listMinWidth={200} listMaxWidth={280} onChange={option=>{onChange(option.value);restoreFocus();}}/>
  </div>;
}
export function InboxView({vm}:{vm:SauronController}){
  const disabled=vm.actionLocked;
  const titleRef=useRef<HTMLInputElement>(null);
  const addTaskTrigger=useRef<HTMLButtonElement>(null);
  const restoreAddTaskFocus=useRef(false);
  useEffect(()=>{
    if(vm.adding)titleRef.current?.focus({preventScroll:true});
    else if(restoreAddTaskFocus.current){
      restoreAddTaskFocus.current=false;
      addTaskTrigger.current?.focus({preventScroll:true});
    }
  },[vm.adding]);
  const organisationPanelId=useId();
  const [organisationOpen,setOrganisationOpen]=useState(false);
  const organisationTrigger=useRef<HTMLButtonElement>(null);
  const organisationPanel=useRef<HTMLElement>(null);
  const closeOrganisation=()=>{
    setOrganisationOpen(false);
    organisationTrigger.current?.focus({preventScroll:true});
  };
  useEffect(()=>{
    if(!organisationOpen)return;
    const closeOnOutsideClick=(event:PointerEvent)=>{
      if(event.target instanceof Node&&!organisationTrigger.current?.contains(event.target)&&!organisationPanel.current?.contains(event.target)){
        setOrganisationOpen(false);
      }
    };
    document.addEventListener('pointerdown',closeOnOutsideClick);
    return()=>document.removeEventListener('pointerdown',closeOnOutsideClick);
  },[organisationOpen]);
  const inboxCount=vm.count('inbox');
  const organisation=vm.view?.organisationReview;
  const suggestions=organisation?.proposal?.status==='pending'?organisation.proposal.changes.length:null;
  const submit=()=>{if(vm.draft.title.trim()&&!disabled)vm.save({kind:'create',input:{...vm.draft,operationId:operationId(),...(vm.draft.parentId?{expectedStoreId:vm.view!.storeId,expectedRevision:vm.view!.taskViewRevision??0}:{})}});};
  const recovery=<RecoveryNotice recovery={vm.taskRecovery} busy={vm.busy} connected={!!vm.client}/>;
  const loadError=vm.error&&<div role="alert" className="inbox-message"><p>{vm.error}</p><Button size="sm" variant="outline" color="secondary" disabled={vm.busy} onClick={()=>vm.c.current?vm.readSaved():vm.setConnectionAttempt(n=>n+1)}>{vm.c.current?'Reload tasks':'Reconnect'}</Button><Button size="sm" variant="ghost" color="secondary" onClick={()=>vm.setError('')}>Dismiss message</Button></div>;
  return <div className="inbox-app">
    <header className="inbox-bar"><div className="inbox-bar-inner">
      <h1 className="inbox-brand">
        <span className="inbox-brand-mark" aria-hidden="true">
          <img src={logo} alt=""/>
          <span className="inbox-brand-eye"><img src={logo} alt=""/></span>
        </span>
        <span>{devBuildId?'Sauron Dev':'Sauron'}</span>
      </h1>
      <div className="inbox-header-actions">{vm.client?.mode==='Local preview'&&<Button uniform variant="ghost" color="secondary" aria-label={`Switch to ${vm.theme==='light'?'dark':'light'} theme`} onClick={()=>{const next=vm.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;vm.setTheme(next);}}><Icon name={vm.theme==='light'?'moon':'sun'}/></Button>}
        <SourceControls vm={vm}/>
        <Button ref={addTaskTrigger} className="inbox-add-task" color="primary" pill size="md" aria-haspopup="dialog" disabled={!vm.client||disabled||vm.adding} onClick={()=>{restoreAddTaskFocus.current=true;vm.setAdding(true);}}><Icon name="plus"/> Add task</Button>
      </div></div></header>
    <main className="inbox-main">
      {vm.view&&<UpdateStatus view={vm.view}/>}
      {vm.view&&<section className="inbox-day-summary" aria-label="Daily review">
        <div className="inbox-focus-summary">
          <strong>Today</strong><span aria-hidden="true">·</span>
          <span>{vm.view.items.filter(task=>task.focusOrder&&(task.state==='ready'||task.state==='in_progress')).length} of 3 focus tasks</span>
        </div>
        <div className="inbox-review-summary">
          <Button className={inboxCount>0?'inbox-review-inbox':''} size="sm" variant={inboxCount>0?'outline':'ghost'} color="secondary" onClick={()=>vm.selectState('inbox')}>
            Review Inbox <span className="inbox-review-count">{inboxCount}</span>
          </Button>
          <Button size="sm" variant="ghost" color="secondary" aria-expanded={vm.weeklyReview} onClick={()=>vm.setWeeklyReview(!vm.weeklyReview)}>{vm.weeklyReview?'Close weekly review':'Weekly review'}</Button>
          {organisation&&<Button ref={organisationTrigger} className="inbox-organise-toggle" size="sm" variant="ghost" color="secondary"
            aria-expanded={organisationOpen} aria-controls={organisationPanelId} onClick={()=>setOrganisationOpen(!organisationOpen)}
            onKeyDown={event=>{if(organisationOpen&&event.key==='Escape'){event.preventDefault();closeOrganisation();}}}>
            {`Organise tasks${suggestions===null?'':` · ${suggestions} suggestions`}`} <Icon name="chevron"/>
          </Button>}
        </div>
        {vm.count('in_progress')>2&&<span className="inbox-wip-hint">{vm.count('in_progress')} in progress. Finish one before starting more.</span>}
        {organisation&&<section ref={organisationPanel} id={organisationPanelId} className="inbox-organisation-panel"
          data-proposals={suggestions!==null} aria-label="Organise tasks" hidden={!organisationOpen}
          onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();closeOrganisation();}}}>
          {organisationOpen&&<RecoveryNotice recovery={vm.review.recovery} busy={vm.busy} connected={!!vm.client}/>}
          <OrganisationReview vm={vm}/>
        </section>}
      </section>}
      {!!vm.view?.items.some(task=>task.reopenSuggestion?.length)&&<section className="inbox-message inbox-reopen-notice" aria-label="New activity in closed tasks">
        <h2>New activity in closed work</h2>
        {vm.view.items.filter(task=>task.reopenSuggestion?.length).map(task=><div className="inbox-reopen-row" key={task.id}>
          <span>{task.title}</span>
          <div className="inbox-reopen-actions">
            <Button color="secondary" size="sm" variant="outline" aria-label={`Reopen ${task.title}`} disabled={disabled} onClick={()=>vm.decide(task,'reopen')}>Reopen</Button>
            <Button color="secondary" size="sm" variant="ghost" aria-label={`Keep closed: ${task.title}`} disabled={disabled} onClick={()=>void vm.organisation.attention(task,false)}>Keep closed</Button>
          </div>
        </div>)}
      </section>}
      {!vm.sourceMenuOpen&&<RecoveryNotice recovery={vm.sourceRecovery} busy={vm.busy} connected={!!vm.client}/>}
      {!organisationOpen&&<RecoveryNotice recovery={vm.review.recovery} busy={vm.busy} connected={!!vm.client}/>}
      {vm.weeklyReview&&<section className="inbox-weekly" aria-label="Weekly review"><h2>Review the week</h2><p>Clear the Inbox, check what you are waiting for, then choose your next actions.</p><div><Button size="sm" variant="outline" color="secondary" onClick={()=>vm.selectState('inbox')}>Inbox {vm.count('inbox')}</Button><Button size="sm" variant="outline" color="secondary" onClick={()=>vm.selectState('waiting')}>Waiting {vm.count('waiting')}</Button><Button size="sm" variant="outline" color="secondary" onClick={()=>vm.selectState('today')}>Ready {vm.count('today')}</Button></div></section>}
      {vm.adding&&<Dialog title={vm.draft.parentId?`New child of ${vm.organisation.tree.byId.get(vm.draft.parentId)?.title??'task'}`:'New personal task'} close={vm.cancelDraft} closeDisabled={vm.busy}>
        {loadError}
        {recovery}
        <form className="inbox-composer" onSubmit={event=>{event.preventDefault();submit();}}
          onKeyDown={event=>{
            if(event.key==='Enter'&&!event.nativeEvent.isComposing&&event.target===titleRef.current){
              event.preventDefault();
              submit();
            }
          }}>
          <div className="inbox-composer-field inbox-composer-title">
            <label htmlFor="inbox-task-title">Task name</label>
            <Input id="inbox-task-title" size="2xl" ref={titleRef} value={vm.draft.title} maxLength={160} required placeholder="What needs to get done?" disabled={disabled} onChange={event=>vm.changeDraft({title:event.target.value})}/>
          </div>
          <div className="inbox-composer-field">
            <label htmlFor="inbox-task-notes">Notes <span className="inbox-composer-optional">(optional)</span></label>
            <Textarea id="inbox-task-notes" rows={3} maxLength={400} placeholder="Add a next step or a little context" value={vm.draft.nextAction} disabled={disabled} onChange={event=>vm.changeDraft({nextAction:event.target.value})}/>
          </div>
          <div className="inbox-composer-bottom">
            <div className="inbox-start"><span>Start in</span>
              <SegmentedControl aria-label="Initial task state" size="md" pill={false} value={vm.draft.sourceState} disabled={disabled} onChange={value=>vm.changeDraft({sourceState:value})}>
                <SegmentedControl.Option value="needs_you">Ready</SegmentedControl.Option>
                <SegmentedControl.Option value="waiting">Waiting</SegmentedControl.Option>
              </SegmentedControl>
            </div>
            <div className="inbox-composer-actions">
              <Button type="button" variant="ghost" color="secondary" disabled={vm.busy} onClick={vm.cancelDraft}>Cancel</Button>
              <Button type="button" color="primary" disabled={disabled||!vm.draft.title.trim()} onClick={submit}>Save task</Button>
            </div>
          </div>
        </form>
      </Dialog>}
      <section className="inbox-list" aria-label="Task list"><nav className="inbox-nav" aria-label="Task states"><SegmentedControl className="inbox-active-states" aria-label="Active task states" size="md" pill={false} value={vm.filter==='today'||vm.filter==='inbox'||vm.filter==='waiting'?vm.filter:''} onChange={state=>{if(state)vm.selectState(state);}}>
        {(['today','inbox','waiting'] as const).map(state=><SegmentedControl.Option key={state} value={state}>{state==='today'?'Today':labels[state]} <span className="inbox-count">{vm.count(state)}</span></SegmentedControl.Option>)}</SegmentedControl>
        <div className="inbox-secondary">{(['snoozed','done'] as const).map(state=><Button key={state} variant="ghost" color="secondary" size="sm" selected={state==='done'?vm.history:vm.filter===state} onClick={()=>state==='done'&&vm.history?vm.returnToTasks():vm.selectState(state)}>{state==='done'?'History':'Snoozed'} <span className="inbox-count">{state==='done'?vm.count('done')+vm.count('dismissed'):vm.count(state)}</span></Button>)}</div></nav>
        {vm.history&&<div className="inbox-history-nav"><Button variant="ghost" color="secondary" size="sm" onClick={vm.returnToTasks}><Icon name="back"/> Back to current tasks</Button><SegmentedControl aria-label="History states" size="sm" pill={false} value={vm.filter} onChange={vm.selectState}>{(['done','dismissed'] as const).map(state=><SegmentedControl.Option key={state} value={state}>{labels[state]} {vm.count(state)}</SegmentedControl.Option>)}</SegmentedControl></div>}
        {vm.showTools&&<div className="inbox-toolbar">
          <div className="inbox-search"><Input type="search" size="md" startAdornment={<Icon name="search"/>} aria-label="Search tasks" placeholder="Search tasks" value={vm.query} onChange={e=>vm.setQuery(e.target.value)}/></div>
          <TaskFilter kind="source" TriggerView={SourceLabel} value={vm.source} options={[{value:'all',label:'All sources'},...sourceKinds.map(value=>({value,label:sourceLabels[value]}))]} onChange={value=>vm.setSource(value as SourceKind|'all')}/>
          <TaskFilter kind="area" TriggerView={AreaLabel} value={vm.area} options={[{value:'all',label:'All areas'},...workAreas.map(value=>({value,label:areaLabels[value]}))]} onChange={value=>vm.setArea(value as WorkArea|'all')}/>
          <TaskFilter kind="topic" TriggerView={TopicLabel} value={vm.organisation.topic} options={[{value:'all',label:'All topics'},...(vm.view?.topics??[]).map(topic=>({value:topic.id,label:topic.name}))]} onChange={vm.organisation.setTopic}/>
          <Button className="inbox-attention-filter" color="secondary" size="md" variant="outline" selected={vm.organisation.attentionOnly} aria-pressed={vm.organisation.attentionOnly} onClick={()=>vm.organisation.setAttentionOnly(!vm.organisation.attentionOnly)}>Needs attention</Button>
          <span className="inbox-result-count">{vm.matchedCount} {vm.matchedCount===1?'task':'tasks'}</span>
        </div>}
        {!vm.adding&&loadError}
        <RecoveryNotice recovery={vm.organisation.recovery} busy={vm.busy} connected={!!vm.client}/>
        <RecoveryNotice recovery={vm.editRecovery} busy={vm.busy} connected={!!vm.client}/>
        {!vm.adding&&recovery}

        <div className="inbox-results">{!vm.view?(!vm.error&&<div className="inbox-empty">Loading your saved tasks…</div>):vm.items.length===0?(!vm.error&&<div className="inbox-empty"><Icon name={vm.hasFilters?'search':vm.filter==='waiting'||vm.filter==='snoozed'?'clock':'check'}/><h2>{vm.hasFilters?'No matching tasks':vm.emptyTitles[vm.filter]}</h2><p>{vm.hasFilters?'Try another search or clear your filters.':vm.emptyDescriptions[vm.filter]}</p>{vm.hasFilters&&<Button variant="outline" color="secondary" onClick={()=>{vm.setQuery('');vm.setSource('all');vm.setArea('all');vm.organisation.setTopic('all');vm.organisation.setAttentionOnly(false);}}>Clear filters</Button>}</div>):<TaskReader key={vm.filter} vm={vm}/>}</div>
      </section><footer className="inbox-footer">{devBuildId&&<span className="inbox-muted inbox-dev-build" data-dev-build={devBuildId}>Fixtures · {devBuildId}</span>}<Button variant="ghost" color="secondary" size="sm" onClick={()=>vm.setDiagnostics(true)}>Diagnostics</Button></footer>
      <OrganisationDialog vm={vm}/>

      {vm.branchDecision&&<Dialog title={vm.branchDecision.action==='reopen'?'Reopen this task and closed ancestors?':'Close the whole branch?'} close={()=>vm.setBranchDecision(null)}><p>{vm.branchDecision.task.title}</p><p>{vm.branchDecision.action==='reopen'?'The necessary closed ancestors will reopen. Top 3 will stay unchanged.':'All open descendants will receive the same decision. Keeping the parent open changes nothing.'}</p>{vm.branchDecision.revision!==vm.view?.taskViewRevision&&<p role="alert">Tasks changed. Cancel and review the branch again.</p>}<div className="inbox-dialog-actions"><Button variant="ghost" color="secondary" onClick={()=>vm.setBranchDecision(null)}>{vm.branchDecision.action==='reopen'?'Cancel':'Keep parent open'}</Button><Button color="secondary" disabled={vm.busy||vm.branchDecision.revision!==vm.view?.taskViewRevision} onClick={()=>{vm.decide(vm.branchDecision!.task,vm.branchDecision!.action,true);vm.setBranchDecision(null);}}>{vm.branchDecision.action==='reopen'?'Reopen path':'Confirm branch closure'}</Button></div></Dialog>}
      {vm.dismiss&&<Dialog title="Dismiss this task?" close={()=>vm.setDismiss(null)}><p>It will stay dismissed if the same source update arrives again.</p><p className="inbox-context">{vm.dismiss.title}</p><div className="inbox-dialog-actions"><Button autoFocus variant="ghost" color="secondary" onClick={()=>vm.setDismiss(null)}>Cancel</Button><Button color="primary" onClick={()=>{vm.decide(vm.dismiss!,'dismiss');vm.setDismiss(null);}}>Confirm dismiss</Button></div></Dialog>}
      {vm.diagnostics&&<Dialog title="Diagnostics" close={()=>vm.setDiagnostics(false)}><DiagnosticsView vm={vm}/></Dialog>}
    </main>
    {vm.notice&&<div role="status" className="inbox-notice"><span>{vm.notice}</span>{vm.reopenTask&&!vm.busy&&<Button variant="ghost" color="secondary" size="sm" disabled={!!vm.pending} onClick={()=>vm.decide(vm.reopenTask!,'reopen')}>Reopen task</Button>}<Button variant="ghost" color="secondary" size="sm" uniform aria-label="Dismiss notification" onClick={vm.dismissNotice}><Icon name="close"/></Button></div>}
  </div>;
}
