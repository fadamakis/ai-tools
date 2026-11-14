import {useState,useRef} from 'react';
import {Button} from '@ai-tools/ui';
import {DropdownMenu as Menu} from 'radix-ui';
import type {Task} from '../shared/contracts.js';
import type {SauronController} from './controller.js';
import {focusEligible} from '../shared/task-tree.js';
export function TaskActions({task,vm,label=`Actions for ${task.title}`}:{task:Task;vm:SauronController;label?:string}){
  const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null);
  const actionable=(vm.view?.items??[]).filter(focusEligible)
    .sort((a,b)=>(a.focusOrder??99)-(b.focusOrder??99)||
      (a.state==='in_progress'?0:1)-(b.state==='in_progress'?0:1)||(a.order??999999)-(b.order??999999)||a.id.localeCompare(b.id));
  const ids=actionable.map(item=>item.id),focus=actionable.filter(item=>item.focusOrder).sort((a,b)=>a.focusOrder!-b.focusOrder!).map(item=>item.id);
  const position=ids.indexOf(task.id);
  const canMove=(delta:number)=>{
    const neighbor=actionable[position+delta];
    return position>=0&&!vm.hasFilters&&!!neighbor&&(!!task.focusOrder!==!!neighbor.focusOrder||task.state===neighbor.state);
  };
  const move=(delta:number)=>{
    const neighbor=actionable[position+delta],next=[...ids];
    [next[position],next[position+delta]]=[next[position+delta],next[position]];
    const focusIds=!!task.focusOrder===!!neighbor.focusOrder?focus:
      focus.map(id=>id===(task.focusOrder?task.id:neighbor.id)?(task.focusOrder?neighbor.id:task.id):id);
    vm.order(next,next.filter(id=>focusIds.includes(id)));
  };
  const toggleFocus=()=>vm.order(ids,focus.includes(task.id)?focus.filter(id=>id!==task.id):[...focus,task.id]);
  return <Menu.Root open={open} onOpenChange={setOpen} modal={false}><Menu.Trigger asChild><Button ref={trigger} color="secondary" variant="ghost" size="sm" uniform aria-label={label} disabled={vm.busy||!!vm.pending}><span aria-hidden="true" className="inbox-ellipsis">⋯</span></Button></Menu.Trigger>
    <Menu.Portal><Menu.Content className="inbox-task-menu" align="end" sideOffset={5} collisionPadding={12} style={{minWidth:180}} onCloseAutoFocus={event=>event.preventDefault()} onEscapeKeyDown={()=>trigger.current?.focus()}>
      {(task.state==='ready'||task.state==='in_progress')&&<>
        {!task.parentId&&(focus.includes(task.id)?<Menu.Item className="inbox-task-menu-item" onSelect={toggleFocus}>Remove from Top 3</Menu.Item>:focus.length<3&&<Menu.Item className="inbox-task-menu-item" onSelect={toggleFocus}>Add to Top 3</Menu.Item>)}
        {canMove(-1)&&<Menu.Item className="inbox-task-menu-item" onSelect={()=>move(-1)}>Move up</Menu.Item>}
        {canMove(1)&&<Menu.Item className="inbox-task-menu-item" onSelect={()=>move(1)}>Move down</Menu.Item>}
        <Menu.Item className="inbox-task-menu-item" onSelect={()=>vm.plan(task,{workflowState:task.state==='ready'?'in_progress':'ready'})}>{task.state==='ready'?'Start work':'Move to Ready'}</Menu.Item>
        <Menu.Item className="inbox-task-menu-item" onSelect={()=>vm.plan(task,{workflowState:'waiting'})}>Move to Waiting</Menu.Item>
      </>}
      {task.state==='waiting'&&<Menu.Item className="inbox-task-menu-item" onSelect={()=>vm.plan(task,{workflowState:'ready'})}>Move to Ready</Menu.Item>}
      <Menu.Item className="inbox-task-menu-item" onSelect={()=>vm.organisation.requestMove(task)}>Move task</Menu.Item>
      <Menu.Item className="inbox-task-menu-item" onSelect={()=>vm.addChild(task)}>Add child</Menu.Item>
      <Menu.Item className="inbox-task-menu-item" onSelect={()=>void vm.organisation.attention(task,!task.ownNeedsAttention)}>{task.ownNeedsAttention?'Mark handled':'Mark needs attention'}</Menu.Item>
      <Menu.Item className="inbox-task-menu-item" onSelect={()=>vm.decide(task,task.state==='snoozed'?'reopen':'snooze')}>{task.state==='snoozed'?'Bring back now':'Snooze 1 hour'}</Menu.Item>
      <Menu.Item className="inbox-task-menu-item" onSelect={()=>vm.setDismiss(task)}>Dismiss</Menu.Item>
    </Menu.Content></Menu.Portal></Menu.Root>;
}
