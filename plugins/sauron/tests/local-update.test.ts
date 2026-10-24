import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {SauronStore} from '../src/server/store.js';
import {liveProviders,type SyncProgress} from '../src/shared/contracts.js';
import {localCheckDue,runLocalUpdate,recoverLocalSync} from '../src/server/local-update.js';
import {localPolicyArgs,minimalAgentEnv,localReaders} from '../src/server/local-policy.js';

const target='2026-10-21T10:00:00.000Z';
const from='2026-10-14T10:00:00.000Z';
const sources=()=>Object.fromEntries(liveProviders.map(provider=>[provider,{status:'checked',detail:'Read isolated fixture.'}]));
const progress=()=>Object.fromEntries(liveProviders.map(provider=>[provider,{from,through:target,target,complete:true,cursor:null,identity:'fixture-user',scopeKey:'personal-v1'}])) as SyncProgress;
const item={provider:'slack',sourceUrl:'https://example.slack.com/archives/C123/p1792313076000000',actionKey:'Review this exact synthetic obligation',title:'Review fixture',nextAction:'Inspect the fixture.',sourceState:'needs_you',resolved:false,provenance:{reader:'local_agent',evidence:'Synthetic fixture request only.'}};
function setup(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'sauron-local-test-'));const path=join(dir,'store.sqlite');let now=new Date(target);const store=new SauronStore(path,()=>now);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return{dir,path,store,setTime:(value:string)=>{now=new Date(value);}};}
function own(store:SauronStore,mode='local_managed'){store.recordLocalRuntimeVerification({providers:Object.fromEntries(liveProviders.map(provider=>[provider,true])),observedTools:['slack.read','atlassian.read','github.read','google_calendar.read','granola.read'],cliVersion:'synthetic'});const current=store.coordination();return store.configureSync({expectedStoreId:store.storeId,operationId:randomUUID(),mode,expectedMode:current.mode,expectedEpoch:current.epoch??0});}
function start(store:SauronStore){const identity={runId:randomUUID(),expectedStoreId:store.storeId,writer:'local',epoch:store.coordination().epoch};store.syncAttention({request:{phase:'start',...identity,targetThrough:target}});return identity;}
function finish(identity:any,items:unknown[]=[item],p=progress()){return{request:{phase:'finish',...identity,checkedAt:target,sources:sources(),items,progress:p}};}

