import { test,expect, type Page, type APIRequestContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { syntheticObservation, type Result } from '../../src/shared/contracts.js';

let processHandle:ChildProcess;let dir:string;let dbPath:string;let origin:string;let port=4418;
async function start(){
  const runtime=join(dir,'runtime.cjs');
  writeFileSync(runtime,`#!/usr/bin/env node\nconst fs=require('node:fs');setTimeout(()=>{fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify({sources:{slack:{status:'checked',detail:'Test fixture'},granola:{status:'checked',detail:'Test fixture'}},items:[]}));},2200);`,{mode:0o700});
  processHandle=spawn(process.execPath,['dist/server/preview.js'],{
    env:{...process.env,PORT:String(port),ATTENTION_DB:dbPath,SAURON_CODEX_BIN:runtime},stdio:['ignore','pipe','pipe']});
  await new Promise<void>((resolve,reject)=>{
    let diagnostic='';
    processHandle.stderr!.on('data',chunk=>{diagnostic+=String(chunk);if(String(chunk).includes('Sauron preview:'))resolve();});
    processHandle.once('error',reject);processHandle.once('exit',code=>{if(code)reject(Error('Preview exited '+code+': '+diagnostic));});
  });
}
async function stop(){if(processHandle?.exitCode===null){const exited=once(processHandle,'exit');processHandle.kill('SIGTERM');await exited;}}
test.beforeEach(async()=>{port++;origin=`http://127.0.0.1:${port}`;dir=mkdtempSync(join(tmpdir(),'attention-ui-'));dbPath=join(dir,'ui.sqlite');await start();});
test.afterEach(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
async function open(page:Page){mkdirSync('docs/evidence/inbox-0.5.0',{recursive:true});await page.goto(origin);await expect(page.getByRole('button',{name:'Add task',exact:true})).toBeEnabled();}
async function diagnostics(page:Page, action:string){
  await page.getByRole('button',{name:'Diagnostics',exact:true}).click();
  await page.getByRole('button',{name:action,exact:true}).click();
  await page.getByRole('button',{name:'Close diagnostics'}).click();
}
async function filterSource(page:Page,label:string){
  await page.getByRole('button',{name:/^Filter by source:/}).click();
  await page.getByRole('option',{name:label,exact:true}).click();
}
async function action(page:Page,name:string){await page.getByRole('button',{name:/^Actions for /}).click();await page.getByRole('menuitem',{name,exact:true}).click();}
async function seed(page:Page){await diagnostics(page,'Create synthetic task');await expect(page.getByRole('button',{name:/^Complete /})).toBeVisible();}
async function history(page:Page, state='done'){
  await page.getByRole('button',{name:/^History /}).click();
  if(state==='dismissed')await page.getByRole('radio',{name:/^Dismissed /}).click();
}
async function call(request:APIRequestContext,name:string,args:unknown={}):Promise<Result>{
  const res=await request.post(origin+'/api/tool',{data:{name,arguments:args}});expect(res.ok()).toBeTruthy();return res.json();
}
test('complete in app, replay incoming update, restart process, remain Done',async({page,request})=>{
  await open(page);await seed(page);
  await expect(page.getByLabel('Manual sample task',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Complete /}).click();
  await history(page);
  await expect(page.getByRole('heading',{name:'Review the synthetic launch note',exact:true})).toBeVisible();
  await diagnostics(page,'Replay incoming update');
  await expect(page.locator('.inbox-context').getByText('A repeated check still asks for review.')).not.toBeVisible();
  await page.locator('.inbox-task-open').click();
  await expect(page.getByText('Latest sample context',{exact:true})).toBeVisible();
  await expect(page.locator('.inbox-context').getByText('A repeated check still asks for review.')).toBeVisible();
  await expect(page.getByText('Your completion is saved. Source updates do not reopen this task.')).toBeVisible();
  await expect(page.getByRole('button',{name:/^History 1/})).toBeVisible();
  await stop();await start();await page.reload();await history(page);
  await expect(page.getByRole('heading',{name:'Review the synthetic launch note',exact:true})).toBeVisible();
  const view=await call(request,'list_attention');expect(view.items).toHaveLength(1);expect(view.items[0].state).toBe('done');
  mkdirSync('docs/evidence',{recursive:true});
  writeFileSync('docs/evidence/inbox-0.5.0/persistence-receipt.json',JSON.stringify({
    check:'Browser completion → newer incoming observation → real preview-process restart → authoritative read',
    ...view,
  },null,2)+'\n');
  await page.screenshot({path:'docs/evidence/inbox-0.5.0/completed-after-restart.png',fullPage:true,animations:'disabled'});
});
test('repeated clicks save exactly one user decision',async({page})=>{
  await open(page);await seed(page);
  await page.getByRole('button',{name:/^Complete /}).evaluate(button=>{for(let i=0;i<8;i++)(button as HTMLButtonElement).click();});
  await expect(page.getByRole('button',{name:/^History 1/})).toBeVisible();
  const db=new DatabaseSync(dbPath);try{const row=db.prepare("SELECT count(*) AS count FROM history WHERE kind='complete'").get();expect(row?.count).toBe(1);}finally{db.close();}
});
test('cancelled dismissal sends no save; confirmed dismissal survives replay',async({page,request})=>{
  await open(page);await seed(page);await action(page,'Dismiss');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await call(request,'list_attention')).items[0].userDecision).toBeNull();
  await action(page,'Dismiss');await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await action(page,'Dismiss');await page.getByRole('button',{name:'Confirm dismiss'}).click();
  await diagnostics(page,'Replay incoming update');
  await history(page,'dismissed');
  await expect(page.getByRole('heading',{name:'Review the synthetic launch note',exact:true})).toBeVisible();
});
test('save lost before delivery remains retryable after reload',async({page,request})=>{
  await open(page);await seed(page);
  await page.route('**/api/tool',async route=>{
    if(route.request().postDataJSON().name==='decide_attention_item')await route.abort();else await route.continue();
  });
  await page.getByRole('button',{name:/^Complete /}).click();await expect(page.getByRole('alert')).toBeVisible();
  expect((await call(request,'list_attention')).items[0].state).toBe('needs_you');
  await page.unroute('**/api/tool');await page.reload();await expect(page.getByText('Check an interrupted save')).toBeVisible();
  await page.getByRole('button',{name:'Retry decision'}).click();
  await expect(page.getByRole('button',{name:/^History 1/})).toBeVisible();
});
test('committed save with lost response is reconciled on reload',async({page,request})=>{
  await open(page);await seed(page);
  await page.route('**/api/tool',async route=>{
    if(route.request().postDataJSON().name==='decide_attention_item'){await route.fetch();await route.abort();}else await route.continue();
  });
  await page.getByRole('button',{name:/^Complete /}).click();await expect(page.getByRole('alert')).toBeVisible();
  expect((await call(request,'list_attention')).items[0].state).toBe('done');
  await page.unroute('**/api/tool');await page.reload();
  await expect(page.getByText('Check an interrupted save')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^History 1/})).toBeVisible();
});
test('snooze survives replay; Waiting and source links render; layouts fit narrow and wide screens',async({page,request})=>{
  await open(page);await seed(page);await action(page,'Snooze 1 hour');
  await diagnostics(page,'Replay incoming update');await page.getByRole('button',{name:/^Snoozed /}).click();
  await expect(page.getByRole('heading',{name:'Review the synthetic launch note',exact:true})).toBeVisible();
  await call(request,'upsert_attention_items',{batchId:'waiting',items:[{...syntheticObservation(),obligationKey:'synthetic:waiting',sourceState:'waiting',title:'Wait for the synthetic reviewer'}]});
  await page.getByRole('button',{name:'Refresh'}).click();await page.getByRole('radio',{name:/^Waiting /}).click();
  await expect(page.getByRole('heading',{name:'Wait for the synthetic reviewer',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Wait for the synthetic reviewer/}).click();
  await expect(page.getByRole('button',{name:'Open sample source'})).toBeVisible();
  for(const width of [375,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
  await page.emulateMedia({colorScheme:'dark'});await expect(page.getByRole('button',{name:/^Complete /})).toBeVisible();
});
test('preview rejects cross-origin writes, wrong Host and oversized bodies',async({request})=>{
  const cross=await request.post(origin+'/api/tool',{headers:{Origin:'https://example.invalid'},data:{name:'list_attention',arguments:{}}});expect(cross.status()).toBe(403);
  const host=await request.get(origin,{headers:{Host:'evil.invalid'}});expect(host.status()).toBe(403);
  const huge=await request.post(origin+'/api/tool',{data:{padding:'x'.repeat(33_000)}});expect(huge.status()).toBe(400);
});

test('personal task form validates, cancels, preserves drafts, and submits rapid clicks once',async({page,request})=>{
  await open(page);
  await page.getByRole('button',{name:'Add task',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save task'})).toBeDisabled();
  await page.getByLabel('Task name',{exact:true}).fill('  ');
  await expect(page.getByRole('button',{name:'Save task'})).toBeDisabled();
  await page.getByLabel('Task name',{exact:true}).fill('Discard this draft');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await call(request,'list_attention')).items).toHaveLength(0);
  await page.getByRole('button',{name:'Add task',exact:true}).click();
  await expect(page.getByLabel('Task name',{exact:true})).toHaveValue('');
  await page.getByLabel('Task name',{exact:true}).fill('Plan my week');
  await page.getByLabel('Notes (optional)',{exact:true}).fill('Choose three priorities.');
  await page.reload();
  await expect(page.getByLabel('Task name',{exact:true})).toHaveValue('Plan my week');
  await page.getByRole('button',{name:'Save task'}).evaluate(button=>{for(let i=0;i<8;i++)(button as HTMLButtonElement).click();});
  await expect(page.getByRole('heading',{name:'Plan my week',exact:true})).toBeVisible();
  await expect(page.locator('.source').filter({hasText:'Personal'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open sample source'})).toHaveCount(0);
  let view=await call(request,'list_attention');expect(view.items).toHaveLength(1);expect(view.items[0].provider).toBe('personal');
  await page.getByRole('button',{name:/^Complete /}).click();
  await stop();await start();await page.reload();
  await history(page);
  await expect(page.getByRole('heading',{name:'Plan my week',exact:true})).toBeVisible();
  view=await call(request,'list_attention');expect(view.items).toHaveLength(1);expect(view.items[0].state).toBe('done');
});
for(const committed of [false,true])test(`interrupted personal creation ${committed?'after commit':'before delivery'} recovers without a duplicate`,async({page,request})=>{
  await open(page);await page.getByRole('button',{name:'Add task',exact:true}).click();
  await page.getByLabel('Task name',{exact:true}).fill('A recoverable personal task');
  await page.getByRole('radiogroup',{name:'Initial task state'}).getByRole('radio',{name:'Waiting',exact:true}).click();
  await page.route('**/api/tool',async route=>{
    if(route.request().postDataJSON().name==='create_personal_task'){if(committed)await route.fetch();await route.abort();}else await route.continue();
  });
  await page.getByRole('button',{name:'Save task'}).click();await expect(page.getByRole('alert')).toBeVisible();
  expect((await call(request,'list_attention')).items).toHaveLength(committed?1:0);
  await page.unroute('**/api/tool');await page.reload();
  if(!committed){await expect(page.getByRole('button',{name:'Retry task'})).toBeVisible();await page.getByRole('button',{name:'Retry task'}).click();}
  await expect(page.getByRole('radio',{name:/^Waiting 1/})).toBeVisible();
  await page.getByRole('radio',{name:/^Waiting 1/}).click();
  await expect(page.getByRole('heading',{name:'A recoverable personal task',exact:true})).toBeVisible();
  await expect(page.getByText('Check an interrupted save')).toHaveCount(0);
  expect((await call(request,'list_attention')).items).toHaveLength(1);
  const db=new DatabaseSync(dbPath);try{expect(db.prepare("SELECT count(*) AS count FROM history WHERE kind='personal'").get()?.count).toBe(1);}finally{db.close();}
});
test('source icons and filtering distinguish personal tasks and sample sources; light/dark themes and responsive layouts',async({page,request})=>{
  await call(request,'create_personal_task',{operationId:'0bf3e519-8323-4bcf-ac1f-5f40cbce3c6e',title:'Plan my week',nextAction:'Choose the three things I want to focus on.'});
  const samples=[['slack','Reply to the sample design thread'],['jira','Review the sample project plan'],['github','Check the sample pull request'],['calendar','Prepare for the sample meeting'],['meeting','Follow up on the sample discussion']] as const;
  for(const [sourceKind,title] of samples)await call(request,'upsert_attention_items',{batchId:sourceKind,items:[{...syntheticObservation(),obligationKey:'synthetic:'+sourceKind,sourceKind,title,nextAction:'Synthetic example for source identification.'}]});
  await open(page);await expect(page.locator('article')).toHaveCount(6);
  for(const [sourceKind] of samples)await expect(page.locator(`.source-icon.${sourceKind} svg`)).toBeVisible();
  await expect(page.locator('.inbox-brand img')).toHaveJSProperty('naturalWidth',1254);
  await filterSource(page,'Slack');await expect(page.locator('article')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Reply to the sample design thread',exact:true})).toBeVisible();await expect(page.getByText('Sample',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Slack sample task',{exact:true})).toBeVisible();
  await filterSource(page,'Personal');await expect(page.locator('article')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Plan my week',exact:true})).toBeVisible();
  await filterSource(page,'All sources');
  for(const width of [375,768,1440]){await page.setViewportSize({width,height:1100});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
  await page.setViewportSize({width:1184,height:1100});
  await page.screenshot({path:'docs/evidence/inbox-0.5.0/sauron-ui-light.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
  await page.screenshot({path:'docs/evidence/inbox-0.5.0/sauron-ui-dark.png',fullPage:true,animations:'disabled'});
});

test('empty states hide unused tools; filters stay available for recovery; history is compact',async({page,request})=>{
  await open(page);
  await expect(page.getByRole('heading',{name:'Start with one task',exact:true})).toBeVisible();
  await expect(page.getByLabel('Search tasks',{exact:true})).toHaveCount(0);
  await expect(page.getByText(/MCP app · Local store|Synthetic proof controls|Decisions stay yours/)).toHaveCount(0);
  await page.getByRole('radio',{name:/^Waiting /}).click();
  await expect(page.getByRole('heading',{name:'Nothing you’re waiting on',exact:true})).toBeVisible();
  await expect(page.getByLabel('Filter by source')).toHaveCount(0);
  await page.getByRole('radio',{name:/^Needs you /}).click();
  await seed(page);
  await page.getByLabel('Search tasks',{exact:true}).fill('no matching title');
  await expect(page.getByRole('heading',{name:'No matching tasks',exact:true})).toBeVisible();
  await expect(page.getByLabel('Search tasks',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters'}).click();
  await expect(page.getByRole('heading',{name:'Review the synthetic launch note',exact:true})).toBeVisible();
  await filterSource(page,'Slack');
  await expect(page.getByRole('heading',{name:'No matching tasks',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters'}).click();
  await page.getByRole('button',{name:/^Complete /}).click();
  await expect(page.getByLabel('Search tasks',{exact:true})).toHaveCount(0);
  await history(page);
  const row=page.locator('article');
  expect((await row.boundingBox())!.height).toBeLessThan(150);
  await expect(row.locator('.inbox-context').getByText('Check the sample note and mark it complete.')).not.toBeVisible();
  await page.locator('.inbox-task-open').focus();await page.keyboard.press('Enter');
  await expect(page.locator('.inbox-task-detail').getByText('Latest sample context',{exact:true})).toBeVisible();
  await expect(row.getByLabel('Manual sample task',{exact:true})).toBeVisible();
  expect((await call(request,'list_attention')).items[0].state).toBe('done');
  await page.setViewportSize({width:1184,height:850});
  await page.locator('.inbox-task-open').click();
  await page.getByRole('heading',{name:'Your attention list',exact:true}).click();
  await page.screenshot({path:'docs/evidence/inbox-0.5.0/sauron-history-0.5.0.png',fullPage:true,animations:'disabled'});
  await page.getByRole('radio',{name:/^Waiting /}).click();
  await expect(page.getByRole('heading',{name:'Nothing you’re waiting on',exact:true})).toBeVisible();
  await expect(page.getByRole('radio',{name:/^Waiting /})).toHaveAttribute('aria-checked','true');
  await page.getByRole('heading',{name:'Your attention list',exact:true}).click();
  await page.screenshot({path:'docs/evidence/inbox-0.5.0/sauron-waiting-0.5.0.png',fullPage:true,animations:'disabled'});
});
test('completion can be reopened deliberately, and snoozed tasks can be brought back',async({page,request})=>{
  await open(page);await seed(page);
  await page.getByRole('button',{name:/^Complete /}).click();
  await page.getByRole('button',{name:'Reopen task',exact:true}).click();
  await expect(page.getByRole('button',{name:/^Complete /})).toBeVisible();
  let task=(await call(request,'list_attention')).items[0];expect(task.state).toBe('needs_you');
  await action(page,'Snooze 1 hour');
  await page.getByRole('button',{name:/^Snoozed /}).click();
  await action(page,'Bring back now');
  await page.getByRole('radio',{name:/^Needs you /}).click();
  await expect(page.getByRole('button',{name:/^Complete /})).toBeVisible();
  task=(await call(request,'list_attention')).items[0];expect(task.snoozedUntil).toBeNull();
  await action(page,'Dismiss');
  await page.getByRole('button',{name:'Confirm dismiss'}).click();
  await history(page,'dismissed');
  await page.locator('.inbox-task-open').click();
  await page.locator('.inbox-task-detail').getByRole('button',{name:'Reopen task',exact:true}).click();
  expect((await call(request,'list_attention')).items[0].state).toBe('needs_you');
});
test('failed load has an actionable retry and never claims an empty list',async({page})=>{
  await page.route('**/api/tool',route=>route.abort());
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('Your list could not be loaded.');
  await expect(page.getByRole('heading',{name:'Start with one task',exact:true})).toHaveCount(0);
  await expect(page.getByText('Loading your saved tasks…')).toHaveCount(0);
  await page.unroute('**/api/tool');
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Start with one task',exact:true})).toBeVisible();
});
test('long task names fit compact history on mobile in light and dark themes',async({page,request})=>{
  await call(request,'create_personal_task',{operationId:'3af6b49e-e2f1-4cb8-b681-36ef6a3473be',title:'A'.repeat(160),nextAction:'Context '.repeat(40)});
  await open(page);await page.getByRole('button',{name:/^Complete /}).click();await history(page);
  for(const width of [320,375,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({width:375,height:900});
  await page.screenshot({path:'docs/evidence/inbox-0.5.0/sauron-history-mobile-0.5.0.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await expect(page.locator('article h2')).toHaveCSS('color','rgb(255, 255, 255)');
  await page.screenshot({path:'docs/evidence/inbox-0.5.0/sauron-history-dark-0.5.0.png',fullPage:true,animations:'disabled'});
});

test('Refresh starts a source scan, stays disabled across reopening, and reenables on completion',async({page,request})=>{
  const saved=await call(request,'list_attention');
  await call(request,'configure_attention_sync',{expectedStoreId:saved.storeId,operationId:randomUUID(),mode:'dot_managed'});
  await open(page);
  await expect(page.getByText('Waiting for the first automatic update.',{exact:true})).toBeVisible();
  const refresh=page.getByRole('button',{name:'Refresh',exact:true});
  await refresh.click();
  await expect(page.getByRole('button',{name:'Refreshing…',exact:true})).toBeDisabled();
  await expect(page.getByText('Checking Slack and Granola…',{exact:true})).toBeVisible();
  const run=(await call(request,'list_attention')).scan!;
  expect(run.status).toBe('running');
  const joined=await call(request,'refresh_attention');expect(joined.scan?.id).toBe(run.id);
  await page.reload();
  await expect(page.getByRole('button',{name:'Refreshing…',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled({timeout:10000});
  await page.getByText('Update details',{exact:true}).click();
  await expect(page.getByText('Slack and Granola checked.',{exact:true})).toBeVisible();
  expect((await call(request,'list_attention')).scan?.status).toBe('completed');
});

test('a runtime failure reenables Refresh and preserves the saved list',async({page,request})=>{
  await open(page);await seed(page);
  writeFileSync(join(dir,'runtime.cjs'),'#!/usr/bin/env node\nprocess.exit(1);',{mode:0o700});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('The source check did not finish');
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();
  await expect(page.getByRole('heading',{name:'Review the synthetic launch note',exact:true})).toBeVisible();
  expect((await call(request,'list_attention')).scan?.status).toBe('failed');
});

test('source filter supports keyboard selection, dismissal and narrow layouts',async({page})=>{
  await open(page);await seed(page);
  const trigger=page.getByRole('button',{name:/^Filter by source:/});
  await trigger.focus();await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option',{name:'All sources',exact:true})).toBeVisible();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(trigger).toContainText('Slack');await expect(trigger).toBeFocused();
  await expect(page.getByRole('heading',{name:'No matching tasks',exact:true})).toBeVisible();
  await trigger.click();await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
  await expect(trigger).toContainText('All sources');
  await page.setViewportSize({width:375,height:812});await trigger.click();
  const menu=page.getByRole('dialog');const bounds=(await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(375);
  await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(trigger).toBeFocused();
  await trigger.click();await page.getByRole('heading',{name:'Your attention list',exact:true}).click();await expect(menu).toHaveCount(0);
});

test.describe('local list timestamps',()=>{
  test.use({timezoneId:'Pacific/Auckland'});
  test('live items have clean source labels and one relative update time with a local exact time',async({page})=>{
    const {SauronStore}=await import('../../src/server/store.js');
    const store=new SauronStore(dbPath,()=>new Date('2026-10-18T17:00:00Z'));
    try{
      store.finishScan(store.beginScan().run.id,{sources:{slack:{status:'checked',detail:'Verified test request'},granola:{status:'checked',detail:'No assigned actions'}},items:[{
        provider:'slack',sourceUrl:'https://example.slack.com/archives/C123/p1792313076000000',actionKey:'Please review the release plan',
        title:'Review the release plan',nextAction:'Read the changes and reply in the thread.',sourceState:'needs_you',resolved:false,
      }]});
    }finally{store.close();}
    await page.clock.setFixedTime(new Date('2026-10-18T17:05:00Z'));
    await open(page);
    await expect(page.locator('header')).toHaveText(/Sauron/);
    await expect(page.locator('.nav-separator,.nav-context,.sample-tag')).toHaveCount(0);
    await expect(page.getByText('Sample',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:/^Review the release plan/}).click();
    await expect(page.getByRole('button',{name:'Open source',exact:true})).toBeVisible();
    await expect(page.getByText(/Sample last checked|Madrid|Last checked/)).toHaveCount(0);
    await expect(page.locator('.inbox-update [role=status]')).toContainText('Last check 5 minutes ago');
    await expect(page.locator('.inbox-update [role=status] time')).toHaveAttribute('title',/Oct 19, 2026.*6:00/);
    await expect(page.locator('article time')).toHaveCount(0);
    await page.getByRole('button',{name:'Switch to dark theme'}).click();
    await filterSource(page,'Slack');await expect(page.getByRole('heading',{name:'Review the release plan',exact:true})).toBeVisible();
  });
});


test('dot sync has distinct partial/error and last-success state, real provider badges and visible evidence',async({page,request})=>{
  const initial=await call(request,'list_attention');
  await call(request,'configure_attention_sync',{expectedStoreId:initial.storeId,operationId:randomUUID(),mode:'dot_managed'});
  const identity={runId:randomUUID(),expectedStoreId:initial.storeId};
  await call(request,'sync_attention',{request:{...identity,phase:'start'}});
  const sources=Object.fromEntries(['slack','granola','jira','github','calendar'].map(provider=>[provider,{status:'checked',detail:'Synthetic fixture checked'}]));
  await call(request,'sync_attention',{request:{...identity,phase:'finish',checkedAt:new Date().toISOString(),sources,items:[{
    provider:'jira',sourceUrl:'https://example.atlassian.net/browse/TEST-123',actionKey:'Review synthetic fixture',title:'Review Jira fixture',
    nextAction:'Review the synthetic issue.',sourceState:'needs_you',resolved:false,provenance:{reader:'dot',evidence:'Isolated synthetic source evidence'},
  }]}});
  await open(page);await expect(page.locator('.inbox-update [role=status]')).toContainText('Last full update');
  await expect(page.getByLabel('Jira task',{exact:true})).toBeVisible();
  await page.locator('.inbox-task-open').click();await page.getByText('Source evidence',{exact:true}).click();
  await expect(page.getByText('Isolated synthetic source evidence',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();
  const next={runId:randomUUID(),expectedStoreId:initial.storeId};await call(request,'sync_attention',{request:{...next,phase:'start'}});
  await call(request,'sync_attention',{request:{...next,phase:'finish',checkedAt:new Date().toISOString(),sources:{...sources,calendar:{status:'failed',detail:'Calendar unavailable'}},items:[]}});
  await page.reload();await expect(page.getByRole('alert')).toContainText('Some sources were not checked');
  await expect(page.locator('.inbox-update [role=status]')).toContainText('Last full update');
  await page.getByText('Update details',{exact:true}).click();
  await expect(page.getByText('Calendar (failed): Calendar unavailable',{exact:true})).toBeVisible();
  await expect(page.locator('article')).toHaveCount(1);
  await page.screenshot({path:'test-results/dot-sync-partial-0.6.0.png',fullPage:true});
});
