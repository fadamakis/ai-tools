import {SauronStore} from '../../src/server/store.js';
import type {ProposalChange} from '../../src/shared/review-contracts.js';
import { test,expect, type Page, type APIRequestContext } from '@playwright/test';
import { build } from 'esbuild';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync,rmSync,writeFileSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { syntheticObservation, type Result } from '../../src/shared/contracts.js';
import { contrastRatio } from '../../../../tests/ui/contrast.mjs';
let child:ChildProcess,dir:string,origin:string;let port=4850;
test.beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),'sauron-inbox-test-'));origin=`http://127.0.0.1:${++port}`;
  const runtime=join(dir,'runtime.cjs');
  writeFileSync(runtime,`#!/usr/bin/env node\nconst fs=require('node:fs');setTimeout(()=>fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify({sources:{slack:{status:'checked',detail:'Fixture only'},granola:{status:'checked',detail:'Fixture only'}},items:[]})),2200);`,{mode:0o700});
  child=spawn(process.execPath,['dist/server/preview.js'],{env:{...process.env,PORT:String(port),ATTENTION_DB:join(dir,'test.sqlite'),SAURON_CODEX_BIN:runtime},stdio:['ignore','pipe','pipe']});
  await new Promise<void>((resolve,reject)=>{let stderr='';child.stderr!.on('data',data=>{stderr+=String(data);if(stderr.includes('Sauron preview:'))resolve();});child.once('error',reject);child.once('exit',code=>reject(Error(`Preview exited ${code}: ${stderr}`)));});
});
test.afterEach(async()=>{if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});});
async function call(request:APIRequestContext,name:string,args:unknown={}):Promise<Result>{const res=await request.post(origin+'/api/tool',{data:{name,arguments:args}});expect(res.ok()).toBeTruthy();return res.json();}
async function open(page:Page){await page.goto(origin);await expect(page.getByRole('button',{name:'Add task',exact:true})).toBeEnabled();}
async function add(request:APIRequestContext,title='Review launch notes'){return call(request,'create_personal_task',{title,nextAction:'Decide the next step after reviewing the meeting notes.',sourceState:'needs_you',operationId:crypto.randomUUID()});}

