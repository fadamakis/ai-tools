import { useEffect, useRef, useState } from 'react';
import { connect, type Client } from './client.js';
import { syntheticObservation, type SourceKind, type Task, type TaskState, type Result, type DecisionInput, type PersonalTaskInput } from '../shared/contracts.js';
import { sourceOf } from './icons.js';
import { operationId } from './operation.js';
import { mergeSavedView } from './presentation.js';
type Pending={kind:'decision';input:DecisionInput}|{kind:'create';input:PersonalTaskInput};
const pendingKey='attention:pending:v2';
const draftKey='sauron:draft:v1';
const storage={
  read:(key:string)=>{try{return JSON.parse(sessionStorage.getItem(key)??'null');}catch{return null;}},
  write:(key:string,value:unknown)=>{try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));}catch{/* The store remains authoritative if browser storage is unavailable. */}},
};
const remember=(pending:Pending|null)=>{storage.write(pendingKey,pending);storage.write('attention:pending:v1',null);};
const readPending=():Pending|null=>storage.read(pendingKey)??(storage.read('attention:pending:v1')?{kind:'decision',input:storage.read('attention:pending:v1')}:null);
export type Draft={title:string;nextAction:string;sourceState:'needs_you'|'waiting'};
const emptyDraft:Draft={title:'',nextAction:'',sourceState:'needs_you'};

