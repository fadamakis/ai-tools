import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {SauronStore} from '../src/server/store.js';
import {syntheticObservation,liveProviders} from '../src/shared/contracts.js';
import {invoke} from '../src/server/service.js';
function setup(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'sauron-mode-'));const path=join(dir,'test.sqlite');let now=new Date('2026-10-19T12:00:00Z');const store=new SauronStore(path,()=>now);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return{store,path,dir,setTime:(value:string)=>{now=new Date(value);}};}
function configure(store:SauronStore,mode='dot_managed',operationId=randomUUID()){return store.configureSync({expectedStoreId:store.storeId,operationId,mode});}
function counts(path:string){const db=new DatabaseSync(path,{readOnly:true});try{return{tasks:db.prepare('SELECT data FROM tasks ORDER BY id').all(),history:db.prepare('SELECT * FROM history ORDER BY seq').all(),receipts:db.prepare('SELECT * FROM receipts ORDER BY id').all()};}finally{db.close();}}
test('dot-managed setting persists, requires store identity, preserves tasks/history, and deduplicates operation',t=>{
 const {store,path}=setup(t);assert.equal(store.coordination().mode,'independent');
 store.upsert({batchId:'fixture',items:[{...syntheticObservation(),lastCheckedAt:'2026-10-19T12:00:00Z'}]});
 store.decide({id:'synthetic:review-proof',operationId:'finish-fixture',expectedVersion:1,action:'complete'});
 const before=counts(path);const operationId=randomUUID();
 assert.throws(()=>store.configureSync({expectedStoreId:randomUUID(),operationId,mode:'dot_managed'}),/Store ID/);
 assert.equal(configure(store,'dot_managed',operationId).coordination?.mode,'dot_managed');assert.equal(configure(store,'dot_managed',operationId).receipt?.duplicate,true);
 const after=counts(path);assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.history,before.history);assert.equal(after.receipts.length,before.receipts.length+1);
 const second=new SauronStore(path);try{assert.equal(second.coordination().mode,'dot_managed');assert.equal(second.view().items[0].state,'done');}finally{second.close();}
});
test('automatic scan gate is checked under the shared write lock; manual scan remains available',t=>{
 const {store,path}=setup(t);const active=store.beginScan().run;
 assert.throws(()=>configure(store),/source scan is running/);assert.equal(store.coordination().mode,'independent');
 store.failScan(active.id,'Isolated fixture complete');configure(store);
 const second=new SauronStore(path);try{
  assert.throws(()=>second.beginScan(true),/Automatic source scanning is disabled/);
  const before=counts(path);const result=invoke(second,'check_scheduled_attention',{});assert.equal(result.scan?.id,active.id);assert.equal(result.scan?.status,'failed');assert.deepEqual(counts(path),before);
  const manual=second.beginScan();assert.equal(manual.started,true);assert.equal(second.scan()?.status,'running');second.failScan(manual.run.id,'End isolated manual fixture');
 }finally{second.close();}
 configure(store,'independent');assert.equal(store.beginScan(true).started,true);
});
test('freshness distinguishes never/running/fresh/stale/partial/failed and Madrid update hours',t=>{
 const {store,setTime}=setup(t);configure(store);assert.equal(store.coordination().freshness.status,'never');assert.equal(store.coordination().freshness.businessHoursActive,true);
 const runId=randomUUID();const identity={runId,expectedStoreId:store.storeId};store.syncAttention({request:{phase:'start',...identity}});assert.equal(store.coordination().freshness.status,'running');
 const sources=Object.fromEntries(liveProviders.map(provider=>[provider,{status:'checked',detail:'Empty synthetic fixture'}]));
 store.syncAttention({request:{phase:'finish',...identity,checkedAt:'2026-10-19T12:00:00Z',sources,items:[]}});assert.equal(store.coordination().freshness.status,'fresh');
 setTime('2026-10-19T13:31:00Z');assert.equal(store.coordination().freshness.status,'stale');assert.equal(store.coordination().freshness.ageMinutes,91);
 const partialId=randomUUID();store.syncAttention({request:{phase:'start',runId:partialId,expectedStoreId:store.storeId}});
 store.syncAttention({request:{phase:'finish',runId:partialId,expectedStoreId:store.storeId,checkedAt:'2026-10-19T13:31:00Z',sources:{...sources,calendar:{status:'failed',detail:'Synthetic unavailable source'}},items:[]}});
 assert.equal(store.coordination().freshness.status,'partial');assert.equal(store.coordination().freshness.lastSuccessAt,'2026-10-19T12:00:00.000Z');
 const failedId=randomUUID();store.syncAttention({request:{phase:'start',runId:failedId,expectedStoreId:store.storeId}});store.syncAttention({request:{phase:'fail',runId:failedId,expectedStoreId:store.storeId,error:'Synthetic caller failure'}});
 assert.equal(store.coordination().freshness.status,'failed');setTime('2026-10-19T20:00:00Z');assert.equal(store.coordination().freshness.businessHoursActive,false);
 setTime('2026-10-25T08:00:00Z');assert.equal(store.coordination().freshness.businessHoursActive,false);
});
test('legacy scheduled helper only reads in dot mode; explicit manual helper still starts the scanner',t=>{
 const {store,path,dir}=setup(t);configure(store);const marker=join(dir,'scanner-started');const runtime=join(dir,'runtime.cjs');
 writeFileSync(runtime,`#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'yes');fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify({sources:{slack:{status:'checked',detail:'Synthetic fixture'},granola:{status:'checked',detail:'Synthetic fixture'}},items:[]}));`,{mode:0o700});
 const env={...process.env,ATTENTION_DB:path,SAURON_CODEX_BIN:runtime};
 const before=counts(path);const scheduled=spawnSync(process.execPath,[resolve('scripts/check-attention.mjs')],{encoding:'utf8',env});assert.equal(scheduled.status,0,scheduled.stderr);
 const report=JSON.parse(scheduled.stdout);assert.equal(report.mode,'dot_managed');assert.equal(report.checkKind,'sync_freshness');assert.equal(report.sourceScanStarted,false);assert.equal(report.sourcesChecked,false);assert.deepEqual(report.changes,[]);assert.equal(report.sync,null);assert.equal(existsSync(marker),false);assert.equal(store.view().scan,null);assert.deepEqual(counts(path),before);
 const manual=spawnSync(process.execPath,[resolve('scripts/check-attention.mjs'),'--manual-scan'],{encoding:'utf8',env,timeout:20000});assert.equal(manual.status,0,manual.stderr);
 const result=JSON.parse(manual.stdout);assert.equal(result.mode,'dot_managed');assert.equal(result.checkKind,'source_scan');assert.equal(result.scan.status,'completed');assert.equal(existsSync(marker),true);
 configure(store,'independent');const legacy=spawnSync(process.execPath,[resolve('scripts/check-attention.mjs')],{encoding:'utf8',env,timeout:20000});assert.equal(legacy.status,0,legacy.stderr);assert.equal(JSON.parse(legacy.stdout).checkKind,'source_scan');
});
