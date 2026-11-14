import {useState} from 'react';
import type {Client} from './client.js';
import type {Result,Task} from '../shared/contracts.js';
import type {OrganiseTaskInput} from '../shared/organisation.js';
import {operationId} from './operation.js';
import {taskTree} from '../shared/task-tree.js';

const pendingKey='sauron:organisation-pending:v1';
type SavedOperation={storeId:string;request:OrganiseTaskInput};
const readPending=():SavedOperation|null=>{try{return JSON.parse(sessionStorage.getItem(pendingKey)??'null');}catch{return null;}};
export function useTaskOrganisation(view:Result|null,client:Client|null,run:(work:()=>Promise<Result>)=>Promise<Result|undefined>){
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [showClosed,setShowClosed]=useState<Set<string>>(new Set());
  const [topic,setTopic]=useState('all');
  const [attentionOnly,setAttentionOnly]=useState(false);
  const [move,setMove]=useState<{task:Task;parentId:string|null;revision:number}|null>(null);
  const [pending,setPending]=useState<SavedOperation|null>(readPending);
  const remember=(next:SavedOperation|null)=>{setPending(next);try{if(next)sessionStorage.setItem(pendingKey,JSON.stringify(next));else sessionStorage.removeItem(pendingKey);}catch{}};
  async function submit(request:OrganiseTaskInput){
    if(!view||!client)return;
    const operation={storeId:view.storeId,request};remember(operation);
    const saved=await run(()=>client.call('organise_attention_task',{request}));
    if(saved){remember(null);return saved;}return undefined;
  }
  const identity=()=>({operationId:operationId(),expectedStoreId:view!.storeId,expectedRevision:view!.taskViewRevision??0});
  const attention=(task:Task,needsAttention:boolean)=>submit({...identity(),action:'attention',id:task.id,needsAttention});
  const topics=(task:Task,names:string[])=>submit({...identity(),action:'topics',id:task.id,topics:names});
  const requestMove=(task:Task,parentId:string|null=task.parentId??null)=>setMove({task,parentId,revision:view?.taskViewRevision??0});
  async function confirmMove(){
    if(!move||!view)return;
    const saved=await submit({...identity(),expectedRevision:move.revision,action:'move',id:move.task.id,parentId:move.parentId});
    if(saved){if(move.parentId)setExpanded(old=>new Set([...old,move.parentId!]));setMove(null);}
  }
  async function retry(){
    if(!pending||!view||!client||pending.storeId!==view.storeId)return;
    const saved=await run(()=>client.call('organise_attention_task',{request:pending.request}));if(saved)remember(null);
  }
  const toggle=(id:string)=>setExpanded(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;});
  const toggleClosed=(id:string)=>setShowClosed(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;});
  const tree=taskTree(view?.items??[]);
  return {expanded,showClosed,topic,setTopic,attentionOnly,setAttentionOnly,move,setMove,requestMove,confirmMove,attention,topics,toggle,toggleClosed,tree,pending,retry,cancelPending:()=>remember(null)};
}
export type TaskOrganisationController=ReturnType<typeof useTaskOrganisation>;
