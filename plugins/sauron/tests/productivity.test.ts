import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SauronStore} from '../src/server/store.js';
import {syntheticObservation,canonicalSourceUrl} from '../src/shared/contracts.js';

function fixture(t:import('node:test').TestContext){
  const dir=mkdtempSync(join(tmpdir(),'sauron-productivity-')),path=join(dir,'state.sqlite');
  let store=new SauronStore(path,()=>new Date('2026-11-02T10:00:00Z'),'Europe/Berlin');
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  return {get store(){return store;},path,restart(){store.close();store=new SauronStore(path,()=>new Date('2026-11-02T10:00:00Z'),'Europe/Berlin');return store;}};
}
test('schema 3 tasks map to Ready and Waiting without rewriting source records or decisions',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-legacy-plan-')),path=join(dir,'state.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const db=new DatabaseSync(path);
  db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL); CREATE TABLE history (seq INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, operation_id TEXT, at TEXT); CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=3;');
  const make=(id:string,sourceState:'needs_you'|'waiting',decision:null|'complete')=>({id,obligationKey:id,sourceVersion:1,provider:'manual',title:id,nextAction:'Original source action',sourceState,sourceUrl:'https://example.invalid/'+id,lastCheckedAt:'2026-10-01T10:00:00Z',version:1,userDecision:decision,decidedAt:decision?'2026-10-02T10:00:00Z':null,snoozedUntil:null,updatedAt:'2026-10-01T10:00:00Z',state:sourceState});
  for(const task of [make('synthetic:ready','needs_you',null),make('synthetic:waiting','waiting',null),make('synthetic:done','needs_you','complete')])db.prepare('INSERT INTO tasks VALUES (?,?)').run(task.id,JSON.stringify(task));
  const before=db.prepare('SELECT id,data FROM tasks ORDER BY id').all();db.close();
  const store=new SauronStore(path);const states=Object.fromEntries(store.view().items.map(task=>[task.id,task.state]));
  assert.deepEqual(states,{'synthetic:ready':'ready','synthetic:waiting':'waiting','synthetic:done':'done'});
  store.close();const after=new DatabaseSync(path);
  assert.deepEqual(after.prepare('SELECT id,data FROM tasks ORDER BY id').all(),before);
  assert.equal(after.prepare('PRAGMA user_version').get()?.user_version,3);
  after.close();
});
test('new source work waits in Inbox and accepted planning survives later source observations',t=>{
  const f=fixture(t),store=f.store,source={...syntheticObservation(),lastCheckedAt:'2026-11-02T09:00:00Z'};
  const first=store.upsert({batchId:'first',items:[source]}).items[0];
  assert.equal(first.state,'inbox');
  const accepted=store.planTask({operationId:randomUUID(),id:first.id,expectedVersion:first.version,workflowState:'ready',area:'blex',title:'Review learner impact',nextAction:'Ask Ayhan about the impact',dueDate:'2026-11-05',reviewDate:'2026-11-04'}).items[0];
  assert.equal(accepted.state,'ready');assert.equal(accepted.area,'blex');
  store.upsert({batchId:'newer',items:[{...syntheticObservation(2),lastCheckedAt:'2026-11-02T09:30:00Z'}]});
  const refreshed=f.restart().view().items[0];
  assert.equal(refreshed.title,'Review learner impact');assert.equal(refreshed.sourceTitle,'Review the synthetic launch note');
  assert.equal(refreshed.nextAction,'Ask Ayhan about the impact');assert.equal(refreshed.dueDate,'2026-11-05');
  assert.equal(refreshed.reviewDate,'2026-11-04');assert.equal(refreshed.state,'ready');
  assert.throws(()=>f.store.planTask({operationId:randomUUID(),id:refreshed.id,expectedVersion:accepted.version,area:'pex'}),/another view/);
  assert.throws(()=>f.store.planTask({operationId:randomUUID(),id:refreshed.id,expectedVersion:refreshed.version,dueDate:'2026-02-30'}),/valid calendar date/);
});
test('one Codex chat proposes distinct linked follow-ups and duplicate capture preserves review decisions',t=>{
  const f=fixture(t),store=f.store,threadId=randomUUID(),input={expectedStoreId:store.storeId,threadId,proposals:[
    {actionKey:'review the fix',title:'Review the fix'},{actionKey:'ask Ayhan',title:'Ask Ayhan'},
  ]};
  const first=store.proposeCodexFollowups(input);
  assert.deepEqual(first.proposedFollowups?.map(item=>item.status),['created','created']);
  assert.equal(first.items.filter(item=>item.state==='inbox').length,2);
  assert.equal(first.discussions?.filter(link=>link.url===`codex://threads/${threadId}`).length,2);
  const task=first.items.find(item=>item.title==='Ask Ayhan')!;
  store.planTask({operationId:randomUUID(),id:task.id,expectedVersion:task.version,workflowState:'ready'});
  const retry=f.restart().proposeCodexFollowups(input);
  assert.deepEqual(retry.proposedFollowups?.map(item=>item.status),['already_proposed','already_proposed']);
  assert.equal(retry.items.find(item=>item.id===task.id)?.state,'ready');
  assert.throws(()=>f.store.proposeCodexFollowups({...input,proposals:[input.proposals[0],input.proposals[0]]}),/distinct action key/);
});
test('Top 3 and ordering remain user-owned and reject stale changes',t=>{
  const f=fixture(t),store=f.store;
  for(const title of ['Review BLEX','Check PEX','Write feedback','Plan week'])store.createPersonal({operationId:randomUUID(),title});
  const tasks=store.view().items,orderedIds=tasks.map(task=>task.id),expectedVersions=tasks.map(task=>({id:task.id,version:task.version}));
  const saved=store.orderTasks({operationId:randomUUID(),expectedStoreId:store.storeId,orderedIds,focusIds:orderedIds.slice(0,3),expectedVersions});
  assert.deepEqual(saved.items.filter(task=>task.focusOrder).map(task=>task.focusOrder).sort(),[1,2,3]);
  assert.throws(()=>store.orderTasks({operationId:randomUUID(),expectedStoreId:store.storeId,orderedIds,focusIds:orderedIds,expectedVersions}),/too_big|Too big|at most|3/);
  assert.throws(()=>store.orderTasks({operationId:randomUUID(),expectedStoreId:store.storeId,orderedIds,focusIds:[],expectedVersions}),/another view/);
  assert.deepEqual(f.restart().view().items.filter(task=>task.focusOrder).length,3);
});
test('priority hints use real due and review dates without changing focus',t=>{
  const f=fixture(t),store=f.store;
  const first=store.createPersonal({operationId:randomUUID(),title:'Send the BLEX update'}).items[0];
  const due=store.planTask({operationId:randomUUID(),id:first.id,expectedVersion:first.version,dueDate:'2026-11-02'}).items[0];
  assert.equal(due.priorityReason,'Due today');assert.equal(due.suggestedFocus,true);assert.equal(due.focusOrder,null);
  const other=store.createPersonal({operationId:randomUUID(),title:'Wait for Vedang',sourceState:'waiting'}).items.find(item=>item.title==='Wait for Vedang')!;
  const waiting=store.planTask({operationId:randomUUID(),id:other.id,expectedVersion:other.version,reviewDate:'2026-11-01'}).items.find(item=>item.id===other.id)!;
  assert.equal(waiting.priorityReason,'Review waiting item');assert.equal(waiting.suggestedFocus,false);
});
test('planning dates use Berlin midnight while sync keeps its configured time zone',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-berlin-plan-')),path=join(dir,'state.sqlite');
  const store=new SauronStore(path,()=>new Date('2026-11-01T23:30:00Z'),'America/Los_Angeles');
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const today=store.createPersonal({operationId:randomUUID(),title:'Due in Berlin'}).items[0];
  const due=store.planTask({operationId:randomUUID(),id:today.id,expectedVersion:today.version,dueDate:'2026-11-02'}).items[0];
  assert.equal(due.priorityReason,'Due today');assert.equal(due.suggestedFocus,true);
  const yesterday=store.createPersonal({operationId:randomUUID(),title:'Past due in Berlin'}).items.find(task=>task.title==='Past due in Berlin')!;
  const overdue=store.planTask({operationId:randomUUID(),id:yesterday.id,expectedVersion:yesterday.version,dueDate:'2026-11-01'}).items.find(task=>task.id===yesterday.id)!;
  assert.equal(overdue.priorityReason,'Past due');
  const item=store.createPersonal({operationId:randomUUID(),title:'Waiting review',sourceState:'waiting'}).items.find(task=>task.title==='Waiting review')!;
  const waiting=store.planTask({operationId:randomUUID(),id:item.id,expectedVersion:item.version,reviewDate:'2026-11-02'}).items.find(task=>task.id===item.id)!;
  assert.equal(waiting.priorityReason,'Review waiting item');
  assert.equal(store.coordination().freshness.timeZone,'America/Los_Angeles');
});

