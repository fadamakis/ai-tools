import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SauronStore} from '../src/server/store.js';
import {liveProviders,validSourceUrl,canonicalSourceUrl,upsertSchema, type LiveProvider} from '../src/shared/contracts.js';
const instant='2026-10-19T12:00:00.000Z';
const urls={slack:'https://example.slack.com/archives/C123/p1792313076000000',granola:'https://notes.granola.ai/d/12345678-1234-1234-1234-123456789012',
  jira:'https://example.atlassian.net/browse/TEST-123',github:'https://github.com/example/project/pull/123',calendar:'https://calendar.google.com/calendar/u/0/event?eid=YWJjMTIz&ctz=Europe%2FMadrid'};
const checked={status:'checked',detail:'Read synthetic fixture only'};
const sources=()=>Object.fromEntries(liveProviders.map(provider=>[provider,checked]));
const item=(provider:LiveProvider)=>({provider,sourceUrl:urls[provider],actionKey:'Original stable obligation quote',title:'Synthetic '+provider+' action',nextAction:'Review the synthetic fixture.',sourceState:'needs_you',resolved:false,provenance:{reader:'dot',evidence:'Synthetic source evidence; no real source read.'}});
function setup(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'sauron-dot-'));let now=new Date(instant);const path=join(dir,'test.sqlite');const store=new SauronStore(path,()=>now);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return{store,path,setTime:(value:string)=>{now=new Date(value);}};}
function start(store:SauronStore,runId=randomUUID()){store.syncAttention({request:{phase:'start',runId,expectedStoreId:store.storeId}});return runId;}
function finish(store:SauronStore,runId:string,items:unknown[]=liveProviders.map(item),coverage=sources(),checkedAt=instant){return store.syncAttention({request:{phase:'finish',runId,expectedStoreId:store.storeId,checkedAt,sources:coverage,items}});}

