import {spawnSync} from 'node:child_process';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SauronStore} from '../src/server/store.js';
import {liveProviders,defaultSourcePreferences,type LiveProvider} from '../src/shared/contracts.js';
import {refreshAttention} from '../src/server/scan.js';
import {scanPrompt} from '../src/server/scan-worker.js';
import {localPrompt,runLocalUpdate,localCheckDue} from '../src/server/local-update.js';
import {localPolicyArgs,localReaders} from '../src/server/local-policy.js';
import {invokeFixture,seedDevStore} from '../src/server/dev-fixtures.js';

const now='2026-10-21T10:00:00.000Z';
const from='2026-10-14T10:00:00.000Z';
const github={provider:'github',sourceUrl:'https://github.com/example/repo/pull/12',actionKey:'Review this PR',title:'GitHub fixture',nextAction:'Review it',sourceState:'needs_you',resolved:false,provenance:{reader:'dot',evidence:'Assigned fixture review'}};
const coverage=(off:LiveProvider[]=[])=>Object.fromEntries(liveProviders.map(provider=>[provider,{status:off.includes(provider)?'skipped':'checked',detail:off.includes(provider)?'Off':'Fixture read'}]));
function setup(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'sauron-sources-')),path=join(dir,'store.sqlite');const store=new SauronStore(path,()=>new Date(now));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return{store,path};}
function toggle(store:SauronStore,provider:LiveProvider,enabled:boolean){return store.configureSources({expectedStoreId:store.storeId,operationId:randomUUID(),expectedRevision:store.sourcePreferences().revision,provider,enabled});}
function start(store:SauronStore){const identity={expectedStoreId:store.storeId,runId:randomUUID()};store.syncAttention({request:{phase:'start',...identity}});return identity;}
function finish(store:SauronStore,identity:ReturnType<typeof start>,off:LiveProvider[]=[],items:unknown[]=[]){return store.syncAttention({request:{phase:'finish',...identity,checkedAt:now,sources:coverage(off),items}});}
function own(store:SauronStore){store.recordLocalRuntimeVerification({providers:Object.fromEntries(liveProviders.map(p=>[p,true])),observedTools:['slack.read','atlassian.read','github.read','google_calendar.read','granola.read'],cliVersion:'fixture'});store.configureSync({expectedStoreId:store.storeId,operationId:randomUUID(),mode:'local_managed',expectedMode:'independent',expectedEpoch:0});}

