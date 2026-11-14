import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SauronStore} from '../src/server/store.js';
import {syntheticObservation,type Task} from '../src/shared/contracts.js';
import {taskTree,visibleTaskRows} from '../src/shared/task-tree.js';
import {invoke} from '../src/server/service.js';
import {mergeSavedView} from '../src/app/presentation.js';

function fixture(t:import('node:test').TestContext){
  const dir=mkdtempSync(join(tmpdir(),'sauron-groups-')),path=join(dir,'state.sqlite');
  let store=new SauronStore(path,()=>new Date('2026-11-14T09:00:00Z'));
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const add=(title:string)=>{const operationId=randomUUID();store.createPersonal({operationId,title});return 'personal:'+operationId;};
  const organise=(request:Record<string,unknown>)=>invoke(store,'organise_attention_task',{request:{operationId:randomUUID(),expectedStoreId:store.storeId,expectedRevision:store.view().taskViewRevision,...request}});
  const get=(id:string)=>store.view().items.find(task=>task.id===id)!;
  const decide=(id:string,action:'complete'|'dismiss'|'reopen',branch=false)=>store.decide({id,action,operationId:randomUUID(),expectedVersion:get(id).version,...(branch?{branch,expectedStoreId:store.storeId,expectedRevision:store.view().taskViewRevision}:{})});
  return {get store(){return store;},path,add,organise,get,decide,restart(){store.close();store=new SauronStore(path,()=>new Date('2026-11-14T09:00:00Z'));}};
}
test('H-01 H-02 H-03: deep moves retain chats, reject cycles and stale revisions atomically',t=>{
  const f=fixture(t),root=f.add('Root'),child=f.add('Child'),leaf=f.add('Leaf');
  f.store.saveDiscussion({expectedStoreId:f.store.storeId,taskId:child,url:'codex://threads/'+randomUUID()});
  const links=f.store.view().discussions;
  f.organise({action:'move',id:child,parentId:root});f.organise({action:'move',id:leaf,parentId:child});
  assert.equal(taskTree(f.store.view().items).ancestors(leaf).length,2);
  assert.throws(()=>f.organise({action:'move',id:root,parentId:leaf}),/own branch/);
  assert.throws(()=>f.store.organiseTask({action:'move',id:leaf,parentId:root,operationId:randomUUID(),expectedStoreId:f.store.storeId,expectedRevision:0}),/changed/);
  assert.deepEqual(f.store.view().discussions,links);f.restart();assert.equal(f.get(leaf).parentId,child);
});
test('F-01 F-03: nested tasks lose only their own focus slot; legacy ordering cannot restore it',t=>{
  const f=fixture(t),root=f.add('Root'),child=f.add('Child');let view=f.store.view();
  f.store.orderTasks({operationId:randomUUID(),expectedStoreId:view.storeId,orderedIds:[root,child],focusIds:[root,child],expectedVersions:view.items.map(task=>({id:task.id,version:task.version}))});
  f.organise({action:'move',id:child,parentId:root});assert.equal(f.get(root).focusOrder,1);assert.equal(f.get(child).focusOrder,null);
  view=f.store.view();assert.throws(()=>f.store.orderTasks({operationId:randomUUID(),expectedStoreId:view.storeId,orderedIds:[root,child],focusIds:[child],expectedVersions:view.items.map(task=>({id:task.id,version:task.version}))}),/changed/);
});
test('H-04 H-05: closure requires a current branch decision through the existing MCP tool',t=>{
  const f=fixture(t),root=f.add('Root'),child=f.add('Child');f.organise({action:'move',id:child,parentId:root});
  assert.throws(()=>f.decide(root,'complete'),/Confirm this branch/);assert.equal(f.get(root).state,'ready');
  f.decide(child,'complete');assert.equal(f.get(root).state,'ready');f.decide(child,'reopen');f.decide(root,'complete',true);
  assert.equal(f.get(root).state,'done');assert.equal(f.get(child).state,'done');
  assert.throws(()=>f.decide(child,'reopen'),/Confirm this branch/);f.decide(child,'reopen',true);assert.equal(f.get(root).state,'ready');
});
test('A-02 A-03 A-04: reading changes nothing; handling parent leaves descendant attention',t=>{
  const f=fixture(t),root=f.add('Root'),child=f.add('Child');f.organise({action:'move',id:child,parentId:root});
  const before=f.store.view();assert.deepEqual(f.store.view(),before);
  f.organise({action:'attention',id:root,needsAttention:false});assert.equal(f.get(root).ownNeedsAttention,false);assert.equal(f.get(root).descendantSummary?.attention,1);
  assert.equal(f.get(root).descendantSummary?.open,1);f.restart();assert.equal(f.get(root).ownNeedsAttention,false);
});
test('A-02 H-06: substantive new evidence restores attention and suggests reopening without changing closure',t=>{
  const f=fixture(t),sample={...syntheticObservation(),lastCheckedAt:'2026-11-14T08:00:00Z'};f.store.upsert({batchId:'first',items:[sample]});
  f.organise({action:'attention',id:sample.obligationKey,needsAttention:false});
  f.store.upsert({batchId:'poll',items:[{...sample,sourceVersion:2,lastCheckedAt:'2026-11-14T08:01:00Z'}]});assert.equal(f.get(sample.obligationKey).ownNeedsAttention,false);
  f.store.upsert({batchId:'new',items:[{...sample,sourceVersion:3,nextAction:'Read the changed evidence.'}]});assert.equal(f.get(sample.obligationKey).ownNeedsAttention,true);
  f.decide(sample.obligationKey,'complete');f.store.upsert({batchId:'closed-new',items:[{...sample,sourceVersion:4,nextAction:'A new request.'}]});
  assert.equal(f.get(sample.obligationKey).state,'done');assert.deepEqual(f.get(sample.obligationKey).reopenSuggestion,[sample.obligationKey]);
});
test('T-01 T-02 T-03: direct topics survive moves while inheritance follows new ancestors',t=>{
  const f=fixture(t),a=f.add('A'),b=f.add('B'),child=f.add('Child');
  f.organise({action:'topics',id:a,topics:['Routines']});f.organise({action:'topics',id:b,topics:['Reporting']});
  f.organise({action:'move',id:child,parentId:a});f.organise({action:'topics',id:child,topics:['Shared']});
  const original=f.get(child).topicIds!;assert.equal(original.length,2);
  f.organise({action:'move',id:child,parentId:b});assert.equal(f.get(child).topicIds?.length,2);assert.ok(!f.get(child).topicIds?.includes(f.get(a).directTopicIds![0]));
  f.organise({action:'topics',id:a,topics:['routines']});assert.equal(f.store.view().topics?.length,3);
});
test('N-01 N-02: roots collapse, attention sorts first, closed children are opt-in, filters retain context',t=>{
  const f=fixture(t),root=f.add('Root'),a=f.add('A'),b=f.add('B'),c=f.add('C');
  for(const id of [a,b,c])f.organise({action:'move',id,parentId:root});f.organise({action:'attention',id:a,needsAttention:false});f.decide(c,'complete');
  const tasks=f.store.view().items,matches=new Set(tasks.filter(task=>task.state==='ready').map(task=>task.id));
  assert.equal(visibleTaskRows(tasks,matches,new Set(),new Set()).length,1);
  const rows=visibleTaskRows(tasks,matches,new Set([root]),new Set());assert.equal(rows[1].task.id,b);assert.equal(rows.length,3);
  assert.equal(visibleTaskRows(tasks,matches,new Set([root]),new Set([root])).length,4);
  const filtered=visibleTaskRows(tasks,new Set([b]),new Set(),new Set(),true);assert.deepEqual(filtered.map(row=>[row.task.id,row.context]),[[root,true],[b,false]]);
});
test('I-05: schema migration preserves task bytes, discussions and store identity; old readers reject schema 4',t=>{
  const f=fixture(t),id=f.add('Saved'),storeId=f.store.storeId;const db=new DatabaseSync(f.path);const before=db.prepare('SELECT data FROM tasks').get()!.data;db.exec('PRAGMA user_version=3');db.close();f.restart();
  assert.equal(f.store.storeId,storeId);assert.equal(f.get(id).parentId,null);const check=new DatabaseSync(f.path);assert.equal(check.prepare('SELECT data FROM tasks').get()!.data,before);assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,4);check.close();
});
test('I-05: task-view revisions prevent delayed views restoring old structure',t=>{
  const f=fixture(t),a=f.add('A'),b=f.add('B'),before=f.store.view();f.organise({action:'move',id:b,parentId:a});const after=f.store.view();
  assert.equal(mergeSavedView(after,before).items.find(task=>task.id===b)?.parentId,a);
});
