import {useEffect,useRef,useState} from 'react';
import {Button} from '@ai-tools/ui';
import type {Task} from '../shared/contracts.js';
import type {SauronController} from './controller.js';
import {closedTask,summaryLabel} from '../shared/task-tree.js';

export function OrganisationDialog({vm}:{vm:SauronController}){
  const ref=useRef<HTMLDialogElement>(null),org=vm.organisation,move=org.move;
  useEffect(()=>{if(move)ref.current?.showModal();else ref.current?.close();},[!!move]);
  if(!move)return null;
  const stale=move.revision!==vm.view?.taskViewRevision;
  const count=org.tree.descendants(move.task.id).length;
  const excluded=new Set([move.task.id,...org.tree.descendants(move.task.id).map(task=>task.id)]);
  return <dialog ref={ref} className="inbox-dialog" aria-labelledby="move-task-title" onCancel={()=>org.setMove(null)}>
    <h2 id="move-task-title">Move {move.task.title}</h2>
    <p>{count?`This moves the task and ${count} descendant${count===1?'':'s'}.`:'This moves the task.'}</p>
    <label>Parent task<select value={move.parentId??''} onChange={event=>org.setMove({...move,parentId:event.target.value||null})}>
      <option value="">Top level</option>{(vm.view?.items??[]).filter(task=>!excluded.has(task.id)&&!closedTask(task)).map(task=><option key={task.id} value={task.id}>{[...org.tree.ancestors(task.id)].reverse().map(parent=>parent.title).concat(task.title).join(' / ')}</option>)}
    </select></label>
    {move.task.focusOrder&&move.parentId&&<p>This removes its Top 3 slot. The destination’s priority stays unchanged.</p>}
    {stale&&<p role="alert">Tasks changed. Review the latest task list before confirming.</p>}
    <div className="inbox-dialog-actions"><Button color="secondary" variant="ghost" onClick={()=>org.setMove(null)}>Cancel</Button>{stale?<Button color="secondary" onClick={()=>org.requestMove(org.tree.byId.get(move.task.id)??move.task,move.parentId)}>Review latest</Button>:<Button color="secondary" disabled={vm.busy||!!org.pending} onClick={()=>void org.confirmMove()}>Confirm move</Button>}</div>
  </dialog>;
}
export function TaskOrganisationEditor({task,vm}:{task:Task;vm:SauronController}){
  const org=vm.organisation;
  const names=(vm.view?.topics??[]).filter(topic=>task.directTopicIds?.includes(topic.id)).map(topic=>topic.name).join(', ');
  const [topics,setTopics]=useState(names),[baseline,setBaseline]=useState(names);
  useEffect(()=>{if(topics===baseline){setTopics(names);setBaseline(names);}},[names]);
  const inherited=(vm.view?.topics??[]).filter(topic=>task.topicIds?.includes(topic.id)&&!task.directTopicIds?.includes(topic.id));
  const disabled=vm.busy||!!vm.pending||!!org.pending;
  return <section className="inbox-organisation" aria-label={`Organisation for ${task.title}`}>
    <h3>Organisation</h3>
    {task.parentId&&<p>Parent: {org.tree.byId.get(task.parentId)?.title}</p>}
    {!!org.tree.children.get(task.id)?.length&&<p>{summaryLabel(task.descendantSummary!)}</p>}
    <div className="inbox-detail-actions"><Button size="sm" variant="outline" color="secondary" disabled={disabled} onClick={()=>org.requestMove(task)}>Move task</Button>
      {!closedTask(task)&&<><Button size="sm" variant="outline" color="secondary" disabled={disabled} onClick={()=>vm.addChild(task)}>Add child</Button><Button size="sm" variant="outline" color="secondary" disabled={disabled} onClick={()=>void org.attention(task,!task.ownNeedsAttention)}>{task.ownNeedsAttention?'Mark handled':'Mark needs attention'}</Button></>}
    </div>
    {!!task.reopenSuggestion?.length&&<div role="status"><p>New activity suggests reopening this task{task.reopenSuggestion.length>1?' and its closed ancestors':''}.</p><Button color="secondary" size="sm" disabled={disabled} onClick={()=>vm.decide(task,'reopen')}>Review reopening</Button><Button color="secondary" size="sm" variant="ghost" disabled={disabled} onClick={()=>void org.attention(task,false)}>Keep closed</Button></div>}
    <form onSubmit={event=>{event.preventDefault();void org.topics(task,topics.split(',').map(name=>name.trim()).filter(Boolean)).then(saved=>{if(saved)setBaseline(topics);});}}>
      <label>Direct topics, separated by commas<input value={topics} onChange={event=>setTopics(event.target.value)} disabled={disabled}/></label>
      {!!inherited.length&&<p>Inherited: {inherited.map(topic=>topic.name).join(', ')}</p>}
      <Button type="submit" size="sm" color="secondary" disabled={disabled||topics===baseline}>Save topics</Button>
    </form>
  </section>;
}