test('defaults, saved tasks, idempotent settings and restart preserve existing data',t=>{
 const {store,path}=setup(t);assert.deepEqual(store.sourcePreferences(),defaultSourcePreferences());
 finish(store,start(store),[],[github]);const task=store.view().items[0];store.decide({operationId:'complete',id:task.id,expectedVersion:task.version,action:'complete'});const before=store.view().items;
 const request={expectedStoreId:store.storeId,operationId:randomUUID(),expectedRevision:0,provider:'github',enabled:false};store.configureSources(request);
 assert.equal(store.configureSources(request).receipt?.duplicate,true);assert.deepEqual(store.view().items,before);
 const second=new SauronStore(path);try{assert.equal(second.sourcePreferences().enabled.github,false);assert.equal(second.sourcePreferences().revision,1);assert.deepEqual(second.view().items,before);}finally{second.close();}
 assert.throws(()=>store.configureSources({...request,operationId:randomUUID()}),/settings changed/);
 assert.throws(()=>store.configureSources({...request,operationId:randomUUID(),expectedStoreId:randomUUID()}),/Store ID/);
});
test('settings lock for scans, syncs, and expired pending reconciliation',t=>{
 const {store,path}=setup(t);const scan=store.beginScan().run;assert.throws(()=>toggle(store,'github',false),/current update/);store.failScan(scan.id,'fixture');
 const id=start(store);assert.throws(()=>toggle(store,'github',false),/current update/);finish(store,id);
 const db=new DatabaseSync(path);db.prepare("INSERT INTO metadata VALUES ('local_pending_sync',?)").run(JSON.stringify({request:{phase:'fail',runId:randomUUID()}}));db.close();
 assert.throws(()=>toggle(store,'github',false),/reconciliation/);
});
test('disabled observations reject entire sync and upsert batches without touching tasks',t=>{
 const {store}=setup(t);finish(store,start(store),[],[github]);const task=store.view().items[0];toggle(store,'github',false);const before=store.view().items;const id=start(store);
 assert.throws(()=>finish(store,id,['github'],[github]),/disabled source/);assert.deepEqual(store.view().items,before);
 assert.throws(()=>finish(store,id),/reported as skipped/);
 assert.throws(()=>store.upsert({batchId:'disabled',items:[{...github,obligationKey:task.id,sourceVersion:2,lastCheckedAt:now}]}),/disabled source/);
 const view=finish(store,id,['github']);assert.equal(view.sync?.status,'completed');assert.equal(view.sync?.sources?.github.status,'skipped');assert.deepEqual(view.items,before);
});
test('manual scopes, prompt context, skipped coverage and all-off launch gates',async t=>{
 const {store}=setup(t);toggle(store,'slack',false);assert.doesNotMatch(scanPrompt(store),/"provider":"slack"/);
 const scan=store.beginScan().run;assert.deepEqual(scan.enabledProviders,['granola']);
 const view=store.finishScan(scan.id,{sources:{slack:{status:'skipped',detail:'Off'},granola:{status:'checked',detail:'Read fixture'}},items:[]});assert.equal(view.scan?.status,'completed');
 toggle(store,'granola',false);assert.equal(refreshAttention(store).scan?.id,scan.id);
 for(const provider of ['github','jira','calendar'] as const)toggle(store,provider,false);
 assert.equal(refreshAttention(store).scan?.id,scan.id);assert.equal(start(store).expectedStoreId,store.storeId);assert.equal(store.sync(),null);
 own(store);let called=false;await runLocalUpdate(store,store.storeId,{available:async()=>{called=true;return true;},agent:async()=>{called=true;throw Error('unexpected');}});assert.equal(called,false);
 assert.equal(localCheckDue(store.view(),{},'manual',new Date(now)),false);assert.equal(store.coordination().freshness.status,'never');
});
test('local updates exclude disabled connector access and progress, retaining catch-up checkpoints',async t=>{
 const {store}=setup(t);finish(store,start(store),[],[github]);own(store);
 const output=(off:LiveProvider[]=[],since=from)=>({sources:coverage(off),progress:Object.fromEntries(liveProviders.filter(p=>!off.includes(p)).map(p=>[p,{from:since,through:now,target:now,identity:'fixture',scopeKey:'personal-v1',complete:true,cursor:null}])),items:[]});
 await runLocalUpdate(store,store.storeId,{now:()=>new Date(now),available:async()=>true,agent:async()=>({output:output(),observedTools:[]})});
 const saved=store.localState().checkpoints?.github;toggle(store,'github',false);
 const policy=localPolicyArgs(['slack','granola','jira','calendar']).join('\n');assert.ok(policy.includes(`apps.${localReaders.github.id}.enabled=false`));assert.ok(policy.includes(`apps.${localReaders.github.id}.tools.fetch_pr.enabled=false`));
 let selected:LiveProvider[]|undefined;
 const view=await runLocalUpdate(store,store.storeId,{now:()=>new Date(now),available:async()=>true,agent:async(prompt,_schema,options)=>{selected=options?.providers;assert.doesNotMatch(prompt,/"github":/);assert.doesNotMatch(prompt,/github.com/);return{output:output(['github'],now),observedTools:[]};}});
 assert.ok(selected&&!selected.includes('github'));assert.equal(view.sync?.status,'completed');assert.equal(view.local?.failures,0);assert.equal(view.local?.blocked,undefined);assert.deepEqual(store.localState().checkpoints?.github,saved);
 toggle(store,'github',true);assert.deepEqual(store.localState().checkpoints?.github,saved);assert.match(localPrompt(store,now),/"github":\{"from":"2026-10-21/);
});
test('enabled-source failures still report incomplete coverage',t=>{
 const {store}=setup(t);toggle(store,'github',false);const id=start(store);const sources=coverage(['github']);sources.slack={status:'failed',detail:'Denied'};
 const view=store.syncAttention({request:{phase:'finish',...id,checkedAt:now,sources,items:[]}});assert.equal(view.sync?.status,'partial');assert.equal(view.sync?.lastSuccessAt,null);
});
test('fixture refresh respects preferences and preserves its seeded tasks',t=>{
 const {store,path}=setup(t);const dir=join(path,'..','dev.sqlite');seedDevStore(dir);const dev=new SauronStore(dir);try{const before=dev.view().items;toggle(dev,'slack',false);const view=invokeFixture(dev,'refresh_attention',{});assert.equal(view.scan?.sources?.slack.status,'skipped');assert.deepEqual(view.items,before);}finally{dev.close();}
});

test('scheduled helper handles paused sources without a scan or false failure notice',t=>{
 const {store,path}=setup(t);for(const provider of liveProviders)toggle(store,provider,false);
 for(const mode of ['independent','dot_managed']){
  if(mode==='dot_managed')store.configureSync({expectedStoreId:store.storeId,operationId:randomUUID(),mode});
  const result=spawnSync(process.execPath,['scripts/check-attention.mjs'],{encoding:'utf8',env:{...process.env,ATTENTION_DB:path},timeout:20_000});
  assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);assert.equal(output.checkKind,'sources_paused');assert.equal(output.notifyFailure,false);assert.equal(store.scan(),null);
 }
});

test('enabled providers still require progress; legacy runs retain their original scope',t=>{
 const {store,path}=setup(t);own(store);toggle(store,'github',false);
 const identity={expectedStoreId:store.storeId,runId:randomUUID(),writer:'local',epoch:store.coordination().epoch};store.syncAttention({request:{phase:'start',...identity,targetThrough:now}});
 assert.throws(()=>store.stageLocalSync({request:{phase:'finish',...identity,checkedAt:now,sources:coverage(['github']),progress:{},items:[]}}),/require progress/);
 store.syncAttention({request:{phase:'fail',...identity,error:'Fixture end'}});
 store.configureSync({expectedStoreId:store.storeId,operationId:randomUUID(),mode:'independent',expectedMode:'local_managed',expectedEpoch:store.coordination().epoch});
 toggle(store,'github',true);const run=store.beginScan().run;
 const db=new DatabaseSync(path);const legacy={...run};delete legacy.enabledProviders;delete legacy.sourceRevision;db.prepare("UPDATE metadata SET value=? WHERE key='scan_run'").run(JSON.stringify(legacy));db.close();
 const view=store.finishScan(run.id,{sources:{slack:{status:'checked',detail:'Fixture read'},granola:{status:'checked',detail:'Fixture read'}},items:[]});assert.equal(view.scan?.status,'completed');
});
