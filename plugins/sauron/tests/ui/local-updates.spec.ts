import {test,expect} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {SauronStore} from '../../src/server/store.js';
import {liveProviders} from '../../src/shared/contracts.js';

test('local status is honest, launch/online events coalesce and saved decisions survive',async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),'sauron-local-ui-')),path=join(dir,'test.sqlite'),marker=join(dir,'agent-started');
 const runtime=join(dir,'fixture.cjs');writeFileSync(runtime,`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected');`,{mode:0o700});
 const store=new SauronStore(path);const operationId=randomUUID();store.createPersonal({operationId,title:'Keep this completed task',nextAction:'Fixture',sourceState:'needs_you'});
 store.decide({id:'personal:'+operationId,operationId:randomUUID(),expectedVersion:1,action:'complete'});
 store.recordLocalRuntimeVerification({providers:Object.fromEntries(liveProviders.map(provider=>[provider,true])),observedTools:['slack.read','atlassian.read','github.read','google_calendar.read','granola.read'],cliVersion:'isolated-ui-fixture'});
 store.configureSync({expectedStoreId:store.storeId,operationId:randomUUID(),mode:'local_managed',expectedMode:'independent',expectedEpoch:0});
 store.updateLocalState({blocked:'offline',reason:'Offline. Catch-up will run when the connection is available.',lastAttemptAt:new Date().toISOString()});
 const before=store.view();store.close();let child:ChildProcess|undefined;
 try{
  child=spawn(process.execPath,['dist/server/preview.js'],{env:{...process.env,PORT:'4815',ATTENTION_DB:path,SAURON_CODEX_BIN:runtime},stdio:['ignore','ignore','pipe']});
  await new Promise<void>((resolve,reject)=>{child!.stderr!.on('data',chunk=>{if(String(chunk).includes('Sauron preview:'))resolve();});child!.once('error',reject);child!.once('exit',code=>reject(Error(`Preview exited ${code}`)));});
  await page.goto('http://127.0.0.1:4815');await expect(page.locator('.inbox-update-warning').filter({hasText:'Offline. Catch-up will run when the connection is available.'})).toBeVisible();
  await page.getByText('Update details',{exact:true}).click();await expect(page.getByText('This Mac checks Slack, meetings, Jira, GitHub and Calendar while available.',{exact:true})).toBeVisible();
  await page.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('online'));});
  await page.getByRole('button',{name:/^History/}).click();await expect(page.getByRole('heading',{name:'Keep this completed task',exact:true})).toBeVisible();
  expect(existsSync(marker)).toBe(false);mkdirSync('docs/evidence/local-updates',{recursive:true});await page.screenshot({path:'docs/evidence/local-updates/offline.png',fullPage:true});
  const after=new SauronStore(path);try{expect(after.storeId).toBe(before.storeId);expect(after.view().items).toEqual(before.items);expect(after.sync()).toBeNull();}finally{after.close();}
 }finally{if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
});
