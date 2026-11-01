import React, { useId, useRef, useState } from 'react';
import { Button } from '@ai-tools/ui';
import { Menu } from '@ai-tools/ui';
import type { Task } from '../shared/contracts.js';
import type { SauronController } from './controller.js';
import { Icon, SourceBadge } from './icons.js';
import { date, labels, areaLabels, plannedDate } from './presentation.js';
import { DiscussTask } from './DiscussTask.js';
import { ReplyComposer } from './ReplyComposer.js';

function TaskActions({task,vm,label=`Actions for ${task.title}`}:{task:Task;vm:SauronController;label?:string}){
  const actionable=(vm.view?.items??[]).filter(item=>item.state==='ready'||item.state==='in_progress')
    .sort((a,b)=>(a.focusOrder??99)-(b.focusOrder??99)||(a.order??999999)-(b.order??999999)||a.id.localeCompare(b.id));
  const ids=actionable.map(item=>item.id),focus=actionable.filter(item=>item.focusOrder).sort((a,b)=>a.focusOrder!-b.focusOrder!).map(item=>item.id);
  const position=ids.indexOf(task.id);
  const move=(delta:number)=>{const next=[...ids];[next[position],next[position+delta]]=[next[position+delta],next[position]];vm.order(next,next.filter(id=>focus.includes(id)));};
  const toggleFocus=()=>vm.order(ids,focus.includes(task.id)?focus.filter(id=>id!==task.id):[...focus,task.id]);
  return <Menu><Menu.Trigger><Button color="secondary" variant="ghost" size="sm" uniform aria-label={label} disabled={vm.busy||!!vm.pending}><span aria-hidden="true" className="inbox-ellipsis">⋯</span></Button></Menu.Trigger>
    <Menu.Content align="end" minWidth={180}>
      {(task.state==='ready'||task.state==='in_progress')&&<>
        {focus.includes(task.id)?<Menu.Item onSelect={toggleFocus}>Remove from Top 3</Menu.Item>:focus.length<3&&<Menu.Item onSelect={toggleFocus}>Add to Top 3</Menu.Item>}
        {position>0&&<Menu.Item onSelect={()=>move(-1)}>Move up</Menu.Item>}
        {position>=0&&position<ids.length-1&&<Menu.Item onSelect={()=>move(1)}>Move down</Menu.Item>}
        <Menu.Item onSelect={()=>vm.plan(task,{workflowState:task.state==='ready'?'in_progress':'ready'})}>{task.state==='ready'?'Start work':'Move to Ready'}</Menu.Item>
        <Menu.Item onSelect={()=>vm.plan(task,{workflowState:'waiting'})}>Move to Waiting</Menu.Item>
      </>}
      {task.state==='waiting'&&<Menu.Item onSelect={()=>vm.plan(task,{workflowState:'ready'})}>Move to Ready</Menu.Item>}
      <Menu.Item onSelect={()=>vm.decide(task,task.state==='snoozed'?'reopen':'snooze')}>{task.state==='snoozed'?'Bring back now':'Snooze 1 hour'}</Menu.Item>
      <Menu.Item onSelect={()=>vm.setDismiss(task)}>Dismiss</Menu.Item>
    </Menu.Content></Menu>;
}
function TaskPlanEditor({task,vm}:{task:Task;vm:SauronController}){
  const [title,setTitle]=useState(task.title),[nextAction,setNextAction]=useState(task.nextAction);
  const [area,setArea]=useState(task.area??'unassigned'),[workflowState,setWorkflowState]=useState(task.state==='inbox'?(task.sourceState==='waiting'?'waiting':'ready'):(task.workflowState??'ready'));
  const [dueDate,setDueDate]=useState(task.dueDate??''),[reviewDate,setReviewDate]=useState(task.reviewDate??'');
  const disabled=vm.busy||!!vm.pending;
  const submit=()=>vm.plan(task,{title,nextAction,area,workflowState,dueDate:dueDate||null,reviewDate:reviewDate||null});
  return <form className="inbox-plan-editor" onSubmit={event=>{event.preventDefault();submit();}} aria-label={`Plan ${task.title}`}>
    <h3>{task.state==='inbox'?'Review this task':'Task plan'}</h3>
    <label>Task name<input value={title} maxLength={160} required disabled={disabled} onChange={event=>setTitle(event.target.value)}/></label>
    <label>Next action<textarea value={nextAction} maxLength={400} rows={2} disabled={disabled} onChange={event=>setNextAction(event.target.value)}/></label>
    <div className="inbox-plan-grid"><label>Area<select value={area} disabled={disabled} onChange={event=>setArea(event.target.value as typeof area)}>{Object.entries(areaLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Status<select value={workflowState} disabled={disabled} onChange={event=>setWorkflowState(event.target.value as typeof workflowState)}><option value="ready">Ready</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option>{task.state==='inbox'&&<option value="inbox">Inbox</option>}</select></label></div>
    <div className="inbox-plan-grid"><label>Real due date<input type="date" value={dueDate} disabled={disabled} onChange={event=>setDueDate(event.target.value)}/></label>
      <label>Review date<input type="date" value={reviewDate} disabled={disabled} onChange={event=>setReviewDate(event.target.value)}/></label></div>
    <Button color="primary" size="sm" disabled={disabled||!title.trim()||workflowState==='inbox'} type="button" onClick={submit}>{task.state==='inbox'?'Accept task':'Save plan'}</Button>
  </form>;
}
function TaskDetail({task,vm,position,total,back,previous,next}:{task:Task;vm:SauronController;position:number;total:number;back:()=>void;previous?:()=>void;next?:()=>void}){
  const titleId=useId();const historical=task.state==='done'||task.state==='dismissed';
  const disabled=vm.busy||!!vm.pending;
  const completing=vm.busy&&vm.pending?.kind==='decision'&&vm.pending.input.id===task.id&&vm.pending.input.action==='complete';
  const source=()=>{if(task.sourceUrl)void vm.client?.open(task.sourceUrl).catch(()=>vm.setError('The source link could not be opened. Try again from the task.'));};
  return <section className="inbox-task-detail" aria-labelledby={titleId}>
    <div className="inbox-reader-tools">
      <Button className="inbox-back" color="secondary" variant="ghost" size="sm" onClick={back}><Icon name="back"/> Back to tasks</Button>
      {!historical&&task.state!=='inbox'&&<Button color="secondary" variant="outline" size="sm" loading={completing} disabled={disabled} onClick={()=>vm.decide(task,'complete')}><Icon name="check"/> Complete</Button>}
      {historical&&!('resolved' in task&&task.resolved&&!task.userDecision)&&<Button variant="outline" color="secondary" size="sm" disabled={disabled} onClick={()=>vm.decide(task,'reopen')}>Reopen task</Button>}
      {!historical&&<TaskActions task={task} vm={vm} label="More task actions"/>}
      <div className="inbox-reader-paging"><span>{position} of {total}</span><Button uniform size="sm" color="secondary" variant="ghost" aria-label="Previous task" disabled={!previous} onClick={previous}><Icon name="back"/></Button><Button uniform size="sm" color="secondary" variant="ghost" aria-label="Next task" disabled={!next} onClick={next}><Icon name="forward"/></Button></div>
    </div>
    <div className="inbox-reader-content">
      <div className="inbox-detail-meta"><SourceBadge task={task}/><span className={`inbox-state inbox-state-${task.state}`}>{labels[task.state]}</span><span>{areaLabels[task.area??'unassigned']}</span></div>
      <h2 id={titleId} tabIndex={-1} aria-label={`Task details: ${task.title}`}>{task.title}</h2>
      {historical&&<p className="inbox-detail-date">{task.state==='dismissed'?'Dismissed':task.userDecision==='complete'?'Completed':'Resolved at source'}{task.decidedAt&&<> · <time dateTime={task.decidedAt}>{date(task.decidedAt)}</time></>}</p>}
      {task.state==='snoozed'&&task.snoozedUntil&&<p className="inbox-detail-date">Returns {date(task.snoozedUntil)}</p>}
      {task.dueDate&&<p className="inbox-detail-date">Due {plannedDate(task.dueDate)}</p>}
      {task.reviewDate&&<p className="inbox-detail-date">Review {plannedDate(task.reviewDate)}</p>}
      <div className="inbox-detail-context"><h3>{task.provider==='personal'?'Task notes':task.provider==='manual'?'Latest sample context':'Latest source context'}</h3>
        <p className={`inbox-context ${!task.sourceNextAction?'inbox-muted':''}`}>{task.sourceNextAction||'No additional notes.'}</p>
      </div>
      {task.plannedAction!==null&&task.plannedAction!==undefined&&task.plannedAction!==task.sourceNextAction&&<p className="inbox-context">Your next action: {task.plannedAction}</p>}
      {'provenance' in task&&task.provenance&&<details><summary>Source evidence</summary><p className="inbox-context">{task.provenance.evidence}</p><p className="inbox-muted">Read by dot{task.lastCheckedAt&&<> · {date(task.lastCheckedAt)}</>}</p></details>}
      {historical&&task.userDecision&&task.provider!=='personal'&&<p className="inbox-saved-decision">Your {task.state==='done'?'completion':'dismissal'} is saved. Source updates do not reopen this task.</p>}
      <div className="inbox-detail-actions">{task.sourceUrl&&<Button variant="outline" color="secondary" size="sm" onClick={source}>{task.provider==='manual'?'Open sample source':'Open source'} <Icon name="arrow"/></Button>}
        {task.provider==='personal'&&<span className="inbox-muted">Added {date(task.createdAt??task.updatedAt)}</span>}
      </div>
      {!historical&&<TaskPlanEditor key={`${task.id}:${task.version}`} task={task} vm={vm}/>}
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
    <section aria-label={`${vm.filter==='today'?'Today':labels[vm.filter]} tasks`} aria-busy={vm.busy} className="inbox-tasks">
      {vm.items.map((task,i)=>{const historical=task.state==='done'||task.state==='dismissed',selected=task.id===active?.id,completing=vm.busy&&vm.pending?.kind==='decision'&&vm.pending.input.id===task.id&&vm.pending.input.action==='complete';
        const group=vm.filter==='today'?(task.focusOrder?'Top 3':task.state==='in_progress'?'In progress':'Ready'):(vm.filter==='waiting'&&task.reviewDate?'Review '+plannedDate(task.reviewDate):null);
        const prior=vm.items[i-1],priorGroup=prior&&vm.filter==='today'?(prior.focusOrder?'Top 3':prior.state==='in_progress'?'In progress':'Ready'):(prior&&vm.filter==='waiting'&&prior.reviewDate?'Review '+plannedDate(prior.reviewDate):null);
        return <React.Fragment key={task.id}>{group&&group!==priorGroup&&<h3 className="inbox-task-group">{group}</h3>}<article className={`inbox-task ${selected?'is-selected':''}`}>
        <div className="inbox-row">
          {!historical&&task.state!=='inbox'&&<Button className="inbox-complete" color="secondary" variant="outline" size="sm" uniform aria-label={`Complete ${task.title}`} title="Complete task" loading={completing} aria-busy={completing} disabled={vm.busy||!!vm.pending} onClick={()=>vm.decide(task,'complete')}><Icon name="check"/></Button>}
          <button ref={node=>{if(node)rowRefs.current.set(task.id,node);else rowRefs.current.delete(task.id);}} className="inbox-task-open" type="button" aria-current={selected?'true':undefined} aria-controls={detailId} onClick={()=>select(task)} onKeyDown={event=>{
            const next=event.key==='ArrowDown'?i+1:event.key==='ArrowUp'?i-1:event.key==='Home'?0:event.key==='End'?vm.items.length-1:-1;
            if(next>=0&&next<vm.items.length){event.preventDefault();select(vm.items[next],'row');}
          }}>
            <h2>{task.title}</h2>{task.nextAction&&<p className="inbox-preview">{task.nextAction}</p>}
            <div className="inbox-meta"><SourceBadge task={task}/><span>{areaLabels[task.area??'unassigned']}</span>{task.focusOrder&&<span>Top {task.focusOrder}</span>}{task.dueDate&&<span>Due {plannedDate(task.dueDate)}</span>}{task.priorityReason&&<span className={task.suggestedFocus&&!task.focusOrder?'inbox-priority-hint':undefined}>{task.suggestedFocus&&!task.focusOrder?'Suggested for focus: ':''}{task.priorityReason}</span>}{historical&&<span>{task.state==='dismissed'?'Dismissed':task.userDecision==='complete'?'Completed':'Resolved at source'}</span>}{task.state==='snoozed'&&<span>Snoozed</span>}</div>
          </button>
          {!historical&&<TaskActions task={task} vm={vm}/>}
        </div>
      </article></React.Fragment>;})}
    </section>
    <div className="inbox-reader-pane" id={detailId}>{active?<TaskDetail key={active.id} task={active} vm={vm} position={index+1} total={vm.items.length} back={back} previous={index>0?()=>select(vm.items[index-1],'detail'):undefined} next={index<vm.items.length-1?()=>select(vm.items[index+1],'detail'):undefined}/>:<div className="inbox-reader-placeholder"><Icon name="reading"/><h2>Select a task</h2><p>Read the details and decide your next step.</p></div>}</div>
  </div>;
}
