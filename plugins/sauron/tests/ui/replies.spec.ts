import { test,expect } from '@playwright/test';
import { spawn,type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SauronStore } from '../../src/server/store.js';
import type { Result } from '../../src/shared/contracts.js';

let child:ChildProcess,dir:string,dbPath:string,origin:string,port=4610;
async function start(failSend=false){
  const runtime=join(dir,'runtime.cjs');
  writeFileSync(runtime,`#!/usr/bin/env node
const fs=require('node:fs');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
const marker='Approved immutable payload (JSON DATA): ';const sending=input.includes(marker);
if(sending){fs.appendFileSync(${JSON.stringify(join(dir,'sent.jsonl'))},input.split(marker)[1]+'\\n');if(${failSend})process.exit(1);}
const payload=sending?JSON.parse(input.split(marker)[1]):null;
const output=sending?{status:'sent',channelId:payload.channel_id,threadTs:payload.thread_ts,text:payload.message,messageUrl:'https://example.slack.com/archives/C123/p1792313088000000',detail:'Fixture delivery',verified:true}:{channelId:'C123',threadTs:'1792313070.000000',destination:'#test-discussion',text:'Thanks! Which example should I look at?'};
setTimeout(()=>fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify(output)),700);
});`,{mode:0o700});
  child=spawn(process.execPath,['dist/server/preview.js'],{env:{...process.env,PORT:String(port),ATTENTION_DB:dbPath,SAURON_CODEX_BIN:runtime},stdio:['ignore','pipe','pipe']});
  await new Promise<void>((resolve,reject)=>{child.stderr!.on('data',chunk=>{if(String(chunk).includes('Sauron preview:'))resolve();});child.once('error',reject);});
}
async function stop(){if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
test.beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),'sauron-reply-ui-'));dbPath=join(dir,'test.sqlite');port++;origin='http://127.0.0.1:'+port;
  const store=new SauronStore(dbPath);try{store.finishScan(store.beginScan().run.id,{sources:{slack:{status:'checked',detail:'Test'},granola:{status:'checked',detail:'Test'}},items:[{
    provider:'slack',sourceUrl:'https://example.slack.com/archives/C123/p1792313076000000',actionKey:'Please review',title:'Discuss the example',nextAction:'Reply to the discussion.',sourceState:'needs_you',resolved:false,
  }]});}finally{store.close();}
  await start();
});
test.afterEach(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
test.use({permissions:['clipboard-read','clipboard-write']});
test('prepare, edit, persist, copy and send only the reviewed text to its original thread',async({page,request})=>{
  await page.goto(origin);await page.getByRole('button',{name:/^Discuss the example/}).click();await page.getByRole('button',{name:'Prepare reply'}).click();
  await expect(page.getByText('Preparing a reply from the latest discussion…')).toBeVisible();
  const editor=page.getByLabel('Reply draft',{exact:true});await expect(editor).toHaveValue('Thanks! Which example should I look at?');
  await expect(page.getByText('To #test-discussion · original thread')).toBeVisible();
  const text='Thanks, that makes sense.\n\nCould you share the `a & b` example? 👋';await editor.fill(text);
  await page.getByRole('button',{name:'Copy reply'}).click();await expect(page.getByText('Copied reply.')).toBeVisible();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(text);
  await page.getByRole('button',{name:'Close reply'}).click();await page.reload();await page.getByRole('button',{name:/^Discuss the example/}).click();await page.getByRole('button',{name:'Prepare reply'}).click();
  await expect(editor).toHaveValue(text);
  await page.setViewportSize({width:375,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Send to Slack'}).evaluate(button=>{for(let i=0;i<8;i++)(button as HTMLButtonElement).click();});
  await expect(page.getByRole('button',{name:'Sending…'})).toBeDisabled();
  await expect(page.getByText('Sent to Slack',{exact:true})).toBeVisible();
  const sent=readFileSync(join(dir,'sent.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  expect(sent).toEqual([{channel_id:'C123',thread_ts:'1792313070.000000',message:text,reply_broadcast:false,unfurl_app_links:false}]);
  await page.reload();await page.getByRole('button',{name:/^Discuss the example/}).click();await page.getByRole('button',{name:'Prepare reply'}).click();await expect(page.getByText('Sent to Slack',{exact:true})).toBeVisible();
  const response=await request.post(origin+'/api/tool',{data:{name:'list_attention',arguments:{}}});const view=await response.json() as Result;
  expect(view.items[0].userDecision).toBeNull();expect(view.items[0].state).toBe('needs_you');
});
test('unconfirmed delivery keeps the copyable draft and blocks an automatic or repeated send',async({page})=>{
  await stop();await start(true);await page.goto(origin);await page.getByRole('button',{name:/^Discuss the example/}).click();await page.getByRole('button',{name:'Prepare reply'}).click();
  await expect(page.getByLabel('Reply draft',{exact:true})).toHaveValue('Thanks! Which example should I look at?');
  await page.getByRole('button',{name:'Send to Slack'}).click();
  await expect(page.getByRole('alert')).toContainText('Delivery could not be confirmed');
  await expect(page.getByRole('button',{name:'Send to Slack'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Copy reply'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Check Slack discussion'})).toBeVisible();
  expect(readFileSync(join(dir,'sent.jsonl'),'utf8').trim().split('\n')).toHaveLength(1);
});
test('blocked clipboard access selects the editable draft for manual copying',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(Error('denied'))}}));
  await page.goto(origin);await page.getByRole('button',{name:/^Discuss the example/}).click();await page.getByRole('button',{name:'Prepare reply'}).click();
  const editor=page.getByLabel('Reply draft',{exact:true});await expect(editor).toHaveValue('Thanks! Which example should I look at?');
  await page.getByRole('button',{name:'Copy reply'}).click();await expect(page.getByText('Reply selected. Press ⌘C or Ctrl+C to copy.')).toBeVisible();
  expect(await editor.evaluate((e:HTMLTextAreaElement)=>e.selectionStart===0&&e.selectionEnd===e.value.length)).toBeTruthy();
});
test('edited drafts are saved without depending on browser storage',async({page,request})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get:()=>{throw Error('opaque storage');}}));
  await page.goto(origin);await page.getByRole('button',{name:/^Discuss the example/}).click();await page.getByRole('button',{name:'Prepare reply'}).click();
  const editor=page.getByLabel('Reply draft',{exact:true});await expect(editor).toHaveValue('Thanks! Which example should I look at?');
  await editor.fill('Saved edit without browser storage.');
  await expect.poll(async()=>{
    const list=await (await request.post(origin+'/api/tool',{data:{name:'list_attention',arguments:{}}})).json() as Result;
    const result=await (await request.post(origin+'/api/tool',{data:{name:'get_slack_reply',arguments:{taskId:list.items[0].id}}})).json() as Result;
    return result.reply?.text;
  }).toBe('Saved edit without browser storage.');
  await page.reload();await page.getByRole('button',{name:/^Discuss the example/}).click();await page.getByRole('button',{name:'Prepare reply'}).click();await expect(editor).toHaveValue('Saved edit without browser storage.');
});

