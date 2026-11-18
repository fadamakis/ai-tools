import {useRecovery,type Run} from './useRecovery.js';
import {organiseTaskSchema} from '../shared/organisation.js';
import {useState} from 'react';
import type {Client} from './client.js';
import type {Result,Task} from '../shared/contracts.js';
import type {OrganiseTaskInput} from '../shared/organisation.js';
import {operationId} from './operation.js';
import {taskTree} from '../shared/task-tree.js';

const pendingKey='sauron:organisation-pending:v1';
type SavedOperation={storeId:string;request:OrganiseTaskInput};
export function useTaskOrganisation(view:Result|null,client:Client|null,run:Run){
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [showClosed,setShowClosed]=useState<Set<string>>(new Set());
  const [topic,setTopic]=useState('all');
  const [attentionOnly,setAttentionOnly]=useState(false);
  const [move,setMove]=useState<{task:Task;parentId:string|null;revision:number}|null>(null);
  const recovery=useRecovery<SavedOperation>({key:pendingKey,action:'task_change',view,client,run,
    parse:value=>{const saved=value as SavedOperation;return {storeId:organiseTaskSchema.parse(saved.request).expectedStoreId,request:organiseTaskSchema.parse(saved.request)};},
    receipt:value=>({id:'organise:'+value.request.operationId,payload:organiseTaskSchema.parse(value.request)}),
    store:value=>value.storeId,label:value=>value.request.action==='topics'?'the topic change':value.request.action==='move'?'the task move':'the attention change',
    execute:(client,value)=>client.call('organise_attention_task',{request:value.request}),
    prepare:(value,latest)=>{if(!latest.items.some(task=>task.id===value.request.id))return null;if(value.request.action==='move'){const parentId=value.request.parentId;if(parentId&&!latest.items.some(task=>task.id===parentId&&task.state!=='done'&&task.state!=='dismissed'))return null;try{taskTree(latest.items).validateMove(value.request.id,parentId);}catch{return null;}}return {storeId:latest.storeId,request:{...value.request,operationId:operationId(),expectedRevision:latest.taskViewRevision??0}};},
    summary:(value,latest)=>{const task=latest.items.find(task=>task.id===value.request.id)!;const request=value.request;return `Latest task: ${task.title} (${task.state}). Intended change: ${request.action==='topics'?(request.topics.length?'set topics to '+request.topics.join(', '):'clear direct topics'):request.action==='move'?'move to '+(request.parentId?latest.items.find(task=>task.id===request.parentId)?.title??'an unavailable parent task':'top level'):request.needsAttention?'mark needs attention':'mark handled'}.${request.action==='move'&&task.focusOrder&&request.parentId?' This removes its Top 3 slot.':''}${request.action==='move'&&taskTree(latest.items).descendants(task.id).length?' Descendants also move: '+taskTree(latest.items).descendants(task.id).map(task=>task.title).join(', ')+'.':''}`;},
    onSaved:()=>setMove(null)});
  const pending=recovery.pending;
  async function submit(request:OrganiseTaskInput){if(!view)return;return recovery.submit({storeId:view.storeId,request});}
  const identity=()=>({operationId:operationId(),expectedStoreId:view!.storeId,expectedRevision:view!.taskViewRevision??0});
  const attention=(task:Task,needsAttention:boolean)=>submit({...identity(),action:'attention',id:task.id,needsAttention});
  const topics=(task:Task,names:string[])=>submit({...identity(),action:'topics',id:task.id,topics:names});
  const requestMove=(task:Task,parentId:string|null=task.parentId??null)=>setMove({task,parentId,revision:view?.taskViewRevision??0});
  async function confirmMove(){
    if(!move||!view)return;
    const saved=await submit({...identity(),expectedRevision:move.revision,action:'move',id:move.task.id,parentId:move.parentId});
    if(saved){if(move.parentId)setExpanded(old=>new Set([...old,move.parentId!]));setMove(null);}
  }
  const toggle=(id:string)=>setExpanded(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;});
  const toggleClosed=(id:string)=>setShowClosed(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;});
  const tree=taskTree(view?.items??[]);
  return {expanded,showClosed,topic,setTopic,attentionOnly,setAttentionOnly,move,setMove,requestMove,confirmMove,attention,topics,toggle,toggleClosed,tree,pending,recovery,retry:recovery.retry,cancelPending:recovery.dismiss};
}
export type TaskOrganisationController=ReturnType<typeof useTaskOrganisation>;