test('leaving Today clears focus without losing task order or restoring focus on return',t=>{
  const f=fixture(t),store=f.store;
  for(const title of ['First','Second','Third','Fourth'])store.createPersonal({operationId:randomUUID(),title});
  const original=store.view().items,ids=original.map(task=>task.id);
  store.orderTasks({operationId:randomUUID(),expectedStoreId:store.storeId,orderedIds:ids,focusIds:ids.slice(0,3),expectedVersions:original.map(task=>({id:task.id,version:task.version}))});
  const first=store.view().items.find(task=>task.id===ids[0])!;
  const waiting=store.planTask({operationId:randomUUID(),id:first.id,expectedVersion:first.version,workflowState:'waiting'}).items.find(task=>task.id===first.id)!;
  assert.equal(waiting.focusOrder,null);assert.equal(waiting.order,first.order);
  const available=store.view().items.filter(task=>task.state==='ready');
  store.orderTasks({operationId:randomUUID(),expectedStoreId:store.storeId,orderedIds:available.map(task=>task.id),focusIds:available.map(task=>task.id),expectedVersions:available.map(task=>({id:task.id,version:task.version}))});
  const returned=store.planTask({operationId:randomUUID(),id:waiting.id,expectedVersion:waiting.version,workflowState:'ready'}).items.find(task=>task.id===waiting.id)!;
  assert.equal(returned.focusOrder,null);assert.equal(returned.order,first.order);
  assert.equal(store.view().items.filter(task=>task.focusOrder).length,3);
  const second=store.view().items.find(task=>task.id===ids[1])!;
  const inbox=store.planTask({operationId:randomUUID(),id:second.id,expectedVersion:second.version,workflowState:'inbox'}).items.find(task=>task.id===second.id)!;
  assert.equal(inbox.focusOrder,null);assert.equal(inbox.order,second.order);
  const reaccepted=store.planTask({operationId:randomUUID(),id:inbox.id,expectedVersion:inbox.version,workflowState:'ready'}).items.find(task=>task.id===inbox.id)!;
  assert.equal(reaccepted.focusOrder,null);assert.equal(reaccepted.order,second.order);
  assert.equal(f.restart().view().items.filter(task=>task.focusOrder).length,2);
});