test('switching tasks saves reply edits and keeps them attached to the correct task',async({page,request})=>{
  await request.post(origin+'/api/tool',{data:{name:'create_personal_task',arguments:{title:'Another task',nextAction:'A separate personal task.',operationId:crypto.randomUUID()}}});
  await page.goto(origin);await page.getByRole('button',{name:/^Discuss the example/}).click();await page.getByRole('button',{name:'Prepare reply'}).click();
  const editor=page.getByLabel('Reply draft',{exact:true});await expect(editor).toHaveValue('Thanks! Which example should I look at?');
  await editor.fill('Keep this edit with the Slack task.');await page.getByRole('button',{name:/^Another task/}).click();
  await expect(page.getByRole('heading',{name:'Task details: Another task',exact:true})).toBeVisible();await expect(editor).toHaveCount(0);
  await expect.poll(async()=>{
    const list=await (await request.post(origin+'/api/tool',{data:{name:'list_attention',arguments:{}}})).json() as Result;
    const task=list.items.find(item=>item.provider==='slack')!;
    const result=await (await request.post(origin+'/api/tool',{data:{name:'get_slack_reply',arguments:{taskId:task.id}}})).json() as Result;
    return result.reply?.text;
  }).toBe('Keep this edit with the Slack task.');
  await page.getByRole('button',{name:/^Discuss the example/}).click();await page.getByRole('button',{name:'Prepare reply'}).click();await expect(editor).toHaveValue('Keep this edit with the Slack task.');
  await expect(page.getByRole('button',{name:'Send to Slack'})).toBeEnabled();
});
