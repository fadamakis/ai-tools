import {useRecovery} from './useRecovery.js';
import {errorDetail,failureMessage} from '../shared/errors.js';
import {decisionSchema,personalTaskSchema,configureSourcesSchema,planTaskSchema,orderTasksSchema} from '../shared/contracts.js';
import {useOrganisationReview} from './OrganisationReview.js';
import {useTaskOrganisation} from './useTaskOrganisation.js';
import {taskTree,visibleTaskRows,focusEligible} from '../shared/task-tree.js';
import { useEffect, useRef, useState } from 'react';
import { connect, type Client } from './client.js';
import { syntheticObservation, defaultSourcePreferences, type LiveProvider, type SourceKind, type WorkArea, type Task, type TaskState, type Result, type DecisionInput, type PersonalTaskInput } from '../shared/contracts.js';
import { sourceOf } from './icons.js';
import { operationId } from './operation.js';
import { mergeSavedView } from './presentation.js';
type Pending=({kind:'decision';input:DecisionInput}|{kind:'create';input:PersonalTaskInput})&{storeId?:string};
const pendingKey='attention:pending:v2';
const draftKey='sauron:draft:v1';
const storage={
  read:(key:string)=>{try{return JSON.parse(sessionStorage.getItem(key)??'null');}catch{return null;}},
  write:(key:string,value:unknown)=>{try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));}catch{/* The store remains authoritative if browser storage is unavailable. */}},
};
export type Draft={parentId?:string;title:string;nextAction:string;sourceState:'needs_you'|'waiting'};
function connectionMessage(error:unknown){const detail=errorDetail(error);return detail.category==='build_mismatch'||detail.category==='unavailable'?failureMessage('the connection',detail):'Couldn’t load the latest tasks. Your current view may be out of date. Reload tasks or reconnect Sauron.';}
const emptyDraft:Draft={title:'',nextAction:'',sourceState:'needs_you'};
type Filter='today'|'inbox'|'waiting'|'snoozed'|'done'|'dismissed';

