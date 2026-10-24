import React, { useId, useRef, useState } from 'react';
import { Button } from '@ai-tools/ui';
import { Menu } from '@ai-tools/ui';
import type { Task } from '../shared/contracts.js';
import type { SauronController } from './controller.js';
import { Icon, SourceBadge } from './icons.js';
import { date, labels } from './presentation.js';
import { DiscussTask } from './DiscussTask.js';
import { ReplyComposer } from './ReplyComposer.js';

function TaskActions({task,vm,label=`Actions for ${task.title}`}:{task:Task;vm:SauronController;label?:string}){
  return <Menu><Menu.Trigger><Button color="secondary" variant="ghost" size="sm" uniform aria-label={label} disabled={vm.busy||!!vm.pending}><span aria-hidden="true" className="inbox-ellipsis">⋯</span></Button></Menu.Trigger>
    <Menu.Content align="end" minWidth={180}>
      <Menu.Item onSelect={()=>vm.decide(task,task.state==='snoozed'?'reopen':'snooze')}>{task.state==='snoozed'?'Bring back now':'Snooze 1 hour'}</Menu.Item>
      <Menu.Item onSelect={()=>vm.setDismiss(task)}>Dismiss</Menu.Item>
    </Menu.Content></Menu>;
}
function TaskDetail({task,vm,position,total,back,previous,next}:{task:Task;vm:SauronController;position:number;total:number;back:()=>void;previous?:()=>void;next?:()=>void}){
  const titleId=useId();const historical=task.state==='done'||task.state==='dismissed';
  const disabled=vm.busy||!!vm.pending;
  const source=()=>{if(task.sourceUrl)void vm.client?.open(task.sourceUrl).catch(()=>vm.setError('The source link could not be opened. Try again from the task.'));};
  return <section className="inbox-task-detail" aria-labelledby={titleId}>
    <div className="inbox-reader-tools">
      <Button className="inbox-back" color="secondary" variant="ghost" size="sm" onClick={back}><Icon name="back"/> Back to tasks</Button>
      {!historical&&<Button color="secondary" variant="outline" size="sm" disabled={disabled} onClick={()=>vm.decide(task,'complete')}><Icon name="check"/> Complete</Button>}
      {historical&&!('resolved' in task&&task.resolved&&!task.userDecision)&&<Button variant="outline" color="secondary" size="sm" disabled={disabled} onClick={()=>vm.decide(task,'reopen')}>Reopen task</Button>}
      {!historical&&<TaskActions task={task} vm={vm} label="More task actions"/>}
      <div className="inbox-reader-paging"><span>{position} of {total}</span><Button uniform size="sm" color="secondary" variant="ghost" aria-label="Previous task" disabled={!previous} onClick={previous}><Icon name="back"/></Button><Button uniform size="sm" color="secondary" variant="ghost" aria-label="Next task" disabled={!next} onClick={next}><Icon name="forward"/></Button></div>
    </div>
    <div className="inbox-reader-content">
      <div className="inbox-detail-meta"><SourceBadge task={task}/><span className={`inbox-state inbox-state-${task.state}`}>{labels[task.state]}</span></div>
      <h2 id={titleId} tabIndex={-1} aria-label={`Task details: ${task.title}`}>{task.title}</h2>
      {historical&&<p className="inbox-detail-date">{task.state==='dismissed'?'Dismissed':task.userDecision==='complete'?'Completed':'Resolved at source'}{task.decidedAt&&<> · <time dateTime={task.decidedAt}>{date(task.decidedAt)}</time></>}</p>}
      {task.state==='snoozed'&&task.snoozedUntil&&<p className="inbox-detail-date">Returns {date(task.snoozedUntil)}</p>}
      <div className="inbox-detail-context"><h3>{task.provider==='personal'?'Task notes':task.provider==='manual'?'Latest sample context':'Latest source context'}</h3>
        <p className={`inbox-context ${!task.nextAction?'inbox-muted':''}`}>{task.nextAction||'No additional notes.'}</p>
      </div>
      {'provenance' in task&&task.provenance&&<details><summary>Source evidence</summary><p className="inbox-context">{task.provenance.evidence}</p><p className="inbox-muted">Read by dot{task.lastCheckedAt&&<> · {date(task.lastCheckedAt)}</>}</p></details>}
      {historical&&task.userDecision&&task.provider!=='personal'&&<p className="inbox-saved-decision">Your {task.state==='done'?'completion':'dismissal'} is saved. Source updates do not reopen this task.</p>}
      <div className="inbox-detail-actions">{task.sourceUrl&&<Button variant="outline" color="secondary" size="sm" onClick={source}>{task.provider==='manual'?'Open sample source':'Open source'} <Icon name="arrow"/></Button>}
        {task.provider==='personal'&&<span className="inbox-muted">Added {date(task.createdAt??task.updatedAt)}</span>}
      </div>
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
    <section aria-label={`${labels[vm.filter]} tasks`} aria-busy={vm.busy} className="inbox-tasks">
      {vm.items.map((task,i)=>{const historical=task.state==='done'||task.state==='dismissed',selected=task.id===active?.id;return <article key={task.id} className={`inbox-task ${selected?'is-selected':''}`}>
        <div className="inbox-row">
          {!historical&&<Button className="inbox-complete" color="secondary" variant="outline" size="sm" uniform aria-label={`Complete ${task.title}`} title="Complete task" disabled={vm.busy||!!vm.pending} onClick={()=>vm.decide(task,'complete')}><Icon name="check"/></Button>}
          <button ref={node=>{if(node)rowRefs.current.set(task.id,node);else rowRefs.current.delete(task.id);}} className="inbox-task-open" type="button" aria-current={selected?'true':undefined} aria-controls={detailId} onClick={()=>select(task)} onKeyDown={event=>{
            const next=event.key==='ArrowDown'?i+1:event.key==='ArrowUp'?i-1:event.key==='Home'?0:event.key==='End'?vm.items.length-1:-1;
            if(next>=0&&next<vm.items.length){event.preventDefault();select(vm.items[next],'row');}
          }}>
            <h2>{task.title}</h2>{task.nextAction&&<p className="inbox-preview">{task.nextAction}</p>}
            <div className="inbox-meta"><SourceBadge task={task}/>{historical&&<span>{task.state==='dismissed'?'Dismissed':task.userDecision==='complete'?'Completed':'Resolved at source'}</span>}{task.state==='snoozed'&&<span>Snoozed</span>}</div>
          </button>
          {!historical&&<TaskActions task={task} vm={vm}/>}
        </div>
      </article>;})}
    </section>
    <div className="inbox-reader-pane" id={detailId}>{active?<TaskDetail key={active.id} task={active} vm={vm} position={index+1} total={vm.items.length} back={back} previous={index>0?()=>select(vm.items[index-1],'detail'):undefined} next={index<vm.items.length-1?()=>select(vm.items[index+1],'detail'):undefined}/>:<div className="inbox-reader-placeholder"><Icon name="reading"/><h2>Select a task</h2><p>Read the details and decide your next step.</p></div>}</div>
  </div>;
}
