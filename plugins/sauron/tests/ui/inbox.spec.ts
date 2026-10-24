import { test,expect, type Page, type APIRequestContext } from '@playwright/test';
import { build } from 'esbuild';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync,rmSync,writeFileSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticObservation, type Result } from '../../src/shared/contracts.js';
let child:ChildProcess,dir:string,origin:string;let port=4610;
test.beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),'sauron-inbox-test-'));origin=`http://127.0.0.1:${++port}`;
  const runtime=join(dir,'runtime.cjs');
  writeFileSync(runtime,`#!/usr/bin/env node\nconst fs=require('node:fs');setTimeout(()=>fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify({sources:{slack:{status:'checked',detail:'Fixture only'},granola:{status:'checked',detail:'Fixture only'}},items:[]})),2200);`,{mode:0o700});
  child=spawn(process.execPath,['dist/server/preview.js'],{env:{...process.env,PORT:String(port),ATTENTION_DB:join(dir,'test.sqlite'),SAURON_CODEX_BIN:runtime},stdio:['ignore','pipe','pipe']});
  await new Promise<void>((resolve,reject)=>{child.stderr!.on('data',data=>{if(String(data).includes('Sauron preview:'))resolve();});child.once('error',reject);child.once('exit',code=>reject(Error(`Preview exited ${code}`)));});
});
test.afterEach(async()=>{if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});});
async function call(request:APIRequestContext,name:string,args:unknown={}):Promise<Result>{const res=await request.post(origin+'/api/tool',{data:{name,arguments:args}});expect(res.ok()).toBeTruthy();return res.json();}
async function open(page:Page){await page.goto(origin);await expect(page.getByRole('button',{name:'Add task',exact:true})).toBeEnabled();}
async function add(request:APIRequestContext,title='Review launch notes'){return call(request,'create_personal_task',{title,nextAction:'Decide the next step after reviewing the meeting notes.',sourceState:'needs_you',operationId:crypto.randomUUID()});}
async function actions(page:Page,title:string,action:string){await page.getByRole('button',{name:`Actions for ${title}`,exact:true}).click();await page.getByRole('menuitem',{name:action,exact:true}).click();}
const evidence='docs/evidence/inbox-0.5.0';
test('Inbox opens directly after reopening and has no layout selector',async({page,request})=>{
  await add(request);await open(page);mkdirSync(evidence,{recursive:true});
  const before=await call(request,'list_attention');
  await expect(page.getByRole('group',{name:'Interface view'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Actions for Review launch notes'})).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:'Actions for Review launch notes'})).toBeVisible();
  const after=await call(request,'list_attention');expect(after.items).toEqual(before.items);expect(after.scan).toEqual(before.scan);expect(after.storeId).toBe(before.storeId);
  await page.screenshot({path:evidence+'/inbox-desktop.png',fullPage:true,animations:'disabled'});
});
test('Inbox supports source links, completion, snooze, dismissal and reopening',async({page,request})=>{
  await call(request,'upsert_attention_items',{batchId:'inbox-source',items:[syntheticObservation()]});await add(request);await open(page);
  await page.getByRole('button',{name:/^Review the synthetic launch note/}).click();await expect(page.getByRole('button',{name:'Open sample source'})).toBeVisible();
  await actions(page,'Review launch notes','Snooze 1 hour');await page.getByRole('button',{name:/^Snoozed/}).click();await expect(page.getByRole('heading',{name:'Review launch notes',exact:true})).toBeVisible();
  await actions(page,'Review launch notes','Bring back now');await page.getByRole('radio',{name:/^Needs you/}).click();
  await actions(page,'Review launch notes','Dismiss');await page.getByRole('button',{name:'Confirm dismiss'}).click();await page.getByRole('button',{name:/^History/}).click();await page.getByRole('radio',{name:/^Dismissed/}).click();
  await page.getByRole('button',{name:/^Review launch notes/}).click();await page.locator('.inbox-task-detail').getByRole('button',{name:'Reopen task'}).click();
  await page.getByRole('button',{name:'Complete Review launch notes',exact:true}).click();await page.getByRole('button',{name:/^History/}).click();await expect(page.getByRole('heading',{name:'Review launch notes',exact:true})).toBeVisible();
});
test('Inbox fits long titles, mobile, dark mode, empty filters and keyboard menus',async({page,request})=>{
  mkdirSync(evidence,{recursive:true});
  const title='Review '+('a very long meeting topic '.repeat(5));await add(request,title);await open(page);
  const menu=page.getByRole('button',{name:`Actions for ${title}`});await menu.focus();await page.keyboard.press('Enter');await expect(page.getByRole('menuitem',{name:'Snooze 1 hour'})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toBeFocused();
  for(const width of [320,375,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
  await page.setViewportSize({width:375,height:900});await page.screenshot({path:evidence+'/inbox-mobile.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Switch to dark theme'}).click();await page.screenshot({path:evidence+'/inbox-mobile-dark.png',fullPage:true,animations:'disabled'});
  await page.getByLabel('Search tasks').fill('no matching task');await expect(page.getByRole('heading',{name:'No matching tasks',exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear filters'}).click();
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:evidence+'/inbox-desktop-dark.png',fullPage:true,animations:'disabled'});
});

test('interrupted Inbox save is recoverable after reopening without duplicate tasks',async({page,request})=>{
  await open(page);await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Task name',{exact:true}).fill('Recover this task');
  let interrupted=false;
  await page.route('**/api/tool',async route=>{
    if(!interrupted&&route.request().postDataJSON().name==='create_personal_task'){
      interrupted=true;await route.fetch();await route.abort('failed');
    }else await route.continue();
  });
  await page.getByRole('button',{name:'Save task',exact:true}).click();await expect(page.getByText('Check an interrupted save',{exact:true})).toBeVisible();await page.reload();
  await expect(page.getByRole('heading',{name:'Recover this task',exact:true})).toBeVisible();expect((await call(request,'list_attention')).items.filter(t=>t.title==='Recover this task')).toHaveLength(1);
});
test('rendering failure offers a dependency-independent page reload',async({page})=>{
  const output=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {InboxBoundary} from './src/app/InboxBoundary.tsx';function Broken(){throw Error('Controlled rendering failure');}createRoot(document.getElementById('root')).render(<InboxBoundary><Broken/></InboxBoundary>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
  await open(page);await page.setContent('<div id="root"></div>');await page.addScriptTag({content:output.outputFiles[0].text});
  await expect(page.getByRole('alert')).toContainText('Sauron could not be displayed');
  await page.getByRole('button',{name:'Reload Sauron',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add task',exact:true})).toBeEnabled();
});

test('reading pane follows selection, keyboard and paging without scans or data changes',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});
  await add(request,'A first task');await add(request,'B second task');await add(request,'C third task');
  const before=await call(request,'list_attention'),calls:string[]=[];
  page.on('request',req=>{if(req.url().endsWith('/api/tool'))calls.push(req.postDataJSON().name);});
  await open(page);await expect(page.getByRole('heading',{name:'Select a task',exact:true})).toBeVisible();
  // Tasks are ordered by persisted IDs, not their titles. Follow the visible order.
  const rows=page.locator('.inbox-task-open'),first=rows.nth(0),second=rows.nth(1);
  const firstTitle=await first.locator('h2').innerText(),secondTitle=await second.locator('h2').innerText();
  await first.click();await expect(first).toHaveAttribute('aria-current','true');
  const detail=page.getByRole('region',{name:`Task details: ${firstTitle}`,exact:true});await expect(detail).toBeVisible();
  const left=(await page.locator('.inbox-tasks').boundingBox())!,right=(await detail.boundingBox())!;
  expect(right.x).toBeGreaterThanOrEqual(left.x+left.width);expect(right.width).toBeGreaterThan(left.width);
  await first.focus();await page.keyboard.press('ArrowDown');await expect(second).toBeFocused();
  await expect(page.getByRole('heading',{name:`Task details: ${secondTitle}`,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Previous task',exact:true}).click();
  await expect(page.getByRole('heading',{name:`Task details: ${firstTitle}`,exact:true})).toBeFocused();
  expect(calls).not.toContain('refresh_attention');expect(calls).not.toContain('prepare_slack_reply');
  expect((await call(request,'list_attention')).items).toEqual(before.items);
  await page.screenshot({path:evidence+'/reading-pane-desktop.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Switch to dark theme'}).click();await page.screenshot({path:evidence+'/reading-pane-desktop-dark.png',fullPage:true,animations:'disabled'});
});
test('mobile opens one task at a time and Back restores the selected row and focus',async({page,request})=>{
  const title='A long task title '+('with plenty of context '.repeat(5));
  await add(request,title);await page.setViewportSize({width:375,height:900});await open(page);
  const row=page.getByRole('button',{name:new RegExp('^A long task title')});
  await expect(page.locator('.inbox-task-detail')).toHaveCount(0);await row.click();
  await expect(page.getByRole('heading',{name:`Task details: ${title}`,exact:true})).toBeFocused();
  await expect(page.locator('.inbox-tasks')).not.toBeVisible();
  for(const width of [320,375,768]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
  await page.setViewportSize({width:375,height:900});
  await page.screenshot({path:evidence+'/reading-pane-mobile.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await page.screenshot({path:evidence+'/reading-pane-mobile-dark.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Back to tasks',exact:true}).click();await expect(row).toBeFocused();
  await expect(page.locator('.inbox-reader-pane')).not.toBeVisible();await expect(row).toBeVisible();
});
test('filtering and completing a selected task never leave stale task details',async({page,request})=>{
  await add(request,'A selected task');await add(request,'B remaining task');await open(page);
  await page.getByRole('button',{name:/^A selected task/}).click();
  await page.getByLabel('Search tasks').fill('B remaining');await expect(page.getByRole('heading',{name:'Select a task',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Task details: A selected task',exact:true})).toHaveCount(0);
  await page.getByLabel('Search tasks').fill('');await expect(page.getByRole('heading',{name:'Task details: A selected task',exact:true})).toBeVisible();
  await page.getByRole('region',{name:'Task details: A selected task',exact:true}).getByRole('button',{name:'Complete',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Select a task',exact:true})).toBeVisible();
  expect((await call(request,'list_attention')).items.find(task=>task.title==='A selected task')?.state).toBe('done');
});

for(const outcome of ['recovered','new-failure','partial','next-update'] as const)test(`update summary distinguishes ${outcome} without hiding source gaps`,async({page,request})=>{
  await add(request,'Review saved task');
  const saved=await call(request,'list_attention');
  const sources=Object.fromEntries(['slack','granola','jira','github','calendar'].map(provider=>[provider,{status:'checked',detail:'Fixture checked'}]));
  const view={...saved,
    coordination:{mode:'dot_managed',changedAt:null,freshness:{status:outcome==='partial'?'partial':'fresh',lastAttemptAt:null,lastSuccessAt:'2026-10-20T10:00:00Z',ageMinutes:0,staleAfterMinutes:90,businessHoursActive:true,timeZone:'Europe/Madrid'}},
    sync:{id:'fixture-sync',status:outcome==='partial'?'partial':outcome==='next-update'?'running':'completed',startedAt:'2026-10-20T09:59:00Z',finishedAt:'2026-10-20T10:00:00Z',lastSuccessAt:outcome==='partial'?'2026-10-20T07:00:00Z':'2026-10-20T10:00:00Z',sources:outcome==='partial'?{...sources,calendar:{status:'failed',detail:'Calendar unavailable'}}:sources,error:outcome==='partial'?'Some sources were not checked.':null,itemCount:0},
    scan:{id:'fixture-scan',status:'failed',startedAt:outcome==='new-failure'?'2026-10-20T10:01:00Z':'2026-10-20T08:00:00Z',finishedAt:outcome==='new-failure'?'2026-10-20T10:02:00Z':'2026-10-20T08:01:00Z',error:'The source check did not finish.',sources:null,itemCount:0}};
  await page.route('**/api/tool',route=>route.fulfill({json:view}));
  await open(page);
  await expect(page.getByRole('heading',{name:'Review saved task',exact:true})).toBeVisible();
  const details=page.locator('.inbox-update details');await expect(details).not.toHaveAttribute('open','');
  if(outcome==='recovered'||outcome==='next-update')await expect(page.getByRole('alert')).toHaveCount(0);
  else await expect(page.getByRole('alert').filter({hasText:'Manual check:'})).toContainText('Use Refresh to try again.');
  if(outcome==='partial')await expect(page.getByRole('alert').filter({hasText:'Automatic update incomplete.'})).toBeVisible();
  await page.getByText('Update details',{exact:true}).click();
  await expect(page.getByText('The source check did not finish.',{exact:true})).toBeVisible();
  if(outcome==='recovered'||outcome==='next-update')await expect(page.getByText('A full automatic update completed after this check.',{exact:true})).toBeVisible();
  if(outcome==='partial')await expect(page.getByText('Calendar (failed): Calendar unavailable',{exact:true})).toBeVisible();
  await page.screenshot({path:`evidence/${outcome}.png`,fullPage:true});
  for(const width of [320,375,768,1280]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
});