test('completion dismissal and snooze release focus without restoring it on reopen',t=>{
  const f=fixture(t),store=f.store;
  for(const action of ['complete','dismiss','snooze'] as const){
    const created=store.createPersonal({operationId:randomUUID(),title:action}).items.find(task=>task.title===action)!;
    const available=store.view().items.filter(task=>task.state==='ready');
    store.orderTasks({operationId:randomUUID(),expectedStoreId:store.storeId,orderedIds:available.map(task=>task.id),focusIds:[created.id],expectedVersions:available.map(task=>({id:task.id,version:task.version}))});
    const focused=store.view().items.find(task=>task.id===created.id)!;
    const decided=store.decide({operationId:randomUUID(),id:created.id,expectedVersion:focused.version,action,...(action==='snooze'?{snoozedUntil:'2026-11-03T10:00:00Z'}:{})}).items.find(task=>task.id===created.id)!;
    assert.equal(decided.focusOrder,null);assert.equal(decided.order,focused.order);
    const reopened=store.decide({operationId:randomUUID(),id:created.id,expectedVersion:decided.version,action:'reopen'}).items.find(task=>task.id===created.id)!;
    assert.equal(reopened.focusOrder,null);
  }
});

test('source resolution and reopening old saved data cannot retain inactive focus',t=>{
  const f=fixture(t),store=f.store,url='https://github.com/preply/apollo/issues/1',actionKey='Review issue';
  const obligationKey='github:'+createHash('sha256').update(JSON.stringify([canonicalSourceUrl('github',url),actionKey])).digest('hex');
  const source={provider:'github' as const,obligationKey,sourceUrl:url,actionKey,title:'Review issue',nextAction:'Review issue',sourceState:'needs_you' as const,
    resolved:false,provenance:{reader:'local_agent' as const,evidence:'Test observation'},sourceVersion:1,lastCheckedAt:'2026-11-02T09:00:00Z'};
  const inbox=store.upsert({batchId:'source-first',items:[source]}).items.find(task=>task.id===obligationKey)!;
  const ready=store.planTask({operationId:randomUUID(),id:inbox.id,expectedVersion:inbox.version,workflowState:'ready'}).items.find(task=>task.id===obligationKey)!;
  store.orderTasks({operationId:randomUUID(),expectedStoreId:store.storeId,orderedIds:[ready.id],focusIds:[ready.id],expectedVersions:[{id:ready.id,version:ready.version}]});
  const resolved=store.upsert({batchId:'source-resolved',items:[{...source,resolved:true,sourceVersion:2,lastCheckedAt:'2026-11-02T09:30:00Z'}]}).items.find(task=>task.id===obligationKey)!;
  assert.equal(resolved.state,'done');assert.equal(resolved.focusOrder,null);
  const reopenedSource=store.upsert({batchId:'source-reopened',items:[{...source,sourceVersion:3,lastCheckedAt:'2026-11-02T09:45:00Z'}]}).items.find(task=>task.id===obligationKey)!;
  assert.equal(reopenedSource.state,'ready');assert.equal(reopenedSource.focusOrder,null);
  const waiting=store.createPersonal({operationId:randomUUID(),title:'Old waiting task',sourceState:'waiting'}).items.find(task=>task.title==='Old waiting task')!;
  const db=new DatabaseSync(f.path);
  const key='task-plan:'+waiting.id,plan=JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get(key)!.value as string);
  db.prepare('UPDATE metadata SET value=? WHERE key=?').run(JSON.stringify({...plan,focusOrder:1}),key);
  const taskBytes=db.prepare('SELECT data FROM tasks WHERE id=?').get(waiting.id)!.data;db.close();
  const normalized=f.restart().view().items.find(task=>task.id===waiting.id)!;
  assert.equal(normalized.focusOrder,null);assert.equal(normalized.order,waiting.order);
  const reopenedDb=new DatabaseSync(f.path);
  assert.equal(reopenedDb.prepare('SELECT data FROM tasks WHERE id=?').get(waiting.id)!.data,taskBytes);reopenedDb.close();
});

