import React from 'react';
import {Button} from '@ai-tools/ui';
import type {Task} from '../shared/contracts.js';
import type {SauronController} from './controller.js';
import {closedTask,summaryLabel} from '../shared/task-tree.js';
import {labels,areaLabels,plannedDate} from './presentation.js';
import {Icon,SourceBadge} from './icons.js';
import {TaskActions} from './TaskActions.js';

type Props={vm:SauronController;active:Task|undefined;detailId:string;rowRefs:React.RefObject<Map<string,HTMLButtonElement>>;select:(task:Task,focus?:'mobile'|'detail'|'row')=>void};
export function TaskList({vm,active,detailId,rowRefs,select}:Props){
  return <section aria-label={`${vm.filter==='today'?'Today':labels[vm.filter]} tasks`} aria-busy={vm.busy} className="inbox-tasks">
    {vm.rows.map(({task,depth,context},i)=>{
      const historical=closedTask(task),children=vm.organisation.tree.children.get(task.id)??[];
      const expanded=vm.organisation.expanded.has(task.id)||vm.hasFilters||vm.history;
      const completing=vm.busy&&vm.pending?.kind==='decision'&&vm.pending.input.id===task.id&&vm.pending.input.action==='complete';
      const group=depth===0&&vm.filter==='today'?(task.focusOrder?'Top 3':task.state==='in_progress'?'In progress':'Ready'):null;
      const prior=vm.rows.slice(0,i).reverse().find(row=>row.depth===0)?.task;
      const priorGroup=prior?(prior.focusOrder?'Top 3':prior.state==='in_progress'?'In progress':'Ready'):null;
      return <React.Fragment key={task.id}>
        {group&&group!==priorGroup&&<h3 className="inbox-task-group">{group}</h3>}
        <article className={`inbox-task ${task.id===active?.id?'is-selected':''} ${context?'is-context':''}`} style={{'--task-depth':Math.min(depth,5)} as React.CSSProperties} draggable={!vm.busy&&!vm.pending&&!vm.organisation.pending}
          onDragStart={event=>event.dataTransfer.setData('application/x-sauron-task',task.id)} onDragOver={event=>event.preventDefault()}
          onDrop={event=>{event.preventDefault();const dragged=vm.organisation.tree.byId.get(event.dataTransfer.getData('application/x-sauron-task'));if(dragged&&dragged.id!==task.id)vm.organisation.requestMove(dragged,task.id);}}>
          <div className="inbox-row">
            {!!children.length&&<Button className="inbox-expand" color="secondary" size="sm" variant="ghost" uniform aria-label={`${expanded?'Collapse':'Expand'} ${task.title}`} aria-expanded={expanded} onClick={()=>vm.organisation.toggle(task.id)}><Icon name={expanded?'chevron':'forward'}/></Button>}
            {!historical&&task.state!=='inbox'&&!context&&<Button className="inbox-complete" color="secondary" variant="outline" size="sm" uniform aria-label={`Complete ${task.title}`} title="Complete task" loading={completing} aria-busy={completing} disabled={vm.busy||!!vm.pending||!!vm.organisation.pending} onClick={()=>vm.decide(task,'complete')}><Icon name="check"/></Button>}
            <button ref={node=>{if(node)rowRefs.current.set(task.id,node);else rowRefs.current.delete(task.id);}} className="inbox-task-open" type="button" aria-current={task.id===active?.id?'true':undefined} aria-controls={detailId} onClick={()=>select(task)} onKeyDown={event=>{
              if(event.key==='ArrowRight'&&children.length){event.preventDefault();if(!expanded)vm.organisation.toggle(task.id);return;}
              if(event.key==='ArrowLeft'&&expanded&&children.length){event.preventDefault();vm.organisation.toggle(task.id);return;}
              const next=event.key==='ArrowDown'?i+1:event.key==='ArrowUp'?i-1:event.key==='Home'?0:event.key==='End'?vm.rows.length-1:-1;
              if(next>=0&&next<vm.rows.length){event.preventDefault();select(vm.rows[next].task,'row');}
            }}>
              <h2>{task.title}</h2>{task.nextAction&&<p className="inbox-preview">{task.nextAction}</p>}
              <div className="inbox-meta"><SourceBadge task={task}/><span>{areaLabels[task.area??'unassigned']}</span>{task.focusOrder&&<span>Top {task.focusOrder}</span>}{task.dueDate&&<span>Due {plannedDate(task.dueDate)}</span>}{task.ownNeedsAttention&&<strong>Needs attention</strong>}{!!children.length&&<span>{summaryLabel(task.descendantSummary!)}</span>}{context&&<span>Parent context</span>}{historical&&<span>{task.state==='dismissed'?'Dismissed':task.userDecision==='complete'?'Completed':'Resolved at source'}</span>}{task.state==='snoozed'&&<span>Snoozed</span>}{task.priorityReason&&<span>{task.suggestedFocus&&!task.focusOrder?'Suggested for focus: ':''}{task.priorityReason}</span>}</div>
              {vm.organisation.topic!=='all'&&task.parentId&&<p className="inbox-muted inbox-parent-context">{vm.organisation.tree.ancestors(task.id).reverse().map(parent=>parent.title).join(' / ')}</p>}
            </button>
            {!historical&&<TaskActions task={task} vm={vm}/>}
          </div>
          {expanded&&children.some(closedTask)&&<Button color="secondary" size="sm" variant="ghost" onClick={()=>vm.organisation.toggleClosed(task.id)}>{vm.organisation.showClosed.has(task.id)?'Hide closed':'Show closed'}</Button>}
        </article>
      </React.Fragment>;
    })}
  </section>;
}
