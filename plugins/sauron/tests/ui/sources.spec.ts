import {test,expect,type APIRequestContext} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SauronStore} from '../../src/server/store.js';
import {seedDevStore} from '../../src/server/dev-fixtures.js';
import {liveProviders,type Result} from '../../src/shared/contracts.js';

let child:ChildProcess,dir:string,path:string,origin:string;
let port=4910;
async function call(request:APIRequestContext,name:string,args:unknown={}):Promise<Result>{const result=await request.post(origin+'/api/tool',{data:{name,arguments:args}});expect(result.ok()).toBeTruthy();return result.json();}
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'sauron-source-ui-'));path=join(dir,'fixtures.sqlite');seedDevStore(path);origin=`http://127.0.0.1:${++port}`;
 const runtime=join(dir,'runtime.cjs');writeFileSync(runtime,'#!/usr/bin/env node\nprocess.exit(1);',{mode:0o700});
 child=spawn(process.execPath,['dist/server/preview.js'],{env:{...process.env,PORT:String(port),ATTENTION_DB:path,SAURON_CODEX_BIN:runtime},stdio:['ignore','ignore','pipe']});
 await new Promise<void>((resolve,reject)=>{let error='';child.stderr!.on('data',chunk=>{error+=String(chunk);if(String(chunk).includes('Sauron preview:'))resolve();});child.once('error',reject);child.once('exit',code=>reject(Error(`Preview exited ${code}: ${error}`)));});
});
test.afterEach(async()=>{if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});});

test('source toggles persist, preserve tasks and task filters, and support keyboard dismissal',async({page,request})=>{
 await page.goto(origin);await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();
 const before=await call(request,'list_attention');
 await page.getByRole('button',{name:'Refresh',exact:true}).focus();await page.keyboard.press('Enter');
 const github=page.getByRole('menuitemcheckbox',{name:'GitHub',exact:true});await expect(github).toBeChecked();await github.focus();await page.keyboard.press('Space');await expect(github).not.toBeChecked();
 await expect(page.getByRole('menu')).toBeVisible();await expect(github).toBeEnabled();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeFocused();
 expect((await call(request,'list_attention')).items).toEqual(before.items);
 await page.reload();await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(github).not.toBeChecked();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Filter by source: All sources'}).click();await page.getByRole('option',{name:'Slack',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Fixture: review a Slack reply',exact:true})).toBeVisible();
 expect((await call(request,'list_attention')).sourcePreferences?.enabled.github).toBe(false);
});
test('save failures retain the confirmed value and retry without closing the dropdown',async({page,request})=>{
 let fail=true;await page.route('**/api/tool',async route=>{if(route.request().postDataJSON().name==='configure_attention_sources'&&fail){fail=false;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Fixture save failure'})});}else await route.continue();});
 await page.goto(origin);await page.getByRole('button',{name:'Refresh',exact:true}).click();const github=page.getByRole('menuitemcheckbox',{name:'GitHub',exact:true});await github.click();
 await expect(page.getByRole('alert')).toContainText('Fixture save failure');await expect(github).toBeChecked();
 await page.getByRole('button',{name:'Retry source setting'}).click();await expect(github).not.toBeChecked();await expect(page.getByRole('alert')).toHaveCount(0);expect((await call(request,'list_attention')).sourcePreferences?.revision).toBe(1);
});
test('all-off state pauses updates without hiding tasks or creating a new scan',async({page,request})=>{
 const before=await call(request,'list_attention');for(const provider of liveProviders){const view=await call(request,'list_attention');await call(request,'configure_attention_sources',{expectedStoreId:view.storeId,operationId:randomUUID(),expectedRevision:view.sourcePreferences!.revision,provider,enabled:false});}
 await page.goto(origin);await expect(page.getByRole('status').filter({hasText:'Source updates paused'})).toBeVisible();await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('menuitem',{name:'Refresh now',exact:true})).toBeDisabled();
 await expect(page.getByRole('menuitemcheckbox',{name:'GitHub',exact:true})).toBeEnabled();await page.keyboard.press('Escape');expect((await call(request,'refresh_attention')).scan?.id).toBe(before.scan?.id);expect((await call(request,'list_attention')).items).toEqual(before.items);await expect(page.locator('.inbox-update-warning')).toHaveCount(0);
});
test('active runs keep the dropdown available and lock source changes',async({page})=>{
 const store=new SauronStore(path);try{store.beginScan();}finally{store.close();}
 await page.goto(origin);await page.getByRole('button',{name:'Refreshing…',exact:true}).click();await expect(page.getByRole('menuitemcheckbox',{name:'GitHub',exact:true})).toBeDisabled();await expect(page.getByRole('menuitem',{name:'Refresh now',exact:true})).toBeDisabled();await expect(page.getByText('Available when this update finishes.')).toBeVisible();
});
for(const theme of ['light','dark'] as const)test(`source menu fits narrow ${theme} panels`,async({page},testInfo)=>{
 await page.emulateMedia({colorScheme:theme});await page.setViewportSize({width:375,height:850});await page.goto(origin);await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('menuitemcheckbox',{name:'Meetings (Granola)',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath(`sources-${theme}-375.png`),fullPage:true});
 for(const width of [320,1100]){await page.setViewportSize({width,height:850});await expect.poll(()=>page.locator('html').evaluate(element=>element.scrollWidth<=window.innerWidth)).toBe(true);await expect(page.getByRole('menu')).toBeVisible();await page.screenshot({path:testInfo.outputPath(`sources-${theme}-${width}.png`),fullPage:true});}
});
