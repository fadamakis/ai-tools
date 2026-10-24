import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SauronStore } from '../src/server/store.js';
import { scanOutputJsonSchema, type ScanOutput } from '../src/shared/contracts.js';
const item={provider:'slack' as const,sourceUrl:'https://example.slack.com/archives/C123/p1792313076000000',actionKey:'Please review the release plan',title:'Review the release plan',nextAction:'Check the plan and reply in the thread.',sourceState:'needs_you' as const,resolved:false};
const checked={status:'checked' as const,detail:'Read current requests and relevant replies.'};
const output=(items=[item]):ScanOutput=>({sources:{slack:checked,granola:checked},items});
function setup(t:any){const dir=mkdtempSync(join(tmpdir(),'sauron-scan-test-'));let now=new Date('2026-10-18T17:00:00Z');const path=join(dir,'store.sqlite');const store=new SauronStore(path,()=>now);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return {store,path,setTime:(date:string)=>{now=new Date(date);}};}
test('one durable active scan across connections; reopening joins it',t=>{
 const {store,path}=setup(t);assert.equal(statSync(path).mode&0o777,0o600);const first=store.beginScan();assert.equal(first.started,true);
 const second=new SauronStore(path,()=>new Date('2026-10-18T17:00:00Z'));
 try{assert.deepEqual(second.beginScan(),{run:first.run,started:false});assert.equal(second.view().scan?.status,'running');}finally{second.close();}
 store.finishScan(first.run.id,output());assert.equal(store.view().scan?.status,'completed');
 assert.notEqual(store.beginScan().run.id,first.run.id);
});
test('source replay preserves all user decisions and stable identity despite a new title',t=>{
 const {store}=setup(t);let run=store.beginScan().run;let view=store.finishScan(run.id,output());const id=view.items[0].id;
 assert.match(id,/^slack:[a-f0-9]{64}$/);assert.equal(view.syntheticOnly,false);
 store.decide({id,expectedVersion:view.items[0].version,action:'complete',operationId:'complete'});
 run=store.beginScan().run;view=store.finishScan(run.id,output([{...item,title:'Review updated release plan'}]));
 assert.equal(view.items.length,1);assert.equal(view.items[0].state,'done');assert.equal(view.items[0].title,'Review updated release plan');
 assert.equal(store.finishScan(run.id,output([{...item,title:'Review updated release plan'}])).receipt?.duplicate,true);
 store.decide({id,expectedVersion:view.items[0].version,action:'reopen',operationId:'reopen'});
 store.decide({id,expectedVersion:view.items[0].version+1,action:'snooze',snoozedUntil:'2026-10-19T17:00:00Z',operationId:'snooze'});
 run=store.beginScan().run;view=store.finishScan(run.id,output());assert.equal(view.items[0].state,'snoozed');
});
test('partial and empty scans retain earlier tasks; failure cannot produce verified items',t=>{
 const {store}=setup(t);store.finishScan(store.beginScan().run.id,output());
 const partial:ScanOutput={sources:{slack:{status:'failed',detail:'Authorization required'},granola:checked},items:[]};
 const run=store.beginScan().run;assert.throws(()=>store.finishScan(run.id,{...partial,items:[item]}));
 assert.equal(store.view().scan?.status,'running');
 const view=store.finishScan(run.id,partial);assert.equal(view.scan?.status,'partial');assert.equal(view.items.length,1);
 const empty=store.finishScan(store.beginScan().run.id,output([]));assert.equal(empty.items.length,1);
});
test('abandoned scan expires and late results cannot overwrite the new scan',t=>{
 const {store,setTime}=setup(t);const abandoned=store.beginScan().run;
 setTime('2026-10-18T17:13:00Z');assert.equal(store.view().scan?.status,'failed');
 const next=store.beginScan().run;assert.throws(()=>store.finishScan(abandoned.id,output()));
 assert.equal(store.view().scan?.id,next.id);assert.equal(store.view().items.length,0);
 store.failScan(next.id,'Runtime unavailable');assert.equal(store.view().scan?.error,'Runtime unavailable');
});
test('provider links are constrained and explicit source resolution is distinct from user completion',t=>{
 const {store}=setup(t);const run=store.beginScan().run;
 for(const sourceUrl of ['https://evil.test/archives/C123/p1792313076000000','https://example.slack.com.evil.test/archives/C123/p1792313076000000','https://user@example.slack.com/archives/C123/p1792313076000000'])assert.throws(()=>store.finishScan(run.id,output([{...item,sourceUrl}])));
 const view=store.finishScan(run.id,output([{...item,resolved:true}]));assert.equal(view.items[0].state,'done');assert.equal(view.items[0].userDecision,null);
});

test('runtime output schema omits unsupported URI format while local URL validation remains strict',()=>{
 const schema=scanOutputJsonSchema();assert.equal(JSON.stringify(schema).includes('"format":"uri"'),false);
 assert.equal(schema.additionalProperties,false);
});