export function useSauronController(){
  const [view,setView]=useState<Result|null>(null);
  const [client,setClient]=useState<Client|null>(null);
  const [filter,setFilter]=useState<Filter>('today');
  const [source,setSource]=useState<SourceKind|'all'>('all');
  const [area,setArea]=useState<WorkArea|'all'>('all');
  const [weeklyReview,setWeeklyReview]=useState(false);
  const [busy,setBusy]=useState(false);
  const [actionError,setError]=useState('');
  const [connectionError,setConnectionError]=useState('');
  const error=actionError||connectionError;
  const [sourceMenuOpen,setSourceMenuOpen]=useState(false);
  const [sourceSaving,setSourceSaving]=useState(false);

  const [query,setQuery]=useState('');
  const currentView=useRef({filter:'today' as Filter,source:'all' as SourceKind|'all',area:'all' as WorkArea|'all',query:''});
  const [adding,setAdding]=useState(()=>!!storage.read(draftKey));
  const [draft,setDraft]=useState<Draft>(()=>storage.read(draftKey)??emptyDraft);
  const changeDraft=(patch:Partial<Draft>)=>{const next={...draft,...patch};setDraft(next);storage.write(draftKey,next);};
  const cancelDraft=()=>{setDraft(emptyDraft);storage.write(draftKey,null);setAdding(false);};
  const [dismiss,setDismiss]=useState<Task|null>(null);
  const [notice,setNotice]=useState('');
  const [reopenId,setReopenId]=useState<string|null>(null);
  const [diagnostics,setDiagnostics]=useState(false);
  const [connectionAttempt,setConnectionAttempt]=useState(0);
  const [theme,setTheme]=useState(()=>window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  const gate=useRef(false);
  const c=useRef<Client|null>(null);
  const apply=(next:Result)=>setView(old=>mergeSavedView(old,next));
  async function run(work:()=>Promise<Result>, success?:(saved:Result)=>void, failure?:(error:unknown)=>void){
    if(gate.current)return;
    gate.current=true;setBusy(true);
    try{const saved=await work();apply(saved);success?.(saved);return saved;}
    catch(e){if(failure)failure(e);else setError(failureMessage('the requested action',errorDetail(e)));}
    finally{gate.current=false;setBusy(false);}
  }
  const organisation=useTaskOrganisation(view,client,run);
  const review=useOrganisationReview(view,client,run,apply);
  const [branchDecision,setBranchDecision]=useState<{task:Task;action:DecisionInput['action'];revision:number}|null>(null);
  const addChild=(task:Task)=>{setDraft({...emptyDraft,parentId:task.id});setAdding(true);if(!organisation.expanded.has(task.id))organisation.toggle(task.id);};
  const readSaved=()=>{if(c.current)void run(()=>c.current!.call('list_attention'),()=>{setError('');setConnectionError('');},e=>setConnectionError(connectionMessage(e)));};
  const refresh=()=>{if(c.current)void run(()=>c.current!.call('refresh_attention'),undefined,()=>setError('Couldn’t confirm the source check. Reload tasks to check Update details before using Refresh again.'));};
  const sourceRecovery=useRecovery({key:'sauron:source-pending:v1',action:'sources',view,client,run,
    parse:value=>configureSourcesSchema.parse(value),receipt:value=>({id:'sources:'+value.operationId,payload:configureSourcesSchema.parse(value)}),store:value=>value.expectedStoreId,label:()=> 'the source setting',
    execute:(client,value)=>client.call('configure_attention_sources',value),
    prepare:(value,latest)=>({...value,operationId:operationId(),expectedRevision:(latest.sourcePreferences??defaultSourcePreferences()).revision}),
    summary:value=>`Intended change: turn ${value.provider} ${value.enabled?'on':'off'}. Review the current switches before applying this change.`});
  async function saveSource(provider:LiveProvider,enabled:boolean){
    if(!client||!view||gate.current||actionLocked)return;
    setSourceSaving(true);
    try{await sourceRecovery.submit({expectedStoreId:view.storeId,operationId:operationId(),expectedRevision:(view.sourcePreferences??defaultSourcePreferences()).revision,provider,enabled});}
    finally{setSourceSaving(false);}
  }
  useEffect(()=>{
    let active=true;
    let lastActiveAt=Date.now();
    const localTrigger=(next:Result)=>{if(active&&next.coordination?.mode==='local_managed'&&c.current)void c.current.call('check_local_attention',{expectedStoreId:next.storeId,reason:'reconnect'}).then(saved=>{if(active)apply(saved);}).catch(()=>{});};
    setConnectionError('');
    connect(next=>{if(active){apply(next);setConnectionError('');}}).then(next=>{
      if(!active)return;
      c.current=next;setClient(next);
      void run(async()=>{const saved=await next.call('list_attention');localTrigger(saved);setConnectionError('');return saved;},undefined,e=>setConnectionError(connectionMessage(e)));
    }).catch(e=>{if(active)setConnectionError(connectionMessage(e));});
    const onFocus=()=>{
      const resumed=Date.now()-lastActiveAt>90_000;lastActiveAt=Date.now();
      // A focus read must not move or disable the control the user is clicking.
      if(active&&c.current)void c.current.call('list_attention')
        .then(next=>{if(active){apply(next);setConnectionError('');if(resumed)localTrigger(next);}})
        .catch(e=>{if(active&&!gate.current)setConnectionError(connectionMessage(e));});
    };
    window.addEventListener('focus',onFocus);
    const onVisible=()=>{if(document.visibilityState==='visible')onFocus();};
    document.addEventListener('visibilitychange',onVisible);
    const onOnline=()=>{lastActiveAt=0;onFocus();};
    window.addEventListener('online',onOnline);
    const savedTimer=window.setInterval(()=>{if(document.visibilityState==='visible'&&!gate.current)onFocus();},15_000);
    return()=>{active=false;window.clearInterval(savedTimer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('online',onOnline);};
  },[connectionAttempt]);
  const scanning=view?.scan?.status==='running'||view?.sync?.status==='running';
  useEffect(()=>{
    if(!scanning||!client)return;
    let active=true,loading=false;
    const poll=async()=>{
      if(loading)return;loading=true;
      try{const next=await client.call('list_attention');if(active){apply(next);setConnectionError('');}}
      catch(e){if(active)setConnectionError(connectionMessage(e));}
      finally{loading=false;}
    };
    const timer=window.setInterval(()=>void poll(),1500);
    return()=>{active=false;window.clearInterval(timer);};
  },[scanning,client]);
  const taskRecovery=useRecovery<Pending>({key:pendingKey,action:value=>value.kind==='create'?'task_create':'task_decision',view,client,run,
    parse:value=>{const saved=value as Pending;const input=saved.kind==='create'?personalTaskSchema.parse(saved.input):saved.kind==='decision'?decisionSchema.parse(saved.input):null;if(!input)throw Error('invalid');return {...saved,input} as Pending;},
    receipt:value=>({id:(value.kind==='create'?'personal:':'decision:')+value.input.operationId,payload:value.kind==='create'?personalTaskSchema.parse(value.input):decisionSchema.parse(value.input)}),
    store:value=>value.storeId??value.input.expectedStoreId,label:value=>value.kind==='create'?'the new task':'the task decision',
    execute:(client,value)=>client.call(value.kind==='create'?'create_personal_task':'decide_attention_item',value.input),
    prepare:(value,latest)=>{
      if(value.kind==='create'){if(value.input.parentId&&!latest.items.some(task=>task.id===value.input.parentId&&task.state!=='done'&&task.state!=='dismissed'))return null;return {...value,storeId:latest.storeId,input:{...value.input,operationId:operationId(),...(value.input.parentId?{expectedStoreId:latest.storeId,expectedRevision:latest.taskViewRevision??0}:{})}};}
      const task=latest.items.find(task=>task.id===value.input.id);if(!task||value.input.action!=='reopen'&&(task.userDecision==='complete'||task.userDecision==='dismiss'))return null;
      const tree=taskTree(latest.items);
      const branch=value.input.branch||['complete','dismiss'].includes(value.input.action)&&tree.descendants(task.id).some(task=>task.state!=='done'&&task.state!=='dismissed')||value.input.action==='reopen'&&tree.ancestors(task.id).some(task=>task.state==='done'||task.state==='dismissed');
      return {...value,storeId:latest.storeId,input:{...value.input,operationId:operationId(),expectedVersion:task.version,expectedStoreId:latest.storeId,...(branch?{branch:true,expectedRevision:latest.taskViewRevision??0}:{}),...(value.input.action==='snooze'?{snoozedUntil:new Date(Date.now()+3_600_000).toISOString()}:{})}};
    },
    summary:(value,latest)=>{if(value.kind==='create')return `Create task: ${value.input.title}${value.input.parentId?' under '+latest.items.find(task=>task.id===value.input.parentId)?.title:''}.`;const task=latest.items.find(task=>task.id===value.input.id)!;const tree=taskTree(latest.items);const affected=value.input.action==='reopen'?tree.ancestors(task.id).filter(task=>task.state==='done'||task.state==='dismissed'):tree.descendants(task.id).filter(task=>task.state!=='done'&&task.state!=='dismissed');return `Latest task: ${task.title} (${task.state}). Intended decision: ${value.input.action}.${value.input.branch?` Also affects: ${affected.map(task=>task.title).join(', ')||'no additional tasks'}.`:''}`;},
    onSaved:(saved,value)=>{
      setNotice(value.kind==='create'?'Task added.':value.input.action==='complete'?'Task completed.':value.input.action==='dismiss'?'Task dismissed.':value.input.action==='reopen'?'Task reopened.':'Task snoozed for one hour.');
      if(value.kind==='create'){apply(saved);const task=saved.items.find(task=>task.id==='personal:'+value.input.operationId);if(task)finishCreation(task);}
      else {apply(saved);const task=saved.items.find(task=>task.id===value.input.id);setReopenId(value.input.action==='reopen'?null:value.input.id);if(value.input.action==='reopen'&&task)selectTaskWorkflow(task);}
    }});
  const pending=taskRecovery.pending,recovering=taskRecovery.visible;
  function save(value:Pending){if(actionLocked||gate.current)return;setNotice('');setReopenId(null);void taskRecovery.submit({...value,storeId:value.storeId??view?.storeId});}
  function decide(task:Task,action:DecisionInput['action'],confirmed=false){
    const tree=taskTree(view?.items??[]),hasOpen=tree.descendants(task.id).some(child=>child.state!=='done'&&child.state!=='dismissed');
    const closedAncestors=tree.ancestors(task.id).some(parent=>parent.state==='done'||parent.state==='dismissed');
    if(!confirmed&&((['complete','dismiss'].includes(action)&&hasOpen)||(action==='reopen'&&closedAncestors))){setBranchDecision({task,action,revision:view?.taskViewRevision??0});return;}
    save({kind:'decision',input:{id:task.id,action,...(confirmed?{branch:true,expectedStoreId:view!.storeId,expectedRevision:branchDecision!.revision}:{}),expectedVersion:task.version,operationId:operationId(),
      ...(action==='snooze'?{snoozedUntil:new Date(Date.now()+3_600_000).toISOString()}:{}),}});
  }
  function finishCreation(task:Task){
    storage.write(draftKey,null);setDraft(emptyDraft);setAdding(false);selectTaskWorkflow(task);
  }
  type Edit={storeId:string;tool:'plan_attention_task';args:ReturnType<typeof planTaskSchema.parse>}|{storeId:string;tool:'order_attention_tasks';args:ReturnType<typeof orderTasksSchema.parse>};
  const editRecovery=useRecovery<Edit>({key:'sauron:edit-pending:v1',action:value=>value.tool==='plan_attention_task'?'task_plan':'task_order',view,client,run,
    parse:value=>{const saved=value as Edit;if(saved.tool==='plan_attention_task')return {...saved,args:planTaskSchema.parse(saved.args)};if(saved.tool==='order_attention_tasks')return {...saved,args:orderTasksSchema.parse(saved.args)};throw Error('invalid');},
    receipt:value=>({id:(value.tool==='plan_attention_task'?'plan:':'order:')+value.args.operationId,payload:value.tool==='plan_attention_task'?planTaskSchema.parse(value.args):orderTasksSchema.parse(value.args)}),
    store:value=>value.storeId,label:value=>value.tool==='plan_attention_task'?'the task plan':'the task order',execute:(client,value)=>client.call(value.tool,value.args),
    prepare:(value,latest)=>{
      if(value.tool==='plan_attention_task'){const task=latest.items.find(task=>task.id===value.args.id);return task?{...value,args:{...value.args,operationId:operationId(),expectedVersion:task.version}}:null;}
      const tasks=latest.items.filter(focusEligible),ids=new Set(tasks.map(task=>task.id));
      return {...value,args:{...value.args,operationId:operationId(),orderedIds:[...value.args.orderedIds.filter(id=>ids.has(id)),...tasks.filter(task=>!value.args.orderedIds.includes(task.id)).map(task=>task.id)],focusIds:value.args.focusIds.filter(id=>ids.has(id)),expectedVersions:tasks.map(task=>({id:task.id,version:task.version}))}};
    },
    summary:(value,latest)=>value.tool==='plan_attention_task'?`Latest task: ${latest.items.find(task=>task.id===value.args.id)?.title}. Intended changes: ${Object.entries(value.args).filter(([key])=>!['id','operationId','expectedVersion'].includes(key)).map(([key,value])=>key+': '+String(value??'clear')).join('; ')}.`:`Intended task order: ${value.args.orderedIds.map(id=>latest.items.find(task=>task.id===id)?.title).join(', ')}. Focus tasks: ${value.args.focusIds.map(id=>latest.items.find(task=>task.id===id)?.title).join(', ')||'none'}.`,
    onSaved:(_saved,value)=>{setNotice(value.tool==='plan_attention_task'?'Task plan saved.':'Order saved.');if(value.tool==='plan_attention_task'&&value.args.workflowState)setFilter(value.args.workflowState==='waiting'?'waiting':value.args.workflowState==='inbox'?'inbox':'today');}});
  async function plan(task:Task,patch:Record<string,unknown>){
    if(!view||!client||gate.current||actionLocked)return;
    const saved=await editRecovery.submit({storeId:view.storeId,tool:'plan_attention_task',args:planTaskSchema.parse({id:task.id,expectedVersion:task.version,operationId:operationId(),...patch})});
    return saved?.items.find(item=>item.id===task.id);
  }
  function order(orderedIds:string[],focusIds:string[]){
    if(!client||!view||gate.current||actionLocked)return;
    void editRecovery.submit({storeId:view.storeId,tool:'order_attention_tasks',args:{operationId:operationId(),expectedStoreId:view.storeId,orderedIds,focusIds,expectedVersions:view.items.filter(focusEligible).map(task=>({id:task.id,version:task.version}))}});
  }
  function seed(){
    if(!client)return;
    void run(()=>client.call('upsert_attention_items',{batchId:'synthetic-proof-v1',
      items:[{...syntheticObservation(),lastCheckedAt:'2026-10-14T10:00:00.000Z'}]}),()=>setNotice('Synthetic task recorded.'));
  }
  function replay(){
    if(!client)return;
    const old=view?.items.find(t=>t.id==='synthetic:review-proof');
    const version=(old?.sourceVersion??1)+1;
    void run(()=>client.call('upsert_attention_items',{batchId:operationId(),items:[syntheticObservation(version)]}),
      ()=>setNotice('Incoming observation replayed. User decisions preserved.'));
  }
  const allTasks = view?.items ?? [];
  const count = (state: TaskState|'today') => allTasks.filter(task => state==='today'?(task.state==='ready'||task.state==='in_progress'):task.state === state).length;
  const history = filter === 'done' || filter === 'dismissed';
  const stateItems = allTasks.filter(task => filter==='today'?(task.state==='ready'||task.state==='in_progress'):task.state===filter);
  const hasFilters = !!query.trim() || source !== 'all'||area!=='all'||organisation.topic!=='all'||organisation.attentionOnly;
  const matchedItems = stateItems.filter(task => (source === 'all' || sourceOf(task) === source)
    && (area==='all'||(task.area??(task.provider==='personal'?'personal':'unassigned'))===area)
    && (organisation.topic==='all'||task.topicIds?.includes(organisation.topic))
    && (!organisation.attentionOnly||task.ownNeedsAttention||!!task.descendantSummary?.attention)
    && `${task.title} ${task.nextAction}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a,b)=>filter==='today'?(a.focusOrder??99)-(b.focusOrder??99)||
      (a.state==='in_progress'?0:1)-(b.state==='in_progress'?0:1)||(a.order??999999)-(b.order??999999)||a.id.localeCompare(b.id):
      (a.order??999999)-(b.order??999999)||a.id.localeCompare(b.id));
  const rows=visibleTaskRows(allTasks,new Set(matchedItems.map(task=>task.id)),organisation.expanded,organisation.showClosed,hasFilters||history);
  const items=rows.map(row=>row.task);
  const matchedCount=matchedItems.length;
  const showTools = !!view && (stateItems.length > 0 || hasFilters);
  const reopenTask = allTasks.find(task => task.id === reopenId && task.userDecision !== null
    && (task.state === 'done' || task.state === 'dismissed' || task.state === 'snoozed'));
  function selectTaskWorkflow(task:Task){
    const workflow=task.workflowState??(task.sourceState==='waiting'?'waiting':'ready');
    selectState(workflow==='waiting'?'waiting':workflow==='inbox'?'inbox':'today');
  }
  function selectState(state: Filter) {
    if(!history&&(state==='done'||state==='dismissed'))currentView.current={filter,source,area,query};
    setFilter(state);setSource('all');setArea('all');setQuery('');organisation.setTopic('all');organisation.setAttentionOnly(false);
  }
  function returnToTasks(){
    setFilter(currentView.current.filter);setSource(currentView.current.source);setArea(currentView.current.area);setQuery(currentView.current.query);
  }
  const emptyTitles: Record<Filter, string> = {
    today: allTasks.length ? 'Nothing ready right now' : 'Start with one task',inbox:'Inbox is clear',
    waiting: 'Nothing you’re waiting on', done: 'No completed tasks yet',snoozed: 'Nothing snoozed', dismissed: 'No dismissed tasks',
  };
  const emptyDescriptions: Record<Filter, string> = {
    today: allTasks.length ? 'Review your Inbox or add a task.' : 'Refresh to check sources, or add a personal task.',
    inbox:'New source obligations and chat follow-ups will appear here for review.',
    waiting: 'Tasks you’re waiting on will appear here. Set a review date to know when to check again.',
    done: 'Tasks you complete will appear here.',
    snoozed: 'Snoozed tasks return at the time you chose.',
    dismissed: 'Tasks you dismiss will appear here.',
  };
  function dismissNotice(){setNotice('');setReopenId(null);}
  const cancelPending=taskRecovery.dismiss;
  const actionLocked=busy||[taskRecovery,editRecovery,sourceRecovery,organisation.recovery,review.recovery].some(recovery=>!!recovery.pending||recovery.malformed);
  return {actionLocked,editRecovery,taskRecovery,sourceRecovery,review,organisation,rows,matchedCount,addChild,branchDecision,setBranchDecision,sourceMenuOpen,setSourceMenuOpen,sourceSaving,saveSource,view,client,filter,source,area,weeklyReview,busy,error,query,pending,recovering,adding,draft,dismiss,notice,reopenTask,diagnostics,theme,scanning,history,hasFilters,items,showTools,count,emptyTitles,emptyDescriptions,setSource,setArea,setWeeklyReview,setQuery,setAdding,setDismiss,setDiagnostics,setTheme,setError:(message:string)=>{setError(message);if(!message)setConnectionError('');},setConnectionAttempt,readSaved,refresh,selectState,returnToTasks,save,decide,plan,order,seed,replay,c,changeDraft,cancelDraft,cancelPending,dismissNotice,apply};
}
export type SauronController=ReturnType<typeof useSauronController>;
