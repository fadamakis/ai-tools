import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {bootstrapDevelopment} from '../scripts/dev-bootstrap.mjs';
import {devPaths,acquireDevLock,acquireDevRuntimeLock} from '../scripts/dev-state.mjs';
import {fingerprint} from '../scripts/migrate-data.mjs';
import {SauronStore} from '../src/server/store.ts';
import {runReadOnlyAgent} from '../src/server/agent-runner.ts';
import {invokeFixture} from '../src/server/dev-fixtures.ts';

let bundle;
before(async()=>{bundle=(await build({entryPoints:['src/server/dev-bootstrap.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'node22',define:{__SAURON_DEV_BUILD_ID__:'"bootstrap-test"'},banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}})).outputFiles[0].text;});
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'sauron-dev-bootstrap-')),paths=devPaths(root),buildRoot=join(paths.root,'builds/bootstrap-test/server');
  mkdirSync(buildRoot,{recursive:true});writeFileSync(join(root,'package.json'),'{"type":"module"}');writeFileSync(join(paths.root,'current.json'),'{"buildId":"bootstrap-test"}');writeFileSync(join(buildRoot,'dev-bootstrap.js'),bundle);
  const store=new SauronStore(paths.database),cleanups=[];let closed=false;
  const close=()=>{if(!closed){closed=true;store.close();}};
  t.after(()=>{for(const cleanup of cleanups.reverse())cleanup();close();rmSync(root,{recursive:true,force:true});});
  const operationId=randomUUID();store.createPersonal({operationId,title:'Saved Dev task'});const id='personal:'+operationId;
  const logs=[];
  return {root,paths,store,id,logs,close,cleanup:fn=>cleanups.push(fn),run:(dependencies={},fresh=false)=>bootstrapDevelopment({root,fresh,log:message=>logs.push(message)},{reader:()=>{throw Error('Test attempted unmocked chat access');},...dependencies})};
}
function digest(path){const db=new DatabaseSync(path,{readOnly:true});try{return fingerprint(db);}finally{db.close();}}
function reader({failRead,probe=async()=>{}}={}){
  const active={id:randomUUID(),title:'Resumed older chat',createdAt:Math.floor(Date.now()/1000)-30*86400,updatedAt:Math.floor(Date.now()/1000)-120};
  const archived={...active,id:randomUUID(),title:'Archived recent chat'};
  const calls=[],reads=[];let closed=0;
  return {active,archived,calls,reads,get closed(){return closed;},runtime:'fake-local-runtime',probe,
    async list(archive,cursor){calls.push([archive,cursor]);return cursor?{chats:[],nextCursor:null}:{chats:[archive?archived:active],nextCursor:'next'};},
    async read(chat){reads.push(chat.id);if(failRead?.(chat))throw Error('Synthetic partial access.');return {threadId:chat.id,title:chat.title,fingerprint:chat.id,messages:[{id:chat.id+':message',text:'Synthetic evidence only.',role:'user'}],latestAssistant:null};},
    close(){closed++;}};
}
const generate=async(chats)=>chats.map(chat=>({kind:'track',key:'track-'+chat.threadId,threadId:chat.threadId,title:chat.title,parentRef:null,reason:'Synthetic tracking suggestion.',evidenceIds:chat.messages.map(message=>message.id)}));
function dismiss(store){const proposal=store.reviews.state().proposal;store.acceptProposal({operationId:randomUUID(),expectedStoreId:store.storeId,proposalId:proposal.id,expectedProposalRevision:proposal.revision,expectedRevision:store.view().taskViewRevision,changes:[]});}

test('D-01: real bootstrap preserves tasks and reviews resumed and archived chats with one editable proposal',async t=>{
  const f=fixture(t),r=reader(),before=f.store.view().items,storeId=f.store.storeId,reviewed=[];
  const result=await f.run({reader:()=>r,generate:async(chats,store)=>{reviewed.push(store.view().items.map(task=>task.id));return generate(chats);}});
  assert.equal(result.status,'completed');assert.equal(result.storeId,storeId);assert.deepEqual(f.store.view().items,before);
  assert.deepEqual(r.calls,[[false,null],[false,'next'],[true,null],[true,'next']]);assert.deepEqual(new Set(r.reads),new Set([r.active.id,r.archived.id]));assert.equal(r.closed,1);
  assert.ok(reviewed.every(ids=>ids.includes(f.id)));const state=f.store.reviews.state();assert.equal(state.proposal.origin,'local_history');assert.equal(state.proposal.changes.length,2);assert.equal(state.enabled,false);
  const duration=Date.parse(state.run.through)-Date.parse(state.run.from);assert.equal(duration,14*24*60*60_000);
  assert.throws(()=>invokeFixture(f.store,'review_organisation',{expectedStoreId:storeId,kind:'probe'}),/Real-history review/);
  f.store.acceptProposal({operationId:randomUUID(),expectedStoreId:storeId,proposalId:state.proposal.id,expectedProposalRevision:state.proposal.revision,expectedRevision:f.store.view().taskViewRevision,changes:state.proposal.changes});
  assert.equal(f.store.view().items.length,3);
  assert.match(f.logs.join('\n'),/2 chats reviewed/);assert.doesNotMatch(f.logs.join('\n'),/Synthetic evidence only/);
});

test('D-01: pending simulated proposals block real reads without modifying the Dev store',async t=>{
  const f=fixture(t);invokeFixture(f.store,'review_organisation',{expectedStoreId:f.store.storeId,kind:'bootstrap'});const before=digest(f.paths.database);let called=false;
  await assert.rejects(f.run({reader:()=>{called=true;throw Error('Unexpected read');}}),/pending proposal/);
  assert.equal(called,false);assert.equal(digest(f.paths.database),before);
});

test('D-01: a failed real review never reports an old dismissed fixture proposal as its result',async t=>{
  const f=fixture(t);invokeFixture(f.store,'review_organisation',{expectedStoreId:f.store.storeId,kind:'bootstrap'});dismiss(f.store);
  const result=await f.run({reader:()=>reader(),generate:async()=>{throw Error('Synthetic generation failure');}});
  assert.equal(result.status,'failed');assert.equal(result.proposalId,null);assert.match(f.logs.join('\n'),/Review failed: 2 chats reviewed · 0 proposed changes/);
});

test('D-01: old native runtimes cannot bypass provenance guards and fixture checkpoints are not resumed as real history',async t=>{
  const f=fixture(t),release=acquireDevRuntimeLock(f.root);let called=false;
  await assert.rejects(f.run({reader:()=>{called=true;return reader();}}),/older Dev runtime/);release();assert.equal(called,false);
  const {run}=f.store.beginReview('bootstrap','fixture');f.store.failReview(run.id,run.leaseId,'Interrupted simulation.');
  const result=await f.run({reader:()=>reader(),generate});assert.notEqual(result.runId,run.id);assert.equal(f.store.reviews.state().run.origin,'local_history');
});

test('D-01: interrupted coverage resumes the same real run without duplicate proposals or fixture checkpoint reuse',async t=>{
  const f=fixture(t),first=reader({failRead:chat=>chat.title.startsWith('Archived')});
  let result=await f.run({reader:()=>first,generate});assert.equal(result.status,'partial');const state=f.store.reviews.state();assert.equal(state.lastCompleteThrough,null);assert.equal(state.run.origin,'local_history');
  assert.throws(()=>invokeFixture(f.store,'review_organisation',{expectedStoreId:f.store.storeId,kind:'bootstrap'}),/Real-history review/);
  dismiss(f.store);
  const second={...first,closed:0,probe:async()=>{},read:async chat=>({threadId:chat.id,title:chat.title,fingerprint:chat.id,messages:[{id:chat.id+':message',text:'Recovered evidence.',role:'user'}],latestAssistant:null}),close(){this.closed++;}};
  result=await f.run({reader:()=>second,generate});assert.equal(result.status,'completed');assert.equal(result.runId,state.run.id);assert.ok(f.store.reviews.state().lastCompleteThrough);
  const proposal=f.store.reviews.state().proposal;assert.equal(new Set(proposal.changes.map(change=>change.threadId)).size,proposal.changes.length);
});

test('D-01: bootstrap is a single Dev command owner while the native panel remains available',async t=>{
  const f=fixture(t),native=acquireDevRuntimeLock(f.root,{buildId:'bootstrap-test'});f.cleanup(native);
  let ready,release;const entered=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  const r=reader({probe:async()=>{ready();await gate;}}),running=f.run({reader:()=>r,generate});
  await entered;
  await assert.rejects(f.run({reader:()=>reader(),generate}),/busy/);assert.throws(()=>acquireDevLock(f.root,'reset'),/busy/);
  assert.throws(()=>acquireDevRuntimeLock(f.root,{buildId:'older-build'}),/selected Dev build/);
  const otherPanel=acquireDevRuntimeLock(f.root,{buildId:'bootstrap-test'});otherPanel();release();await running;
  assert.equal(existsSync(f.paths.lock),false);
});

test('D-02: fresh mode refuses active Dev runtimes and capability failure leaves original records untouched',async t=>{
  const f=fixture(t),before=digest(f.paths.database),release=acquireDevRuntimeLock(f.root);let called=false;
  await assert.rejects(f.run({reader:()=>{called=true;return reader();}},true),/Quit Codex/);assert.equal(called,false);release();
  await assert.rejects(f.run({reader:()=>reader({probe:async()=>{throw Error('Unsupported fake host');}})},true),/Unsupported fake host/);
  assert.equal(digest(f.paths.database),before);assert.equal(existsSync(join(f.paths.root,'archives')),false);
});

test('D-02: fresh mode archives all records and starts empty with a new identity and scheduling off',async t=>{
  const f=fixture(t);invokeFixture(f.store,'review_organisation',{expectedStoreId:f.store.storeId,kind:'bootstrap'});
  f.store.configureSources({expectedStoreId:f.store.storeId,expectedRevision:0,operationId:randomUUID(),provider:'github',enabled:false});
  const originalId=f.store.storeId,before=digest(f.paths.database),oldProposal=f.store.reviews.state().proposal;f.close();
  const r=reader();const result=await f.run({reader:()=>r,generate:async(chats,store)=>{assert.deepEqual(store.view().items,[]);return generate(chats);}},true);
  assert.notEqual(result.storeId,originalId);assert.equal(digest(join(result.archive,'attention.sqlite')),before);
  const fresh=new SauronStore(f.paths.database);try{
    assert.equal(fresh.view().items.length,0);assert.equal(fresh.view().discussions.length,0);assert.equal(fresh.sourcePreferences().enabled.github,true);assert.equal(fresh.reviews.state().enabled,false);assert.equal(fresh.reviews.state().run.origin,'local_history');
    assert.throws(()=>fresh.acceptProposal({operationId:randomUUID(),expectedStoreId:originalId,proposalId:oldProposal.id,expectedProposalRevision:oldProposal.revision,expectedRevision:0,changes:[]}),/Store ID/);
  }finally{fresh.close();}
  const db=new DatabaseSync(f.paths.database,{readOnly:true});try{for(const name of ['tasks','receipts','history'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name}`).get().n,0);}finally{db.close();}
  assert.match(f.logs.join('\n'),/archived at/);
});

test('D-02: failed activation restores the original database and proposal',async t=>{
  const f=fixture(t),before=digest(f.paths.database);f.close();
  await assert.rejects(f.run({reader:()=>reader(),generate,move:(from,to)=>{if(from.includes('/empty-'))throw Error('Synthetic activation failure');renameSync(from,to);}},true),/Synthetic activation failure/);
  assert.equal(digest(f.paths.database),before);assert.equal(existsSync(f.paths.lock),false);
});

test('D-02: review failure after replacement retains the fresh store, archive and recoverable real checkpoint',async t=>{
  const f=fixture(t),oldId=f.store.storeId,before=digest(f.paths.database);f.close();
  const result=await f.run({reader:()=>reader(),generate:async()=>{throw Error('Synthetic model failure');}},true);
  assert.equal(result.status,'failed');assert.notEqual(result.storeId,oldId);assert.equal(digest(join(result.archive,'attention.sqlite')),before);
  const store=new SauronStore(f.paths.database);try{assert.equal(store.view().items.length,0);assert.equal(store.reviews.state().run.origin,'local_history');assert.equal(store.reviews.state().lastCompleteThrough,null);}finally{store.close();}
  assert.match(f.logs.join('\n'),/Resume with pnpm sauron:dev:bootstrap/);
});

test('D-01: interrupting a bootstrap model stops its process and removes private evidence files',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-bootstrap-abort-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const runtime=join(dir,'runtime.cjs'),marker=join(dir,'started.json');
  writeFileSync(runtime,`#!/usr/bin/env node\nif(process.argv[2]==='mcp'){console.log('[]');}else{require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,directory:process.argv[process.argv.indexOf('--cd')+1]}));setInterval(()=>{},1000);}`,{mode:0o700});
  const abort=new AbortController();
  const running=runReadOnlyAgent('Synthetic evidence.',{type:'object'},{cli:runtime,denyAllLocalServers:true,signal:abort.signal});
  const rejected=assert.rejects(running,error=>error.code==='cancelled');
  for(let i=0;i<200&&!existsSync(marker);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(existsSync(marker));const started=JSON.parse(readFileSync(marker,'utf8'));abort.abort();await rejected;
  assert.equal(existsSync(started.directory),false);
  let alive=true;for(let i=0;i<200&&alive;i++){try{process.kill(started.pid,0);await new Promise(resolve=>setTimeout(resolve,10));}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}}
  assert.equal(alive,false);
});

test('D-01: foreground interruption saves a failed checkpoint and releases locks for a normal resume',async t=>{
  const f=fixture(t),r=reader();
  const interrupted=await f.run({reader:()=>r,generate:async()=>{process.emit('SIGINT');return [];}});
  assert.equal(interrupted.status,'failed');assert.equal(r.closed,1);assert.equal(existsSync(f.paths.lock),false);assert.equal(f.store.reviews.state().lastCompleteThrough,null);
  const result=await f.run({reader:()=>reader(),generate});assert.equal(result.status,'completed');assert.equal(result.runId,interrupted.runId);
});

test('D-01 D-02: database overrides, symlinks, unsupported builds and identity changes fail before real reads',async t=>{
  const f=fixture(t),before=digest(f.paths.database),previous=process.env.ATTENTION_DB;f.close();
  t.after(()=>{if(previous===undefined)delete process.env.ATTENTION_DB;else process.env.ATTENTION_DB=previous;});
  process.env.ATTENTION_DB=join(f.root,'production.sqlite');await assert.rejects(f.run(),/different ATTENTION_DB/);delete process.env.ATTENTION_DB;
  const archiveRoot=join(f.root,'unsafe');mkdirSync(archiveRoot);const alias=join(f.paths.root,'attention.sqlite-wal');
  if(existsSync(alias))rmSync(alias);symlinkSync(join(archiveRoot,'never.sqlite'),alias);await assert.rejects(f.run(),/symbolic link/);rmSync(alias);
  const module=join(f.paths.root,'builds/bootstrap-test/server/dev-bootstrap.js');renameSync(module,module+'.saved');await assert.rejects(f.run(),/lacks real-chat bootstrap/);renameSync(module+'.saved',module);
  const r=reader({probe:async()=>{const db=new DatabaseSync(f.paths.database);db.prepare("UPDATE metadata SET value=? WHERE key='store_id'").run(randomUUID());db.close();}});
  await assert.rejects(f.run({reader:()=>r,generate}),/identity changed/);
  const db=new DatabaseSync(f.paths.database);db.prepare("UPDATE metadata SET value=? WHERE key='store_id'").run(f.store.storeId);db.close();assert.equal(digest(f.paths.database),before);
});