test('all five real provider contracts retain evidence, stable identity, and decisions across syncs/restart',t=>{
 const {store,path}=setup(t);const id=start(store);const first=finish(store,id);
 assert.equal(first.sync?.status,'completed');assert.equal(first.sync?.lastSuccessAt,instant);assert.equal(first.items.length,5);
 assert.equal(finish(store,id).receipt?.duplicate,true);
 for(const [index,task] of first.items.entries()){
   const action=(['complete','dismiss','snooze'] as const)[index%3];
   store.decide({id:task.id,expectedVersion:task.version,operationId:randomUUID(),action,...(action==='snooze'?{snoozedUntil:'2026-10-20T12:00:00Z'}:{})});
 }
 const next=finish(store,start(store),liveProviders.map(provider=>({...item(provider),title:'Updated synthetic '+provider})));
 assert.equal(next.items.length,5);assert.deepEqual(next.items.map(t=>t.state),['done','dismissed','snoozed','done','dismissed']);
 const second=new SauronStore(path,()=>new Date(instant));try{
  assert.equal(second.storeId,store.storeId);assert.deepEqual(second.view().items,next.items);assert.equal(second.view().sync?.lastSuccessAt,instant);
  for(const task of second.view().items){assert.ok('provenance' in task&&task.provenance?.evidence);assert.ok(task.id.startsWith(task.provider+':'));}
 }finally{second.close();}
});
test('wrong store, overlap, unverified sources, duplicate identities and malformed links reject atomically',t=>{
 const {store}=setup(t);
 assert.throws(()=>store.syncAttention({request:{phase:'start',runId:randomUUID(),expectedStoreId:randomUUID()}}),/Store ID/);assert.equal(store.view().sync,null);
 const id=start(store);assert.throws(()=>start(store),/already running/);
 assert.throws(()=>finish(store,id,[item('jira')],{...sources(),jira:{status:'failed',detail:'Disconnected'}}),/cannot produce/);
 assert.throws(()=>finish(store,id,[item('jira'),item('jira')]),/same obligation twice/);
 for(const provider of liveProviders){
  for(const sourceUrl of ['https://evil.test/x','https://user@'+new URL(urls[provider]).host+new URL(urls[provider]).pathname])assert.throws(()=>finish(store,id,[{...item(provider),sourceUrl}]));
  assert.throws(()=>finish(store,id,[{...item(provider),provenance:undefined}]));
 }
 assert.equal(store.view().items.length,0);assert.equal(store.view().sync?.status,'running');
 assert.equal(finish(store,id,[]).sync?.status,'completed');
});
test('partial, failed, and timed out attempts retain tasks and last full success; failed sources cannot resolve work',t=>{
 const {store,setTime}=setup(t);finish(store,start(store));
 setTime('2026-10-19T12:01:00Z');const partial=finish(store,start(store),[],{...sources(),calendar:{status:'skipped',detail:'No connection'}},'2026-10-19T12:01:00Z');
 assert.equal(partial.sync?.status,'partial');assert.equal(partial.sync?.lastSuccessAt,instant);assert.equal(partial.items.length,5);
 const failed=finish(store,start(store),[],Object.fromEntries(liveProviders.map(provider=>[provider,{status:'failed',detail:'Source unavailable'}])),'2026-10-19T12:01:00Z');
 assert.equal(failed.sync?.status,'failed');assert.equal(failed.sync?.lastSuccessAt,instant);
 const id=start(store);const fail={request:{phase:'fail',runId:id,expectedStoreId:store.storeId,error:'Caller lost source access'}};
 assert.equal(store.syncAttention(fail).sync?.error,'Caller lost source access');assert.equal(store.syncAttention(fail).receipt?.duplicate,true);
 const abandoned=start(store);setTime('2026-10-19T12:32:00Z');assert.equal(store.view().sync?.status,'failed');
 assert.throws(()=>finish(store,abandoned,[],sources(),'2026-10-19T12:32:00Z'),/no longer active/);assert.equal(store.view().items.length,5);
});
test('dot and manual scan share Slack identities; no source absence deletes or reopens work',t=>{
 const {store}=setup(t);const slack=item('slack');const {provenance:_,...scanItem}=slack;
 const scan=store.beginScan().run;store.finishScan(scan.id,{sources:{slack:checked,granola:checked},items:[scanItem]});
 const before=store.view().items[0];store.decide({id:before.id,expectedVersion:before.version,operationId:'done',action:'complete'});
 const view=finish(store,start(store),[{...slack,sourceUrl:slack.sourceUrl+'?thread_ts=123',title:'Different summary'}]);
 assert.equal(view.items.length,1);assert.equal(view.items[0].id,before.id);assert.equal(view.items[0].state,'done');
 finish(store,start(store),[]);assert.equal(store.view().items.length,1);
});
test('calendar event identity survives timezone/account query variations without merging different events',t=>{
 const {store}=setup(t);finish(store,start(store),[item('calendar')]);
 finish(store,start(store),[{...item('calendar'),sourceUrl:'https://www.google.com/calendar/event?eid=YWJjMTIz&ctz=UTC',title:'Same event'}]);
 assert.equal(store.view().items.length,1);
 finish(store,start(store),[{...item('calendar'),sourceUrl:'https://calendar.google.com/calendar/event?eid=ZGlmZmVyZW50'}]);
 assert.equal(store.view().items.length,2);
 assert.equal(validSourceUrl('calendar','https://calendar.google.com/calendar/event'),false);
});
test('explicit upserts require matching provider identity, provenance and kind',t=>{
 const {store}=setup(t);const observation=item('jira');const sourceUrl=canonicalSourceUrl('jira',observation.sourceUrl);
 const obligationKey='jira:'+createHash('sha256').update(JSON.stringify([sourceUrl,observation.actionKey])).digest('hex');
 const explicit={...observation,obligationKey,sourceVersion:1,lastCheckedAt:instant,sourceKind:'jira'};
 assert.throws(()=>store.upsert({batchId:'bad-key',items:[{...explicit,obligationKey:'jira:'+'0'.repeat(64)}]}),/key must match/);
 assert.throws(()=>store.upsert({batchId:'bad-kind',items:[{...explicit,sourceKind:'slack'}]}));
 assert.throws(()=>store.upsert({batchId:'missing-evidence',items:[{...explicit,provenance:undefined}]}));
 assert.equal(store.upsert({batchId:'valid',items:[explicit]}).items[0].provider,'jira');
});