test('chat tracking ignores proposal links but keeps manually linked task reuse',t=>{
  const f=fixture(t),store=f.store,first=randomUUID(),second=randomUUID(),third=randomUUID();
  store.proposeCodexFollowups({expectedStoreId:store.storeId,threadId:first,proposals:[{actionKey:'one',title:'First follow-up'},{actionKey:'two',title:'Second follow-up'}]});
  const created=store.trackCodexThreads({expectedStoreId:store.storeId,threads:[{threadId:first,title:'Tracked chat'}]});
  assert.equal(created.trackedThreads?.[0]?.status,'created');
  assert.equal(created.trackedThreads?.[0]?.taskId,`personal:${first}`);
  assert.equal(created.discussions?.filter(link=>link.url===`codex://threads/${first}`).length,3);
  store.proposeCodexFollowups({expectedStoreId:store.storeId,threadId:second,proposals:[{actionKey:'one',title:'Another follow-up'}]});
  const manual=store.createPersonal({operationId:randomUUID(),title:'Existing task'}).items.find(task=>task.title==='Existing task')!;
  store.saveDiscussion({expectedStoreId:store.storeId,taskId:manual.id,url:`codex://threads/${second}`});
  const reused=store.trackCodexThreads({expectedStoreId:store.storeId,threads:[{threadId:second,title:'Second chat'}]});
  assert.equal(reused.trackedThreads?.[0]?.status,'already_tracked');assert.equal(reused.trackedThreads?.[0]?.taskId,manual.id);
  store.trackCodexThreads({expectedStoreId:store.storeId,threads:[{threadId:third,title:'Third chat'}]});
  store.proposeCodexFollowups({expectedStoreId:store.storeId,threadId:third,proposals:[{actionKey:'later',title:'Later follow-up'}]});
  const reopened=f.restart();
  assert.deepEqual(reopened.trackCodexThreads({expectedStoreId:reopened.storeId,threads:[{threadId:first,title:'Tracked chat'},{threadId:second,title:'Second chat'},{threadId:third,title:'Third chat'}]}).trackedThreads?.map(item=>item.status),['already_tracked','already_tracked','already_tracked']);
  const another=reopened.createPersonal({operationId:randomUUID(),title:'Another linked task'}).items.find(task=>task.title==='Another linked task')!;
  reopened.saveDiscussion({expectedStoreId:reopened.storeId,taskId:another.id,url:`codex://threads/${second}`});
  assert.equal(reopened.trackCodexThreads({expectedStoreId:reopened.storeId,threads:[{threadId:second,title:'Second chat'}]}).trackedThreads?.[0]?.status,'failed');
});
