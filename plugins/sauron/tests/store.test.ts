import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { SauronStore } from '../src/server/store.js';
import { syntheticObservation } from '../src/shared/contracts.js';

const instant='2026-10-18T12:00:00.000Z';
const item=(version=1)=>({...syntheticObservation(version),lastCheckedAt:instant});
test('business-hour freshness follows the selected time zone without changing the store identity',t=>{
  const dir=mkdtempSync(join(tmpdir(),'attention-time-zone-')),path=join(dir,'test.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const clock=()=>new Date('2026-10-19T22:00:00Z');
  const eastern=new SauronStore(path,clock,'America/New_York');
  const id=eastern.storeId;
  assert.equal(eastern.coordination().freshness.businessHoursActive,true);
  assert.equal(eastern.coordination().freshness.timeZone,'America/New_York');
  eastern.close();
  const utc=new SauronStore(path,clock,'UTC');
  assert.equal(utc.storeId,id);
  assert.equal(utc.coordination().freshness.businessHoursActive,false);
  utc.close();
  assert.throws(()=>new SauronStore(join(dir,'invalid.sqlite'),clock,'Invalid/TimeZone'),RangeError);
});
function setup(t:TestContext){
  const dir=mkdtempSync(join(tmpdir(),'attention-store-'));const path=join(dir,'test.sqlite');
  let now=new Date(instant);let store=new SauronStore(path,()=>now);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  return {get store(){return store;},path,setTime:(value:string)=>{now=new Date(value);},
    restart:()=>{store.close();store=new SauronStore(path,()=>now);return store;}};
}
test('stable keys deduplicate exact replay and distinct batches; titles do not deduplicate',t=>{
  const {store}=setup(t);const input={batchId:'one',items:[item()]};
  store.upsert(input);assert.equal(store.upsert(input).receipt?.duplicate,true);
  store.upsert({batchId:'two',items:[item()]});assert.equal(store.view().items.length,1);
  assert.equal(store.view().items[0].version,1);
  store.upsert({batchId:'three',items:[{...item(),obligationKey:'synthetic:other'}]});
  assert.equal(store.view().items.length,2);
});
for(const action of ['complete','dismiss','snooze'] as const)test(`${action} survives newer, older, exact replay and restart`,t=>{
  const fixture=setup(t);let store=fixture.store;
  const batch={batchId:'initial',items:[item()]};store.upsert(batch);
  const decision={id:item().obligationKey,operationId:'choice',expectedVersion:1,action,
    ...(action==='snooze'?{snoozedUntil:'2026-10-19T12:00:00.000Z'}:{})};
  store.decide(decision);
  store.upsert({batchId:'newer',items:[item(2)]});
  store.upsert({batchId:'older',items:[item()]});
  assert.equal(store.upsert(batch).items[0].userDecision,action);
  store=fixture.restart();
  assert.equal(store.view().items[0].state,{complete:'done',dismiss:'dismissed',snooze:'snoozed'}[action]);
  assert.equal(store.decide(decision).receipt?.duplicate,true);
  assert.equal(store.view().items[0].version,3);
});
test('reused receipt IDs with changed input fail without writes',t=>{
  const {store}=setup(t);store.upsert({batchId:'same',items:[item()]});
  assert.throws(()=>store.upsert({batchId:'same',items:[item(2)]}),/different input/);
  assert.equal(store.view().items[0].sourceVersion,1);
});
test('two connections enforce version conflicts and preserve the winning user decision',t=>{
  const {store,path}=setup(t);const second=new SauronStore(path,()=>new Date(instant));t.after(()=>second.close());
  store.upsert({batchId:'a',items:[item()]});
  store.decide({id:item().obligationKey,operationId:'first',expectedVersion:1,action:'complete'});
  assert.throws(()=>second.decide({id:item().obligationKey,operationId:'second',expectedVersion:1,action:'dismiss'}),/another view/);
  assert.equal(second.view().items[0].state,'done');
});
test('changed source facts require newer versions, and a bad batch rolls back completely',t=>{
  const {store}=setup(t);store.upsert({batchId:'a',items:[item()]});
  assert.throws(()=>store.upsert({batchId:'bad',items:[{...item(),obligationKey:'synthetic:new'}, {...item(),title:'Changed'}]}),/newer sourceVersion/);
  assert.equal(store.view().items.length,1);
  assert.equal(store.upsert({batchId:'bad',items:[item(2)]}).receipt?.duplicate,false);
});
test('strict synthetic boundary rejects live URLs, unsupported providers, extra decisions and future verification',t=>{
  const {store}=setup(t);
  for(const patch of [{provider:'gmail'},{provider:'slack'},{sourceUrl:'https://jira.example.com/work'},{userDecision:'complete'},{lastCheckedAt:'2030-01-01T00:00:00Z'}])
    assert.throws(()=>store.upsert({batchId:'x',items:[{...item(),...patch}]}));
  assert.equal(store.view().items.length,0);
});
test('Waiting, last checked, and database update time are independent',t=>{
  const fixture=setup(t);const {store}=fixture;
  store.upsert({batchId:'a',items:[{...item(),sourceState:'waiting',lastCheckedAt:'2026-10-17T12:00:00Z'}]});
  assert.equal(store.view().items[0].state,'waiting');
  assert.equal(store.view().items[0].lastCheckedAt,'2026-10-17T12:00:00.000Z');
  assert.equal(store.view().items[0].updatedAt,instant);
});
test('snooze uses an absolute instant across Madrid DST; repeated operation does not extend it',t=>{
  const fixture=setup(t);fixture.setTime('2026-10-25T00:30:00Z');
  const {store}=fixture;store.upsert({batchId:'a',items:[item()]});
  const op={id:item().obligationKey,operationId:'snooze',expectedVersion:1,action:'snooze',snoozedUntil:'2026-10-25T01:30:00Z'};
  store.decide(op);fixture.setTime('2026-10-25T01:00:00Z');store.decide(op);
  assert.equal(store.view().items[0].state,'snoozed');
  fixture.setTime('2026-10-25T01:30:00Z');assert.equal(store.view().items[0].state,'needs_you');
});
test('killing a process with an uncommitted write leaves the previous committed task intact',async t=>{
  const {store,path}=setup(t);store.upsert({batchId:'a',items:[item()]});
  const child=spawn(process.execPath,['--input-type=module','-e',`
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE; DELETE FROM tasks;');
    console.log('uncommitted');process.stdin.resume();
  `,path],{stdio:['pipe','pipe','pipe']});
  await new Promise<void>((resolve,reject)=>{child.stdout.once('data',()=>resolve());child.once('error',reject);});
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
  assert.equal(store.view().items.length,1);
});

test('personal creation retries deduplicate after restart and completed personal tasks stay completed',t=>{
  const fixture=setup(t);let store=fixture.store;
  const input={operationId:'374a2028-0e95-4baf-a6e7-cbdb42ee90ad',title:'  Plan my week  ',nextAction:'Choose three priorities.',sourceState:'needs_you'};
  const created=store.createPersonal(input);assert.equal(created.syntheticOnly,false);
  const task=created.items[0];assert.equal(task.title,'Plan my week');assert.equal(task.provider,'personal');
  assert.equal(task.sourceUrl,null);assert.equal(task.lastCheckedAt,null);assert.equal(task.createdAt,instant);
  assert.equal(store.createPersonal(input).receipt?.duplicate,true);
  store.decide({id:task.id,operationId:'finish-personal',expectedVersion:1,action:'complete'});
  store=fixture.restart();
  const replay=store.createPersonal(input);assert.equal(replay.receipt?.duplicate,true);assert.equal(replay.items.length,1);assert.equal(replay.items[0].state,'done');
  assert.throws(()=>store.createPersonal({...input,title:'Different title'}),/different input/);
  assert.throws(()=>store.upsert({batchId:'overwrite-personal',items:[{...item(),obligationKey:task.id}]}));
  assert.equal(store.view().items[0].state,'done');
});
test('personal tasks validate text and allow identical titles as distinct user tasks',t=>{
  const {store}=setup(t);const input={operationId:'374a2028-0e95-4baf-a6e7-cbdb42ee90ad',title:'Same title'};
  for(const patch of [{title:'  '},{title:'x'.repeat(161)},{nextAction:'x'.repeat(401)},{provider:'slack'},{sourceUrl:'https://slack.com'},{operationId:'invalid'}])assert.throws(()=>store.createPersonal({...input,...patch}));
  assert.equal(store.view().items.length,0);
  store.createPersonal(input);
  store.createPersonal({...input,operationId:'90270f03-663a-4de1-a012-d6ae91d0d98f',sourceState:'waiting'});
  assert.equal(store.view().items.length,2);assert.equal(store.view().items.find(t=>t.sourceState==='waiting')?.state,'waiting');
});
test('source labels remain synthetic and older receipts replay unchanged',t=>{
  const {store}=setup(t);const input={batchId:'old-receipt',items:[item()]};store.upsert(input);
  assert.equal(store.upsert(input).receipt?.duplicate,true);
  for(const kind of ['slack','jira','github','calendar','meeting'] as const)store.upsert({batchId:kind,items:[{...item(),obligationKey:'synthetic:'+kind,sourceKind:kind}]});
  assert.equal(store.view().items.length,6);assert.equal(store.view().syntheticOnly,true);
  assert.throws(()=>store.upsert({batchId:'live',items:[{...item(),sourceKind:'slack',sourceUrl:'https://example.slack.com/channel'}]}));
});

for(const action of ['complete','dismiss','snooze'] as const)test(`explicit reopen reverses ${action}, deduplicates retries and survives replay/restart`,t=>{
  const fixture=setup(t);const store=fixture.store;
  store.upsert({batchId:'waiting',items:[{...item(),sourceState:'waiting'}]});
  store.decide({id:item().obligationKey,operationId:'original',expectedVersion:1,action,
    ...(action==='snooze'?{snoozedUntil:'2026-10-19T12:00:00.000Z'}:{})});
  store.upsert({batchId:'new-context',items:[{...item(2),sourceState:'waiting'}]});
  const operation={id:item().obligationKey,operationId:'reopen',expectedVersion:3,action:'reopen'};
  const task=store.decide(operation).items[0];
  assert.equal(task.state,'waiting');assert.equal(task.userDecision,null);
  assert.equal(task.decidedAt,null);assert.equal(task.snoozedUntil,null);
  assert.equal(store.decide(operation).receipt?.duplicate,true);
  store.upsert({batchId:'replay',items:[{...item(2),sourceState:'waiting'}]});
  assert.equal(fixture.restart().view().items[0].state,'waiting');
});
test('stale reopen cannot overwrite a newer decision',t=>{
  const {store}=setup(t);store.upsert({batchId:'a',items:[item()]});
  store.decide({id:item().obligationKey,operationId:'complete',expectedVersion:1,action:'complete'});
  assert.throws(()=>store.decide({id:item().obligationKey,operationId:'stale-reopen',expectedVersion:1,action:'reopen'}),/another view/);
  assert.equal(store.view().items[0].state,'done');
});

test('retired layout metadata is removed without changing tasks, receipts, history or scans',t=>{
  const {store,path,restart}=setup(t);
  store.upsert({batchId:'keep-source',items:[item()]});
  store.decide({id:item().obligationKey,operationId:'keep-decision',expectedVersion:1,action:'complete'});
  const before=store.view();
  const db=new DatabaseSync(path);
  const snapshot=()=>JSON.stringify(['tasks','receipts','history','metadata'].map(table=>db.prepare('SELECT * FROM '+table+" WHERE "+(table==='metadata'?"key!='ui_layout'":'1')+' ORDER BY 1').all()));
  const saved=snapshot();
  db.prepare("INSERT INTO metadata VALUES ('ui_layout','original')").run();
  const reopened=restart();
  assert.deepEqual(reopened.view(),before);
  assert.equal('uiLayout' in reopened.view(),false);
  assert.equal(db.prepare("SELECT value FROM metadata WHERE key='ui_layout'").get(),undefined);
  assert.equal(snapshot(),saved);db.close();
});