test('an older overlapping manual scan cannot replace newer dot facts or decisions',t=>{
 const {store,setTime}=setup(t);const manual=store.beginScan().run;
 setTime('2026-10-19T12:01:00Z');const fresh=finish(store,start(store),[{...item('slack'),title:'Newer verified dot facts'}],sources(),'2026-10-19T12:01:00Z');
 const task=fresh.items[0];store.decide({id:task.id,expectedVersion:task.version,operationId:'overlap-done',action:'complete'});
 setTime('2026-10-19T12:02:00Z');const {provenance:_,...older}=item('slack');
 const saved=store.finishScan(manual.id,{sources:{slack:checked,granola:checked},items:[{...older,title:'Older manual snapshot'}]});
 assert.equal(saved.items[0].title,'Newer verified dot facts');assert.equal(saved.items[0].lastCheckedAt,'2026-10-19T12:01:00.000Z');assert.equal(saved.items[0].state,'done');
 assert.equal(saved.scan?.status,'completed');
});
test('equivalent ISO timestamps compare by instant when newer dot evidence follows explicit observations',t=>{
 const {store,setTime}=setup(t);const observation=item('jira');const sourceUrl=canonicalSourceUrl('jira',observation.sourceUrl);
 const obligationKey='jira:'+createHash('sha256').update(JSON.stringify([sourceUrl,observation.actionKey])).digest('hex');
 store.upsert({batchId:'no-milliseconds',items:[{...observation,obligationKey,sourceVersion:1,sourceKind:'jira',lastCheckedAt:'2026-10-19T12:00:00Z'}]});
 setTime('2026-10-19T12:00:00.500Z');const next=finish(store,start(store),[{...observation,title:'Newer verified facts'}],sources(),'2026-10-19T12:00:00.500Z');
 assert.equal(next.items[0].title,'Newer verified facts');assert.equal(next.items[0].lastCheckedAt,'2026-10-19T12:00:00.500Z');
});
test('separate MCP stores retain the newer writer even when scan and sync clocks tie',t=>{
 const {store,path}=setup(t);const scan=store.beginScan().run;
 const writer=new SauronStore(path,()=>new Date(instant));
 try{
   finish(writer,start(writer),[{...item('slack'),title:'Dot facts at tied instant'}]);
   const {provenance:_,...older}=item('slack');
   const result=store.finishScan(scan.id,{sources:{slack:checked,granola:checked},items:[older]});
   assert.equal(result.items.length,1);assert.equal(result.items[0].title,'Dot facts at tied instant');assert.equal(result.items[0].sourceVersion,1);
 }finally{writer.close();}
});

test('calendar account path variations keep one obligation without merging distinct actions',t=>{
 const {store}=setup(t);
 const calendar={...item('calendar'),sourceUrl:'https://calendar.google.com/calendar/u/0/r/eventedit/synthetic-event-123'};
 finish(store,start(store),[calendar]);
 const saved=store.view().items[0];store.decide({id:saved.id,expectedVersion:saved.version,operationId:'account-path-done',action:'complete'});
 finish(store,start(store),[{...calendar,sourceUrl:'https://calendar.google.com/calendar/u/2/r/eventedit/synthetic-event-123?ctz=UTC',title:'Same event, different account slot'}]);
 assert.equal(store.view().items.length,1);assert.equal(store.view().items[0].id,saved.id);assert.equal(store.view().items[0].state,'done');
 finish(store,start(store),[{...calendar,actionKey:'A different original commitment',title:calendar.title}]);
 assert.equal(store.view().items.length,2);
});