export function useSauronController(){
  const [view,setView]=useState<Result|null>(null);
  const [client,setClient]=useState<Client|null>(null);
  const [filter,setFilter]=useState<TaskState>('needs_you');
  const [source,setSource]=useState<SourceKind|'all'>('all');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [pending,setPending]=useState<Pending|null>(readPending);
  const [adding,setAdding]=useState(()=>!!storage.read(draftKey)&&!readPending());
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
  async function run(work:()=>Promise<Result>, success?:()=>void){
    if(gate.current)return;
    gate.current=true;setBusy(true);setError('');
    try{apply(await work());success?.();}
    catch(e){setError(e instanceof Error?e.message:'Request failed. Refresh to check saved state.');}
    finally{gate.current=false;setBusy(false);}
  }
  const readSaved=()=>{if(c.current)void run(()=>c.current!.call('list_attention'));};
  const refresh=()=>{if(c.current)void run(()=>c.current!.call('refresh_attention'));};
  useEffect(()=>{
    let active=true;
    let lastActiveAt=Date.now();
    const localTrigger=(next:Result)=>{if(active&&next.coordination?.mode==='local_managed'&&c.current)void c.current.call('check_local_attention',{expectedStoreId:next.storeId,reason:'reconnect'}).then(saved=>{if(active)apply(saved);}).catch(()=>{});};
    setError('');
    connect(next=>{if(active)apply(next);}).then(next=>{
      if(!active)return;
      c.current=next;setClient(next);
      void run(async()=>{const saved=await next.call('list_attention');localTrigger(saved);return saved;});
    }).catch(e=>{if(active)setError(String(e));});
    const onFocus=()=>{
      const resumed=Date.now()-lastActiveAt>90_000;lastActiveAt=Date.now();
      // A focus read must not move or disable the control the user is clicking.
      if(active&&c.current)void c.current.call('list_attention')
        .then(next=>{if(active){apply(next);if(resumed)localTrigger(next);}})
        .catch(e=>{if(active&&!gate.current)setError(String(e));});
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
      try{const next=await client.call('list_attention');if(active)apply(next);}
      catch{if(active)setError('The check is still running, but its status could not be loaded. Reopen Sauron to reconnect.');}
      finally{loading=false;}
    };
    const timer=window.setInterval(()=>void poll(),1500);
    return()=>{active=false;window.clearInterval(timer);};
  },[scanning,client]);
  useEffect(()=>{
    if(!pending||!view)return;
    const input=pending.input;
    const task=view.items.find(t=>t.id===(pending.kind==='create'?'personal:'+input.operationId:(input as DecisionInput).id));
    const confirmed=pending.kind==='create'?!!task:task?.userDecision===(pending.input.action==='reopen'?null:pending.input.action) && task.version>pending.input.expectedVersion &&
      (pending.input.action!=='snooze'||task.snoozedUntil===pending.input.snoozedUntil);
    if(confirmed){
      remember(null);setPending(null);setNotice(pending.kind==='create'?'Task saved.':'Saved decision confirmed.');
      if(pending.kind==='decision'){
        setReopenId(pending.input.action==='reopen'?null:task!.id);
        if(pending.input.action==='reopen'){setFilter(task!.sourceState);setSource('all');setQuery('');}
      }
      if(pending.kind==='create'){storage.write(draftKey,null);setDraft(emptyDraft);setAdding(false);setFilter(pending.input.sourceState);}
    }
  },[view,pending]);
  function save(operation:Pending){
    if(!client || gate.current)return;
    remember(operation);setPending(operation);
    void run(()=>client.call(operation.kind==='create'?'create_personal_task':'decide_attention_item',operation.input),()=>{
      remember(null);setPending(null);setNotice(operation.kind==='create'?'Task added.':operation.input.action==='complete'?'Task completed.':operation.input.action==='dismiss'?'Task dismissed.':operation.input.action==='reopen'?'Task reopened.':'Task snoozed for one hour.');
      setReopenId(operation.kind==='decision'&&operation.input.action!=='reopen'?operation.input.id:null);
      if(operation.kind==='decision'&&operation.input.action==='reopen'){
        const reopened=view?.items.find(task=>task.id===operation.input.id);
        if(reopened)selectState(reopened.sourceState);
      }
      if(operation.kind==='create'){storage.write(draftKey,null);setDraft(emptyDraft);setAdding(false);setFilter(operation.input.sourceState);setSource('all');setQuery('');}
    });
  }
  function decide(task:Task,action:DecisionInput['action']){
    save({kind:'decision',input:{id:task.id,action,expectedVersion:task.version,operationId:operationId(),
      ...(action==='snooze'?{snoozedUntil:new Date(Date.now()+3_600_000).toISOString()}:{}),}});
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
  const count = (state: TaskState) => allTasks.filter(task => task.state === state).length;
  const history = filter === 'done' || filter === 'dismissed';
  const stateItems = allTasks.filter(task => task.state === filter);
  const hasFilters = !!query.trim() || source !== 'all';
  const items = stateItems.filter(task => (source === 'all' || sourceOf(task) === source)
    && `${task.title} ${task.nextAction}`.toLowerCase().includes(query.trim().toLowerCase()));
  const showTools = !!view && (stateItems.length > 0 || hasFilters);
  const reopenTask = allTasks.find(task => task.id === reopenId && task.userDecision !== null
    && (task.state === 'done' || task.state === 'dismissed' || task.state === 'snoozed'));
  function selectState(state: TaskState) { setFilter(state); setSource('all'); setQuery(''); }
  const emptyTitles: Record<TaskState, string> = {
    needs_you: allTasks.length ? 'Nothing needs you right now' : 'Start with one task',
    waiting: 'Nothing you’re waiting on', done: 'No completed tasks yet',
    snoozed: 'Nothing snoozed', dismissed: 'No dismissed tasks',
  };
  const emptyDescriptions: Record<TaskState, string> = {
    needs_you: allTasks.length ? 'Your saved list has no tasks in Needs you.' : 'Refresh to check Slack and Granola, or add a personal task.',
    waiting: 'Tasks you’re waiting on will appear here.',
    done: 'Tasks you complete will appear here.',
    snoozed: 'Snoozed tasks return at the time you chose.',
    dismissed: 'Tasks you dismiss will appear here.',
  };
  function cancelPending(){remember(null);setPending(null);if(pending?.kind==='create')cancelDraft();}
  return {view,client,filter,source,busy,error,query,pending,adding,draft,dismiss,notice,reopenTask,diagnostics,theme,scanning,history,hasFilters,items,showTools,count,emptyTitles,emptyDescriptions,setSource,setQuery,setAdding,setDismiss,setDiagnostics,setTheme,setError,setPending,setConnectionAttempt,readSaved,refresh,selectState,save,decide,seed,replay,c,changeDraft,cancelDraft,cancelPending,apply};
}
export type SauronController=ReturnType<typeof useSauronController>;
