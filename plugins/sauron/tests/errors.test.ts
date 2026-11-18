import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SauronStore,StoreError} from '../src/server/store.js';
import {serverErrorDetail} from '../src/server/errors.js';
import {errorDetail,PanelError,readErrorDetail} from '../src/shared/errors.js';
import {createDiagnostics,requestCorrelation} from '../src/app/diagnostics.js';
import {personalTaskSchema} from '../src/shared/contracts.js';
import {invoke} from '../src/server/service.js';

test('ER-01 lost responses use matching receipts rather than matching task values',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sauron-errors-')),path=join(dir,'copy.sqlite');let store=new SauronStore(path);
 try{
  const payload=personalTaskSchema.parse({operationId:randomUUID(),title:'Saved task'});
  const saved=store.createPersonal(payload),check={expectedStoreId:store.storeId,id:'personal:'+payload.operationId,payload};
  assert.equal(invoke(store,'list_attention',{checkSave:check}).receipt?.id,check.id);
  assert.equal(invoke(store,'list_attention',{checkSave:{...check,id:'personal:'+randomUUID()}}).receipt,undefined);
  assert.equal(invoke(store,'list_attention',{checkSave:{...check,payload:{...payload,title:'Different input'}}}).receipt,undefined);
  store.close();store=new SauronStore(path);assert.deepEqual(store.view().items,saved.items);
  assert.equal(store.createPersonal(payload).receipt?.duplicate,true);
  assert.throws(()=>store.checkSave({...check,expectedStoreId:randomUUID()}));
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('ER-02 only validated rejection or confirmed rollback claims a save was rejected',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sauron-errors-'));const store=new SauronStore(join(dir,'test.sqlite'));
 try{
  const saved=store.createPersonal({operationId:randomUUID(),title:'Task'}),task=saved.items[0];
  try{store.organiseTask({operationId:randomUUID(),expectedStoreId:store.storeId,expectedRevision:saved.taskViewRevision!-1,id:task.id,action:'topics',topics:['topic']});assert.fail();}
  catch(error){assert.deepEqual(serverErrorDetail(error),{category:'conflict',outcome:'rejected'});}
  assert.deepEqual(serverErrorDetail(new StoreError('conflict','raw private message')),{category:'conflict',outcome:'unconfirmed'});
  assert.deepEqual(errorDetail(Error('network disconnected')),{category:'unknown',outcome:'unconfirmed'});
  assert.deepEqual(readErrorDetail({category:'private error',outcome:'saved'}),{category:'unknown',outcome:'unconfirmed'});
  assert.equal(errorDetail(new PanelError({category:'wrong_store',outcome:'rejected'})).category,'wrong_store');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('ER-03 diagnostics are bounded, redact inputs and retain active failures independently',()=>{
 let raw='';const storage={getItem:()=>raw||null,setItem:(_key:string,value:string)=>{raw=value;}};
 const log=createDiagnostics(storage),id='diag-'+randomUUID();
 log.record('task_change','failed',id,'conflict','rejected');
 for(let i=0;i<105;i++)log.record('tasks','saved','diag-'+randomUUID(),'unknown','saved');
 assert.equal(log.snapshot().history.length,100);assert.equal(log.snapshot().active.length,1);
 const data=JSON.parse(raw);data.history.push({...data.history[0],request:{title:'PRIVATE',reply:'SECRET'},message:'PRIVATE'});data.active.task_change.message='SECRET';raw=JSON.stringify(data);
 const reopened=createDiagnostics(storage);reopened.record('sources','saved','diag-'+randomUUID(),'unknown','saved');
 assert.ok(!raw.includes('PRIVATE'));assert.ok(!raw.includes('SECRET'));
 reopened.record('task_change','dismissed',id);assert.equal(reopened.snapshot().active.length,0);
});
test('ER-04 polling failures deduplicate across unrelated events and storage failure is harmless',()=>{
 const log=createDiagnostics({getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('quota');}}),id='diag-'+randomUUID();
 log.record('tasks','failed',id,'connection');log.record('sources','saved','diag-'+randomUUID(),'unknown','saved');log.record('tasks','failed',id,'connection');
 assert.equal(log.snapshot().history.length,2);assert.equal(log.snapshot().active[0].count,2);
 log.record('tasks','saved',id,'unknown','saved');assert.equal(log.snapshot().active.length,0);
 log.record('tasks','failed',id,'connection');assert.equal(log.snapshot().active[0].count,1);
});

test('ER-04 retry and transport diagnostics share an opaque correlation without exporting operation IDs',()=>{
 const operationId=randomUUID();const direct=requestCorrelation('task_change',{operationId});
 assert.equal(requestCorrelation('task_change',{request:{operationId}}),direct);
 assert.ok(!direct.includes(operationId));assert.notEqual(requestCorrelation('task_change',{operationId:randomUUID()}),direct);
});