async function retain(page:Page,value:unknown){await page.evaluate(value=>sessionStorage.setItem('sauron:organisation-pending:v1',JSON.stringify(value)),value);await page.reload();}
function change(view:Result,storeId=view.storeId){return {storeId,request:{operationId:crypto.randomUUID(),expectedStoreId:storeId,expectedRevision:view.taskViewRevision??0,action:'topics',id:view.items[0].id,topics:['PRIVATE topic']}};}
test('ER-05 another database explains blocked recovery and dismissal never sends or undoes a change',async({page,request})=>{
 const view=await add(request,'PRIVATE task');await open(page);const before=await call(request,'list_attention');
 let sent=0;page.on('request',req=>{if(req.url().endsWith('/api/tool')&&req.postDataJSON().name==='organise_attention_task')sent++;});
 await retain(page,change(view,crypto.randomUUID()));
 const recovery=page.getByRole('alert',{name:'Save recovery'});await expect(recovery).toContainText('different task list');
 await expect(recovery.getByRole('button',{name:'Retry save'})).toHaveCount(0);
 await recovery.getByRole('button',{name:'Dismiss old request'}).click();await expect(recovery).toHaveCount(0);expect(sent).toBe(0);
 expect((await call(request,'list_attention')).items).toEqual(before.items);
 await page.getByRole('button',{name:'Diagnostics',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('wrong_store');
});
test('ER-06 conflicts preserve intent and require explicit reviewed reapplication',async({page,request})=>{
 const view=await add(request,'Task with concurrent edit'),pending=change(view);await add(request,'Concurrent task');await open(page);
 await retain(page,pending);const recovery=page.getByRole('alert',{name:'Save recovery'});
 await recovery.getByRole('button',{name:'Retry save',exact:true}).click();await expect(recovery).toContainText('saved information changed');
 await page.reload();await expect(recovery.getByRole('button',{name:'Review latest tasks'})).toBeVisible();await expect(recovery.getByRole('button',{name:'Retry save'})).toHaveCount(0);
 let failLatest=true;await page.route('**/api/tool',async route=>{const body=route.request().postDataJSON();if(failLatest&&body.name==='list_attention'&&!body.arguments.checkSave){failLatest=false;await route.abort();}else await route.continue();});
 await recovery.getByRole('button',{name:'Review latest tasks'}).click();await expect(recovery).toContainText('Couldn’t load the latest saved state');await expect(recovery.getByRole('button',{name:'Retry save'})).toHaveCount(0);
 await recovery.getByRole('button',{name:'Review latest tasks'}).click();await expect(recovery).toContainText('PRIVATE topic');
 expect((await call(request,'list_attention')).topics??[]).toHaveLength(0);
 await recovery.getByRole('button',{name:'Apply reviewed change'}).click();await expect(recovery).toHaveCount(0);
 expect((await call(request,'list_attention')).topics?.map(topic=>topic.name)).toContain('PRIVATE topic');
});
test('ER-07 committed task organisation save is confirmed by receipt after a lost response',async({page,request})=>{
 const view=await add(request),pending=change(view);await open(page);await retain(page,pending);
 let writes=0;await page.route('**/api/tool',async route=>{if(route.request().postDataJSON().name==='organise_attention_task'){writes++;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Retry save',exact:true}).click();await expect(page.getByRole('alert',{name:'Save recovery'})).toBeVisible();
 await page.reload();await expect(page.getByRole('alert',{name:'Save recovery'})).toHaveCount(0);expect(writes).toBe(1);
 const db=new DatabaseSync(join(dir,'test.sqlite'));try{expect(db.prepare("SELECT count(*) AS n FROM history WHERE operation_id=?").get(pending.request.operationId)?.n).toBe(1);}finally{db.close();}
});
test('ER-08 malformed pending data is dismissible and blocked storage does not invent a failed save',async({page})=>{
 await open(page);await page.evaluate(()=>sessionStorage.setItem('sauron:organisation-pending:v1','{broken'));await page.reload();
 const recovery=page.getByRole('alert',{name:'Save recovery'});await expect(recovery).toContainText('could not be read');await recovery.getByRole('button',{name:'Dismiss retry'}).click();await expect(recovery).toHaveCount(0);
 await page.addInitScript(()=>{Object.defineProperty(window,'sessionStorage',{get(){throw Error('unavailable');}});});await page.reload();
 await expect(page.getByRole('button',{name:'Add task',exact:true})).toBeEnabled();await expect(recovery).toHaveCount(0);
});
test('ER-09 diagnostics handle denied clipboard access and exclude task content at narrow widths',async({page,request},testInfo)=>{
 const view=await add(request,'PRIVATE task');await page.setViewportSize({width:375,height:850});await open(page);await retain(page,change(view,crypto.randomUUID()));
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(Error('denied'))},configurable:true}));
 await page.getByRole('button',{name:'Diagnostics',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Copy error details'}).click();
 await expect(dialog.getByRole('alert')).toContainText('Couldn’t copy');const report=dialog.getByRole('textbox',{name:'Diagnostic report'});await expect(report).toBeVisible();
 expect(await report.inputValue()).not.toContain('PRIVATE');expect(await report.inputValue()).toContain('wrong_store');
 expect(await page.locator('html').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('recovery-diagnostics-375.png'),fullPage:true});
});

test('ER-01 ER-08 older requests without store identity are receipt-checked but never blindly replayed',async({page,request})=>{
 await open(page);const input={operationId:crypto.randomUUID(),title:'An old retained task',nextAction:'',sourceState:'needs_you'};
 await page.evaluate(input=>sessionStorage.setItem('attention:pending:v2',JSON.stringify({kind:'create',input})),input);await page.reload();
 const recovery=page.getByRole('alert',{name:'Save recovery'});await expect(recovery).toContainText('does not identify its task list');await expect(recovery.getByRole('button',{name:'Retry save'})).toHaveCount(0);
 expect((await call(request,'list_attention')).items).toHaveLength(0);
 await recovery.getByRole('button',{name:'Dismiss old request'}).click();await call(request,'create_personal_task',input);
 await page.evaluate(input=>sessionStorage.setItem('attention:pending:v2',JSON.stringify({kind:'create',input})),input);await page.reload();
 await expect(recovery).toHaveCount(0);expect((await call(request,'list_attention')).items).toHaveLength(1);
});

test('ER-07 rapid repeated creation with a lost response retains the original request',async({page,request})=>{
 await open(page);await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Task name',{exact:true}).fill('One retained task');
 const operations:string[]=[];await page.route('**/api/tool',async route=>{const body=route.request().postDataJSON();if(body.name==='create_personal_task'){operations.push(body.arguments.operationId);await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Save task',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
 await expect(page.getByRole('alert',{name:'Save recovery'})).toBeVisible();await page.reload();await expect(page.getByRole('alert',{name:'Save recovery'})).toHaveCount(0);
 expect(operations).toHaveLength(1);expect((await call(request,'list_attention')).items.filter(task=>task.title==='One retained task')).toHaveLength(1);
});

test('ER-06 healthy background reads clear connection errors without discarding an unresolved save',async({page,request})=>{
 const view=await add(request);await open(page);let failReads=true,failWrites=true;
 await page.route('**/api/tool',async route=>{const body=route.request().postDataJSON();if(body.name==='list_attention'&&failReads||body.name==='organise_attention_task'&&failWrites)await route.abort();else await route.continue();});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText('Couldn’t load the latest tasks. Your current view may be out of date. Reload tasks or reconnect Sauron.',{exact:true})).toBeVisible();
 failReads=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText('Couldn’t load the latest tasks. Your current view may be out of date. Reload tasks or reconnect Sauron.',{exact:true})).toHaveCount(0);
 await retain(page,change(view));const recovery=page.getByRole('alert',{name:'Save recovery'});await recovery.getByRole('button',{name:'Retry save'}).click();await expect(recovery).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(recovery).toBeVisible();expect((await call(request,'list_attention')).topics??[]).toHaveLength(0);
});

test('ER-06 a closed move destination explains why reapplication is unavailable',async({page,request})=>{
 await add(request,'Task to move');const view=await add(request,'Closed parent');const task=view.items.find(task=>task.title==='Task to move')!,parent=view.items.find(task=>task.title==='Closed parent')!;
 const pending={storeId:view.storeId,request:{operationId:crypto.randomUUID(),expectedStoreId:view.storeId,expectedRevision:view.taskViewRevision??0,action:'move',id:task.id,parentId:parent.id}};
 await call(request,'decide_attention_item',{operationId:crypto.randomUUID(),id:parent.id,expectedVersion:parent.version,action:'complete'});await open(page);await retain(page,pending);
 const recovery=page.getByRole('alert',{name:'Save recovery'});await recovery.getByRole('button',{name:'Retry save'}).click();await recovery.getByRole('button',{name:'Review latest tasks'}).click();
 await expect(recovery).toContainText('no longer applies');await expect(recovery.getByRole('button',{name:'Apply reviewed change'})).toHaveCount(0);await expect(recovery.getByRole('button',{name:'Review latest tasks'})).toHaveCount(0);
 await recovery.getByRole('button',{name:'Dismiss retry'}).click();expect((await call(request,'list_attention')).items.find(item=>item.id===task.id)?.parentId).toBeNull();
});
