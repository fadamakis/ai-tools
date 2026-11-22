import {TaskActions} from './TaskActions.js';
import {TaskList} from './TaskList.js';
import {TaskOrganisationEditor} from './OrganisationControls.js';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@ai-tools/ui';
import { Menu } from '@ai-tools/ui';
import type { Task } from '../shared/contracts.js';
import type { SauronController } from './controller.js';
import { Icon, SourceBadge } from './icons.js';
import { date, labels, areaLabels, plannedDate } from './presentation.js';
import { DiscussTask } from './DiscussTask.js';
import { ReplyComposer } from './ReplyComposer.js';

function planValues(task:Task){
  return {title:task.title,nextAction:task.nextAction,area:task.area??'unassigned',
    workflowState:task.state==='inbox'?(task.sourceState==='waiting'?'waiting' as const:'ready' as const):(task.workflowState??'ready'),
    dueDate:task.dueDate??'',reviewDate:task.reviewDate??''};
}
function TaskPlanEditor({task,vm}:{task:Task;vm:SauronController}){
  const [baseline,setBaseline]=useState(()=>({task,values:planValues(task)}));
  const [draft,setDraft]=useState(()=>planValues(task));
  const keys=Object.keys(draft) as (keyof typeof draft)[];
  const changed=keys.filter(key=>draft[key]!==baseline.values[key]);
  const conflict=task.version!==baseline.task.version&&changed.length>0;
  const reset=(saved:Task)=>{const values=planValues(saved);setBaseline({task:saved,values});setDraft(values);};
  useEffect(()=>{
    if(task.version!==baseline.task.version&&!changed.length)reset(task);
  },[task,baseline,changed.length]);
  const change=<K extends keyof typeof draft>(key:K,value:typeof draft[K])=>setDraft(previous=>({...previous,[key]:value}));
  const {title,nextAction,area,workflowState,dueDate,reviewDate}=draft;
  const disabled=vm.actionLocked;
  const submit=async()=>{
    if(disabled||conflict)return;
    const saved=await vm.plan(baseline.task,{...draft,dueDate:dueDate||null,reviewDate:reviewDate||null});
    if(saved)reset(saved);
  };
  const keepEdits=()=>{
    const values=planValues(task);
    const edits=Object.fromEntries(changed.map(key=>[key,draft[key]]));
    setBaseline({task,values});setDraft({...values,...edits});
  };
  return <form className="inbox-plan-editor" onSubmit={event=>{event.preventDefault();submit();}} aria-label={`Plan ${task.title}`}>
    <h3>{task.state==='inbox'?'Review this task':'Task plan'}</h3>
    {conflict&&<div className="inbox-plan-conflict" role="status">
      <p>This task changed while you were editing. Load the latest values or keep your edits before saving.</p>
      <div><Button color="secondary" size="sm" type="button" disabled={disabled} onClick={()=>reset(task)}>Load latest</Button>
        <Button color="secondary" size="sm" type="button" disabled={disabled} onClick={keepEdits}>Keep my edits</Button></div>
    </div>}
    <label>Task name<input value={title} maxLength={160} required disabled={disabled} onChange={event=>change('title',event.target.value)}/></label>
    <label>Next action<textarea value={nextAction} maxLength={400} rows={2} disabled={disabled} onChange={event=>change('nextAction',event.target.value)}/></label>
    <div className="inbox-plan-grid"><label>Area<select value={area} disabled={disabled} onChange={event=>change('area',event.target.value as typeof area)}>{Object.entries(areaLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Status<select value={workflowState} disabled={disabled} onChange={event=>change('workflowState',event.target.value as typeof workflowState)}><option value="ready">Ready</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option>{task.state==='inbox'&&<option value="inbox">Inbox</option>}</select></label></div>
    <div className="inbox-plan-grid"><label>Real due date<input type="date" value={dueDate} disabled={disabled} onChange={event=>change('dueDate',event.target.value)}/></label>
      <label>Review date<input type="date" value={reviewDate} disabled={disabled} onChange={event=>change('reviewDate',event.target.value)}/></label></div>
    <Button color="primary" size="sm" disabled={disabled||conflict||!title.trim()||workflowState==='inbox'} type="button" onClick={submit}>{task.state==='inbox'?'Accept task':'Save plan'}</Button>
  </form>;
}
function TaskDetail({task,vm,position,total,back,previous,next}:{task:Task;vm:SauronController;position:number;total:number;back:()=>void;previous?:()=>void;next?:()=>void}){
  const titleId=useId();const historical=task.state==='done'||task.state==='dismissed';
  const disabled=vm.actionLocked;
  const completing=vm.busy&&vm.pending?.kind==='decision'&&vm.pending.input.id===task.id&&vm.pending.input.action==='complete';
  const [sourceError,setSourceError]=useState('');
  const source=()=>{if(task.sourceUrl)void vm.client?.open(task.sourceUrl).then(()=>setSourceError('')).catch(()=>setSourceError('Couldn’t open the source link. Use the source button to try again.'));};
  return <section className="inbox-task-detail" aria-labelledby={titleId}>
    <div className="inbox-reader-tools">
      <Button className="inbox-back" color="secondary" variant="ghost" size="sm" onClick={back}><Icon name="back"/> Back to tasks</Button>
      {!historical&&task.state!=='inbox'&&<Button color="secondary" variant="outline" size="sm" loading={completing} disabled={disabled} onClick={()=>vm.decide(task,'complete')}><Icon name="check"/> Complete</Button>}
      {historical&&!('resolved' in task&&task.resolved&&!task.userDecision)&&<Button variant="outline" color="secondary" size="sm" disabled={disabled} onClick={()=>vm.decide(task,'reopen')}>Reopen task</Button>}
      {!historical&&<TaskActions task={task} vm={vm} label="More task actions"/>}
      <div className="inbox-reader-paging"><span>{position} of {total}</span><Button uniform size="sm" color="secondary" variant="ghost" aria-label="Previous task" disabled={!previous} onClick={previous}><Icon name="back"/></Button><Button uniform size="sm" color="secondary" variant="ghost" aria-label="Next task" disabled={!next} onClick={next}><Icon name="forward"/></Button></div>
    </div>
    <div className="inbox-reader-content">
      {sourceError&&<p role="alert">{sourceError}</p>}
      <div className="inbox-detail-meta"><SourceBadge task={task}/><span className={`inbox-state inbox-state-${task.state}`}>{labels[task.state]}</span><span>{areaLabels[task.area??'unassigned']}</span></div>
      <h2 id={titleId} tabIndex={-1} aria-label={`Task details: ${task.title}`}>{task.title}</h2>
      {!!task.nextAction.trim()&&<div className="inbox-detail-context inbox-next-action">
        <h3>Next action</h3>
        <p className="inbox-context">{task.nextAction}</p>
      </div>}
      {historical&&<p className="inbox-detail-date">{task.state==='dismissed'?'Dismissed':task.userDecision==='complete'?'Completed':'Resolved at source'}{task.decidedAt&&<> · <time dateTime={task.decidedAt}>{date(task.decidedAt)}</time></>}</p>}
      {task.state==='snoozed'&&task.snoozedUntil&&<p className="inbox-detail-date">Returns {date(task.snoozedUntil)}</p>}
      {task.dueDate&&<p className="inbox-detail-date">Due {plannedDate(task.dueDate)}</p>}
      {task.reviewDate&&<p className="inbox-detail-date">Review {plannedDate(task.reviewDate)}</p>}
      {!!task.sourceNextAction?.trim()&&task.sourceNextAction.trim()!==task.nextAction.trim()&&
        <div className="inbox-detail-context">
          <h3>{task.provider==='personal'?'Task notes':task.provider==='manual'?'Latest sample context':'Latest source context'}</h3>
          <p className="inbox-context">{task.sourceNextAction}</p>
        </div>}
      {'provenance' in task&&task.provenance&&<details><summary>Source evidence</summary><p className="inbox-context">{task.provenance.evidence}</p><p className="inbox-muted">Read by dot{task.lastCheckedAt&&<> · {date(task.lastCheckedAt)}</>}</p></details>}
      {historical&&task.userDecision&&task.provider!=='personal'&&<p className="inbox-saved-decision">Your {task.state==='done'?'completion':'dismissal'} is saved. Source updates do not reopen this task.</p>}
      <div className="inbox-detail-actions">{task.sourceUrl&&<Button variant="outline" color="secondary" size="sm" onClick={source}>{task.provider==='manual'?'Open sample source':'Open source'} <Icon name="arrow"/></Button>}
        {task.provider==='personal'&&<span className="inbox-muted">Added {date(task.createdAt??task.updatedAt)}</span>}
      </div>
      <TaskOrganisationEditor task={task} vm={vm}/>
      {!historical&&<TaskPlanEditor key={task.id} task={task} vm={vm}/>}
      <DiscussTask task={task} storeId={vm.view!.storeId} client={vm.client} disabled={disabled} links={vm.view!.discussions?.filter(link=>link.taskId===task.id)??[]} onSaved={vm.apply}/>
      {task.provider==='slack'&&<div className="inbox-reader-reply"><ReplyComposer task={task} client={vm.client} disabled={disabled}/></div>}
    </div>
  </section>;
}
export function TaskReader({vm}:{vm:SauronController}){
  const [selection,setSelection]=useState<{id:string;mobileOpen:boolean}|null>(null);
  const detailId=useId(),readerRef=useRef<HTMLDivElement>(null);
  const rowRefs=useRef(new Map<string,HTMLButtonElement>());
  const index=vm.items.findIndex(task=>task.id===selection?.id),active=vm.items[index];
  const mobileOpen=!!active&&!!selection?.mobileOpen;
  const select=(task:Task,focus:'mobile'|'detail'|'row'='mobile')=>{
    setSelection({id:task.id,mobileOpen:focus!=='row'});
    requestAnimationFrame(()=>{
      if(focus==='row')rowRefs.current.get(task.id)?.focus();
      else if(focus==='detail'||window.matchMedia('(max-width:959px)').matches){
        const heading=readerRef.current?.querySelector<HTMLElement>('.inbox-task-detail h2');
        heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'nearest'});
      }
    });
  };
  const back=()=>{setSelection(old=>old?{...old,mobileOpen:false}:null);requestAnimationFrame(()=>rowRefs.current.get(active?.id)?.focus());};
  return <div ref={readerRef} className={`inbox-reader ${mobileOpen?'is-reading':''}`}>
    <TaskList vm={vm} active={active} detailId={detailId} rowRefs={rowRefs} select={select}/>
    <div className="inbox-reader-pane" id={detailId}>{active?<TaskDetail key={active.id} task={active} vm={vm} position={index+1} total={vm.items.length} back={back} previous={index>0?()=>select(vm.items[index-1],'detail'):undefined} next={index<vm.items.length-1?()=>select(vm.items[index+1],'detail'):undefined}/>:<div className="inbox-reader-placeholder"><Icon name="reading"/><h2>Select a task</h2><p>Read the details and decide your next step.</p></div>}</div>
  </div>;
}