test('local ownership is CAS protected, rejects cloud starts, and fences stale workers',t=>{
 const {store}=setup(t);assert.throws(()=>store.configureSync({expectedStoreId:store.storeId,operationId:randomUUID(),mode:'local_managed'}),/expectedMode/);
 assert.throws(()=>store.configureSync({expectedStoreId:store.storeId,operationId:randomUUID(),mode:'local_managed',expectedMode:'independent',expectedEpoch:0}),/all five/);
 own(store);assert.throws(()=>store.syncAttention({request:{phase:'start',runId:randomUUID(),expectedStoreId:store.storeId}}),/local coordinator/);
 const id=start(store);assert.throws(()=>own(store,'dot_managed'),/source sync/);
 store.syncAttention(finish(id));own(store,'dot_managed');assert.throws(()=>store.syncAttention({request:{phase:'start',...id,runId:randomUUID(),targetThrough:target}}),/no longer owns/);
});
test('local sync shares one source-read lease with manual scans and multiple connections',t=>{
 const {store,path}=setup(t);own(store);const manual=store.beginScan().run;
 assert.throws(()=>start(store),/manual source scan/);store.failScan(manual.id,'End fixture');const id=start(store);
 const second=new SauronStore(path,()=>new Date(target));try{assert.throws(()=>second.beginScan(),/local source sync/);assert.throws(()=>start(second),/already running/);}finally{second.close();}
 store.syncAttention(finish(id));assert.equal(store.beginScan().started,true);
});
test('finish, checkpoints, exact recovery and original user decisions survive restart',t=>{
 const {store,path}=setup(t);own(store);const id=start(store);const body=finish(id);store.stageLocalSync(body);
 const reopened=new SauronStore(path,()=>new Date(target));try{
  recoverLocalSync(reopened);assert.equal(reopened.pendingLocalSync(),null);assert.equal(reopened.syncReceipt(id.runId)?.status,'completed');
  assert.equal(reopened.localState().checkpoints?.slack?.through,target);assert.equal(reopened.syncAttention(body).receipt?.duplicate,true);
  const task=reopened.view().items[0];reopened.decide({id:task.id,operationId:'complete',expectedVersion:task.version,action:'complete'});
  const next=start(reopened);const p=progress();for(const provider of liveProviders)p[provider].from=target;
  reopened.syncAttention(finish(next,[{...item,title:'New summary'}],p));assert.equal(reopened.view().items[0].state,'done');assert.equal(reopened.view().items[0].id,task.id);
  assert.throws(()=>reopened.syncAttention({...body,request:{...body.request,items:[]}}),/different input/);
 }finally{reopened.close();}
});
test('staging rejects invalid progress before journaling; partial coverage does not advance full freshness',t=>{
 const {store}=setup(t);own(store);const id=start(store);const bad=progress();bad.slack.through='2026-10-22T10:00:00.000Z';
 assert.throws(()=>store.stageLocalSync(finish(id,[],bad)),/checkpoint/);assert.equal(store.pendingLocalSync(),null);
 const p=progress();p.slack={...p.slack,through:from,complete:false,cursor:'page-2'};
 const saved=store.syncAttention(finish(id,[],p));assert.equal(saved.sync?.status,'partial');assert.equal(saved.sync?.lastSuccessAt,null);assert.equal(saved.local?.checkpoints?.slack?.through,from);
});
test('unchecked providers cannot advance progress or create observations',t=>{
 const {store}=setup(t);own(store);const id=start(store);const body=finish(id,[]);body.request.sources.slack={status:'failed',detail:'Access denied'};
 assert.throws(()=>store.stageLocalSync(body),/unchecked source/);assert.equal(store.localState().checkpoints,undefined);
});
test('newer explicit observation during a local read wins even with a tied clock',t=>{
 const {store}=setup(t);own(store);store.syncAttention(finish(start(store)));const before=store.view().items[0];const id=start(store);
 store.upsert({batchId:'new-facts',items:[{...item,title:'Newer source facts',obligationKey:before.id,sourceVersion:before.sourceVersion+1,lastCheckedAt:target,sourceKind:'slack'}]});
 const p=progress();for(const provider of liveProviders)p[provider].from=target;
 store.syncAttention(finish(id,[{...item,title:'Older read'}],p));assert.equal(store.view().items[0].title,'Newer source facts');
});
test('expired staged result is discarded without source writes and cannot finish late',t=>{
 const {store,setTime}=setup(t);own(store);const id=start(store);store.stageLocalSync(finish(id));setTime('2026-10-21T10:31:00.000Z');recoverLocalSync(store);
 assert.equal(store.view().items.length,0);assert.equal(store.pendingLocalSync(),null);assert.equal(store.localState().checkpoints,undefined);assert.throws(()=>store.syncAttention(finish(id)),/no longer active/);
});
test('offline coordinator makes no agent call or sync start; online run verifies receipt',async t=>{
 const {store}=setup(t);own(store);let called=0;const agent=async()=>{called++;return{output:{sources:sources(),progress:progress(),items:[item]},observedTools:[]};};
 await runLocalUpdate(store,store.storeId,{now:()=>new Date(target),available:async()=>false,agent});assert.equal(called,0);assert.equal(store.sync(),null);assert.equal(store.localState().blocked,'offline');
 const view=await runLocalUpdate(store,store.storeId,{now:()=>new Date(target),available:async()=>true,agent});assert.equal(called,1);assert.equal(view.sync?.status,'completed');assert.ok(store.syncReceipt(view.sync!.id));
});
test('agent failure is recorded without losing tasks; bad output cannot stage an uncertain write',async t=>{
 const {store}=setup(t);own(store);const view=await runLocalUpdate(store,store.storeId,{now:()=>new Date(target),available:async()=>true,agent:async()=>({output:{items:[]},observedTools:[]})});
 assert.equal(view.sync?.status,'failed');assert.equal(store.pendingLocalSync(),null);assert.equal(view.items.length,0);assert.ok(view.local?.nextAttemptAt);
});
test('scheduler coalesces bursts and sleep, respects Madrid periodic hours, no missed-hour backlog',t=>{
 const {store}=setup(t);own(store);const view=store.view();
 assert.equal(localCheckDue(view,{},'timer',new Date(target)),true);
 assert.equal(localCheckDue(view,{lastAttemptAt:target},'connect',new Date(Date.parse(target)+1000)),false);
 assert.equal(localCheckDue(view,{lastTickAt:target,lastAttemptAt:target},'timer',new Date('2026-10-24T10:00:00Z')),true);
 const weekend={...view,coordination:{...view.coordination!,freshness:{...view.coordination!.freshness,businessHoursActive:false}}};
 assert.equal(localCheckDue(weekend,{},'timer',new Date('2026-10-24T10:00:00Z')),false);
 assert.equal(localCheckDue(weekend,{},'connect',new Date('2026-10-24T10:00:00Z')),true);
});
test('tool policy is deny by default and drops source/desktop credentials from child environment',()=>{
 const args=localPolicyArgs().join('\n');assert.match(args,/apps\._default.enabled=false/);assert.match(args,/mcp_servers.sauron.enabled=false/);assert.match(args,/features.shell_tool=false/);
 for(const reader of Object.values(localReaders)){assert.match(args,new RegExp(reader.id));assert.equal(reader.tools.some(tool=>/send|write|create|update|delete|reaction|review$/.test(tool)),false);}
 assert.deepEqual(minimalAgentEnv({HOME:'/home/test',PATH:'/bin',SLACK_TOKEN:'secret',CODEX_APP_TOOLS_PIPE_PATH:'pipe',ATTENTION_DB:'live'}),{HOME:'/home/test',PATH:'/bin'});
});
test('local scheduler helper fails closed if the selected database is missing',t=>{
 const {dir}=setup(t);const path=join(dir,'absent.sqlite');const result=spawnSync(process.execPath,[resolve('dist/server/check-local-attention.js'),'--expected-store-id',randomUUID()],{encoding:'utf8',env:{...process.env,ATTENTION_DB:path}});
 assert.notEqual(result.status,0);assert.equal(existsSync(path),false);
});

test('failed capability proof cannot enable local ownership or change saved data',t=>{
 const {store}=setup(t);const before=store.view();
 assert.throws(()=>store.recordLocalRuntimeVerification({providers:{slack:false,jira:false,github:true,calendar:true,granola:false},observedTools:['github.get_user_login','google_calendar.get_profile'],cliVersion:'fixture'}),/All five/);
 assert.deepEqual(store.view().items,before.items);assert.equal(store.localState().runtime,undefined);assert.equal(store.coordination().mode,'independent');
});
test('checkpoint identity changes reject instead of silently switching connected accounts',t=>{
 const {store}=setup(t);own(store);store.syncAttention(finish(start(store)));const id=start(store),p=progress();
 for(const provider of liveProviders)p[provider].from=target;
 p.slack.identity='another-user';assert.throws(()=>store.stageLocalSync(finish(id,[],p)),/checkpoint/);assert.equal(store.pendingLocalSync(),null);
});