test('Granola app and notes links identify one obligation while separate quotes stay distinct',t=>{
 const {store}=setup(t);const granola=item('granola');finish(store,start(store),[granola]);
 finish(store,start(store),[{...granola,sourceUrl:granola.sourceUrl.replace('notes.granola.ai','app.granola.ai')}]);
 assert.equal(store.view().items.length,1);
 finish(store,start(store),[{...granola,actionKey:'Different personal commitment',title:granola.title}]);
 assert.equal(store.view().items.length,2);
});

test('legacy alias identities retain original IDs, Done decisions, receipt hashes and history after new syncs',t=>{
 const {store,path,setTime}=setup(t);
 const fixtures=[{...item('calendar'),sourceUrl:'https://calendar.google.com/calendar/u/2/r/eventedit/legacy-event-123'},
   {...item('granola'),sourceUrl:urls.granola.replace('notes.granola.ai','app.granola.ai')}];
 // Isolated pre-0.6.3 database fixture only. Production rows are never edited.
 // Current explicit upsert canonicalizes new records, so it cannot manufacture
 // the former identity. All decisions and later observations use public APIs.
 const db=new DatabaseSync(path);
 try{
   for(const fixture of fixtures){
     const id=fixture.provider+':'+createHash('sha256').update(JSON.stringify([fixture.sourceUrl,fixture.actionKey])).digest('hex');
     const observation={...fixture,obligationKey:id,sourceVersion:1,sourceKind:fixture.provider==='granola'?'meeting':'calendar',lastCheckedAt:'2026-10-19T12:00:00Z'};
     const batch={batchId:'legacy-'+fixture.provider,items:[observation]};
     const parsed=upsertSchema.parse(batch);
     db.prepare('INSERT INTO tasks(id,data) VALUES (?,?)').run(id,JSON.stringify({...observation,id,version:1,
       userDecision:null,decidedAt:null,snoozedUntil:null,updatedAt:instant,state:'needs_you'}));
     db.prepare('INSERT INTO history(task_id,kind,operation_id,at) VALUES (?,?,?,?)').run(id,'observation','legacy-fixture',instant);
     db.prepare('INSERT INTO receipts(id,hash) VALUES (?,?)').run('batch:'+batch.batchId,createHash('sha256').update(JSON.stringify(parsed)).digest('hex'));
     assert.equal(store.upsert(batch).receipt?.duplicate,true);
     assert.throws(()=>store.upsert({...batch,items:[{...observation,sourceUrl:canonicalSourceUrl(fixture.provider,fixture.sourceUrl)}]}),/different input/);
     store.decide({id,expectedVersion:1,operationId:'legacy-done-'+fixture.provider,action:'complete'});
   }
   const beforeHistory=db.prepare('SELECT * FROM history ORDER BY seq').all();
   const beforeReceipts=db.prepare('SELECT * FROM receipts ORDER BY id').all();
   const ids=store.view().items.map(task=>task.id);
   setTime('2026-10-19T12:00:00.500Z');
   const synced=finish(store,start(store),fixtures.map(fixture=>({...fixture,sourceUrl:canonicalSourceUrl(fixture.provider,fixture.sourceUrl),title:'Updated legacy obligation'})),sources(),'2026-10-19T12:00:00.500Z');
   assert.deepEqual(synced.items.map(task=>task.id),ids);assert.deepEqual(synced.items.map(task=>task.state),['done','done']);
   assert.ok(synced.items.every(task=>task.title==='Updated legacy obligation'&&task.lastCheckedAt==='2026-10-19T12:00:00.500Z'));
   assert.deepEqual(db.prepare('SELECT * FROM history ORDER BY seq LIMIT ?').all(beforeHistory.length),beforeHistory);
   for(const receipt of beforeReceipts)assert.deepEqual(db.prepare('SELECT * FROM receipts WHERE id=?').get(receipt.id as string),receipt);
   const restarted=new SauronStore(path,()=>new Date('2026-10-19T12:00:00.500Z'));
   try{assert.deepEqual(restarted.view().items.map(task=>[task.id,task.state]),ids.map(id=>[id,'done']));}finally{restarted.close();}
 }finally{db.close();}
});
