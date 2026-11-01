import { test,expect, type Page, type APIRequestContext } from '@playwright/test';
import { build } from 'esbuild';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync,rmSync,writeFileSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticObservation, type Result } from '../../src/shared/contracts.js';
import { contrastRatio } from '../../../../tests/ui/contrast.mjs';
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
async function keyboardAction(page:Page,title:string,action:string){
  await page.getByRole('button',{name:`Actions for ${title}`,exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('menuitem',{name:action,exact:true}).focus();await page.keyboard.press('Enter');
}

for(const theme of ['light','dark'] as const){
  test(`preview starts with the system ${theme} theme and readable field hints`,async({page})=>{
    await page.emulateMedia({colorScheme:theme});await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    const toggle=page.getByRole('button',{name:`Switch to ${theme==='dark'?'light':'dark'} theme`});
    await expect(toggle).toBeVisible();
    await page.getByRole('button',{name:'Add task',exact:true}).click();
    expect(await contrastRatio(page.getByRole('textbox',{name:'Task name',exact:true}),'::placeholder')).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(page.getByRole('textbox',{name:'Notes (optional)',exact:true}),'::placeholder')).toBeGreaterThanOrEqual(4.5);
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme==='dark'?'light':'dark');
  });
}
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
  await page.getByRole('radio',{name:/^Inbox /}).click();
  await page.getByRole('button',{name:/^Review the synthetic launch note/}).click();await expect(page.getByRole('button',{name:'Open sample source'})).toBeVisible();
  await page.getByRole('button',{name:'Accept task'}).click();
  await actions(page,'Review launch notes','Snooze 1 hour');await page.getByRole('button',{name:/^Snoozed/}).click();await expect(page.getByRole('heading',{name:'Review launch notes',exact:true})).toBeVisible();
  await actions(page,'Review launch notes','Bring back now');await page.getByRole('radio',{name:/^Today/}).click();
  await actions(page,'Review launch notes','Dismiss');await page.getByRole('button',{name:'Confirm dismiss'}).click();await page.getByRole('button',{name:/^History/}).click();await page.getByRole('radio',{name:/^Dismissed/}).click();
  await page.getByRole('button',{name:/^Review launch notes/}).click();await page.locator('.inbox-task-detail').getByRole('button',{name:'Reopen task'}).click();
  await page.getByRole('button',{name:'Complete Review launch notes',exact:true}).click();await page.getByRole('button',{name:/^History/}).click();await expect(page.getByRole('heading',{name:'Review launch notes',exact:true})).toBeVisible();
});
test('new source work is reviewed before entering Today, with area and distinct dates',async({page,request})=>{
  await call(request,'upsert_attention_items',{batchId:'review-source',items:[syntheticObservation()]});
  await open(page);
  await expect(page.getByRole('radio',{name:/^Today 0/})).toBeVisible();
  await page.getByRole('radio',{name:/^Inbox 1/}).click();
  await page.getByRole('button',{name:/^Review the synthetic launch note/}).click();
  await expect(page.getByRole('button',{name:/^Complete /})).toHaveCount(0);
  const editor=page.getByRole('form',{name:'Plan Review the synthetic launch note'});
  await editor.getByRole('combobox',{name:'Area'}).selectOption('blex');
  await editor.getByRole('textbox',{name:'Real due date'}).fill('2026-11-05');
  await editor.getByRole('textbox',{name:'Review date'}).fill('2026-11-04');
  await editor.getByRole('textbox',{name:'Next action'}).fill('Ask Ayhan about learner impact.');
  await editor.getByRole('button',{name:'Accept task'}).click();
  await expect(page.getByRole('radio',{name:/^Today 1/})).toBeVisible();
  await call(request,'upsert_attention_items',{batchId:'review-source-newer',items:[syntheticObservation(2)]});
  await page.reload();
  await page.getByRole('button',{name:/^Review the synthetic launch note/}).click();
  await expect(page.getByText('A repeated check still asks for review.',{exact:true})).toBeVisible();
  await expect(page.getByText('Your next action: Ask Ayhan about learner impact.',{exact:true})).toBeVisible();
  const saved=(await call(request,'list_attention')).items[0];
  expect(saved.area).toBe('blex');expect(saved.dueDate).toBe('2026-11-05');expect(saved.reviewDate).toBe('2026-11-04');
  await page.getByRole('button',{name:/^Filter by area:/}).click();
  await page.getByRole('dialog').getByRole('option',{name:'PEX',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No matching tasks'})).toBeVisible();
});
test('Top 3 and task order are user-confirmed and keyboard reorder persists',async({page,request})=>{
  for(const title of ['Review BLEX','Check PEX','Write feedback','Plan week'])await add(request,title);
  await open(page);
  for(const title of ['Review BLEX','Check PEX','Write feedback'])await actions(page,title,'Add to Top 3');
  const chosen=(await call(request,'list_attention')).items.filter(task=>task.focusOrder);
  expect(chosen).toHaveLength(3);
  const fourth=page.getByRole('button',{name:'Actions for Plan week'});await fourth.click();
  await expect(page.getByRole('menuitem',{name:'Add to Top 3'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  const reorder=page.getByRole('button',{name:'Actions for Check PEX'});await reorder.focus();await page.keyboard.press('Enter');
  const up=page.getByRole('menuitem',{name:'Move up'});await up.focus();await page.keyboard.press('Enter');
  await expect(page.getByText('Order saved.',{exact:true})).toBeVisible();
  await page.reload();
  const saved=(await call(request,'list_attention')).items;
  const ordered=saved.filter(task=>task.focusOrder).sort((a,b)=>a.focusOrder!-b.focusOrder!).map(task=>task.title);
  expect(ordered).toEqual(['Check PEX','Review BLEX','Write feedback']);
  const rest=saved.filter(task=>task.state==='ready').sort((a,b)=>(a.order??0)-(b.order??0)).map(task=>task.title);
  expect(rest.indexOf('Check PEX')).toBeLessThan(rest.indexOf('Review BLEX'));
});
test('keyboard moves swap Top 3 membership but stop at the In progress and Ready boundary',async({page,request})=>{
  for(const title of ['Review BLEX','Check PEX','Write feedback','Plan week'])await add(request,title);
  await open(page);
  for(const title of ['Review BLEX','Check PEX','Write feedback'])await actions(page,title,'Add to Top 3');
  await actions(page,'Plan week','Start work');
  await expect(page.getByRole('heading',{name:'In progress',exact:true})).toBeVisible();
  await keyboardAction(page,'Write feedback','Move down');
  await expect(page.locator('.inbox-task-open h2')).toHaveText(['Review BLEX','Check PEX','Plan week','Write feedback']);
  await page.reload();
  let saved=(await call(request,'list_attention')).items;
  expect(saved.filter(task=>task.focusOrder).sort((a,b)=>a.focusOrder!-b.focusOrder!).map(task=>task.title)).toEqual(['Review BLEX','Check PEX','Plan week']);
  expect(saved.find(task=>task.title==='Plan week')?.state).toBe('in_progress');
  expect(saved.find(task=>task.title==='Write feedback')?.state).toBe('ready');
  await keyboardAction(page,'Write feedback','Move up');
  await expect(page.locator('.inbox-task-open h2')).toHaveText(['Review BLEX','Check PEX','Write feedback','Plan week']);
  await add(request,'Next ready');await page.reload();
  saved=(await call(request,'list_attention')).items;
  expect(saved.filter(task=>task.focusOrder).sort((a,b)=>a.focusOrder!-b.focusOrder!).map(task=>task.title)).toEqual(['Review BLEX','Check PEX','Write feedback']);
  await page.getByRole('button',{name:'Actions for Plan week'}).click();
  await expect(page.getByRole('menuitem',{name:'Move down'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Actions for Next ready'}).click();
  await expect(page.getByRole('menuitem',{name:'Move up'})).toHaveCount(0);
});
test('Inbox fits long titles, mobile, dark mode, empty filters and keyboard menus',async({page,request})=>{
  mkdirSync(evidence,{recursive:true});
  const title='Review '+('a very long meeting topic '.repeat(5));await add(request,title);await open(page);
  const menu=page.getByRole('button',{name:`Actions for ${title}`});await menu.focus();await page.keyboard.press('Enter');await expect(page.getByRole('menuitem',{name:'Add to Top 3'})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toBeFocused();
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

test('History returns to the previous task state and filters from either exit',async({page,request})=>{
  await call(request,'create_personal_task',{title:'Waiting for launch review',nextAction:'Ask for the reviewed notes.',sourceState:'waiting',operationId:crypto.randomUUID()});
  await add(request,'Current launch review');await open(page);
  await page.getByRole('radio',{name:/^Waiting/}).click();
  await page.getByLabel('Search tasks').fill('launch');
  await page.getByRole('button',{name:/^Filter by source:/}).click();
  await page.getByRole('option',{name:'Personal',exact:true}).click();
  for(const exit of ['Back to current tasks','History']){
    await page.getByRole('button',{name:/^History/}).click();
    await expect(page.getByRole('radio',{name:/^Waiting/})).toHaveAttribute('aria-checked','false');
    await page.getByRole('radio',{name:/^Dismissed/}).click();
    await page.getByRole('button',{name:exit==='History'?/^History/:exit,exact:exit!=='History'}).click();
    await expect(page.getByRole('radio',{name:/^Waiting/})).toHaveAttribute('aria-checked','true');
    await expect(page.getByLabel('Search tasks')).toHaveValue('launch');
    await expect(page.getByRole('button',{name:/^Filter by source:/})).toContainText('Personal');
    await expect(page.getByRole('heading',{name:'Waiting for launch review',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Back to current tasks',exact:true})).toHaveCount(0);
  }
  await page.setViewportSize({width:375,height:900});
  await page.getByRole('button',{name:/^History/}).click();
  await page.getByRole('button',{name:'Back to current tasks',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Waiting for launch review',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^History/}).click();
  const needsYou=page.getByRole('radio',{name:/^Needs you/});
  await needsYou.focus();await page.keyboard.press('Space');
  await expect(needsYou).toBeFocused();
  await expect(page.getByRole('heading',{name:'Current launch review',exact:true})).toBeVisible();
});

test('task list fills the remaining desktop height as the window and update details change',async({page,request})=>{
  for(let i=0;i<12;i++)await add(request,`Review launch task ${i}`);
  await page.setViewportSize({width:1440,height:900});await open(page);
  const reader=page.locator('.inbox-reader'),short=(await reader.boundingBox())!;
  await page.setViewportSize({width:1440,height:1400});
  await expect.poll(async()=>(await reader.boundingBox())!.height-short.height).toBeGreaterThan(450);
  for(const height of [650,900,1400]){
    await page.setViewportSize({width:1440,height});
    const bounds=(await reader.boundingBox())!;
    expect(bounds.y+bounds.height).toBeLessThan(height);
    expect(height-bounds.y-bounds.height).toBeLessThan(80);
    expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBeTruthy();
  }
  await page.setViewportSize({width:1440,height:900});
  const closed=(await reader.boundingBox())!;
  await page.getByText('Update details',{exact:true}).click();
  expect((await reader.boundingBox())!.height).toBeLessThan(closed.height);
  await page.getByText('Update details',{exact:true}).click();
  expect((await reader.boundingBox())!.height).toBeCloseTo(closed.height,0);
});

test('reader tools stay clear of scrolling content and portaled menus',async({page,request})=>{
  await call(request,'create_personal_task',{title:'Read the complete launch notes',nextAction:'Read the complete notes before deciding the next step. '.repeat(7),sourceState:'needs_you',operationId:crypto.randomUUID()});
  await page.setViewportSize({width:1280,height:650});await open(page);
  await page.locator('.inbox-task-open').click();
  const tools=page.locator('.inbox-reader-tools'),content=page.locator('.inbox-reader-content');
  const before=(await tools.boundingBox())!;
  await content.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  expect(await content.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  expect((await tools.boundingBox())!.y).toBe(before.y);
  await page.getByRole('button',{name:'More task actions',exact:true}).click();
  const dismiss=page.getByRole('menuitem',{name:'Dismiss',exact:true});
  const box=(await dismiss.boundingBox())!;
  expect(await dismiss.evaluate((node,point)=>node.contains(document.elementFromPoint(point.x,point.y)),{x:box.x+box.width/2,y:box.y+box.height/2})).toBeTruthy();
  await dismiss.click();
  await expect(page.getByRole('dialog',{name:'Dismiss this task?',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:/Filter by source: All sources/}).click();
  const option=page.getByRole('option',{name:'Slack',exact:true});
  const optionBox=(await option.boundingBox())!;
  expect(await option.evaluate((node,point)=>node.contains(document.elementFromPoint(point.x,point.y)),{x:optionBox.x+optionBox.width/2,y:optionBox.y+optionBox.height/2})).toBeTruthy();
  await page.keyboard.press('Escape');
});

for(const width of [1440,375])test(`completion feedback keeps the task list stable at ${width}px`,async({page,request})=>{
  await page.setViewportSize({width,height:1000});
  await page.emulateMedia({colorScheme:width===375?'dark':'light'});
  await add(request,'Complete without flashing');await add(request,'Keep this task');await add(request,'Another remaining task');await open(page);
  expect((await page.getByRole('heading',{name:'Your attention list',exact:true}).boundingBox())!.y).toBeLessThan(120);
  const reader=page.locator('.inbox-reader'),before=(await reader.boundingBox())!;
  let release!:()=>void,started!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),sending=new Promise<void>(resolve=>{started=resolve;});
  await page.route('**/api/tool',async route=>{
    if(route.request().postDataJSON().name==='decide_attention_item'){started();await held;}
    await route.continue();
  });
  try{
    const complete=page.getByRole('button',{name:'Complete Complete without flashing',exact:true});
    await complete.click();await sending;
    await expect(complete).toHaveAttribute('aria-busy','true');
    await expect(page.getByText('Check an interrupted save',{exact:true})).toHaveCount(0);
    const during=(await reader.boundingBox())!;
    expect(during.y).toBeCloseTo(before.y,1);expect(during.height).toBeCloseTo(before.height,1);
    release();
    await expect(complete).toHaveCount(0);
    const notice=page.locator('.inbox-notice');await expect(notice).toContainText('Task completed.');
    const after=(await reader.boundingBox())!;
    expect(after.y).toBeCloseTo(before.y,1);
    if(width>=960)expect(after.height).toBeCloseTo(before.height,1);
    const bounds=(await notice.boundingBox())!,list=(await page.locator('.inbox-list').boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(list.x);expect(bounds.x+bounds.width).toBeLessThanOrEqual(list.x+list.width);
    mkdirSync(evidence,{recursive:true});await page.screenshot({path:`${evidence}/save-feedback-${width}.png`,fullPage:true});
    await notice.getByRole('button',{name:'Reopen task',exact:true}).click();
    await expect(complete).toBeVisible();
    expect((await reader.boundingBox())!.y).toBeCloseTo(before.y,1);
    await page.getByRole('button',{name:'Dismiss notification',exact:true}).click();
    await expect(notice).toHaveCount(0);
    const saved=await call(request,'list_attention');expect(saved.items.find(task=>task.title==='Complete without flashing')?.state).toBe('needs_you');
  }finally{release();}
});

test('failed decisions retain recovery across reopening and a slow retry',async({page,request})=>{
  const original=await add(request,'Recover a failed decision');await add(request,'Keep another task');await open(page);
  let attempts=0,release!:()=>void,started!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),retrying=new Promise<void>(resolve=>{started=resolve;});
  await page.route('**/api/tool',async route=>{
    if(route.request().postDataJSON().name!=='decide_attention_item'){await route.continue();return;}
    if(++attempts===1){await route.abort('failed');return;}
    started();await held;await route.continue();
  });
  try{
    await page.getByRole('button',{name:'Complete Recover a failed decision',exact:true}).click();
    const recovery=page.getByText('Check an interrupted save',{exact:true});await expect(recovery).toBeVisible();
    await page.reload();await expect(recovery).toBeVisible();
    const retry=page.getByRole('button',{name:'Retry decision',exact:true});await retry.click();await retrying;
    await expect(recovery).toBeVisible();await expect(retry).toBeDisabled();
    release();await expect(recovery).toHaveCount(0);
    await expect(page.getByRole('button',{name:/^History 1/})).toBeVisible();
    const saved=await call(request,'list_attention'),task=saved.items.find(item=>item.title==='Recover a failed decision')!;
    expect(task.state).toBe('done');expect(task.version).toBe(original.items[0].version+1);expect(attempts).toBe(2);
  }finally{release();}
});

test('completion notification remains in view on a long narrow task list',async({page,request})=>{
  await page.setViewportSize({width:375,height:900});
  for(let i=0;i<12;i++)await add(request,`Task in a long list ${i}`);
  await open(page);
  await page.locator('.inbox-task').first().getByRole('button',{name:/^Complete /}).click();
  const notice=page.locator('.inbox-notice');await expect(notice).toContainText('Task completed.');
  const bounds=(await notice.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(900);
  expect((await page.locator('.inbox-footer').boundingBox())!.y).toBeGreaterThan(900);
  await notice.getByRole('button',{name:'Dismiss notification',exact:true}).click();
  await expect(notice).toHaveCount(0);
});
