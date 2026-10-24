import { test,expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { canonicalSourceUrl } from '../../src/shared/contracts.js';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync,rmSync,writeFileSync,mkdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('official AppBridge harness renders Inbox and completes through stdio tools',async({page})=>{
  await page.setViewportSize({width:1440,height:1100});
  const dir=mkdtempSync(join(tmpdir(),'attention-app-bridge-'));
  const runtime=join(dir,'runtime.cjs');
  writeFileSync(runtime,`#!/usr/bin/env node\nconst fs=require('node:fs');let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const marker='Approved immutable payload (JSON DATA): ';const sending=input.includes(marker);const payload=sending?JSON.parse(input.split(marker)[1]):null;const preparing=input.includes('Prepare a LOCAL reply draft');const result=sending?{status:'sent',channelId:payload.channel_id,threadTs:payload.thread_ts,text:payload.message,messageUrl:'https://example.slack.com/archives/C123/p1792313088000000',detail:'Fixture',verified:true}:preparing?{channelId:'C123',threadTs:'1792313070.000000',destination:'#test-discussion',text:'Thanks! Could you share an example?'}:{sources:{slack:{status:'checked',detail:'Test fixture'},granola:{status:'checked',detail:'Test fixture'}},items:[]};setTimeout(()=>fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify(result)),1200);});`,{mode:0o700});
  async function start(){
    const client=new Client({name:'attention-app-bridge-test',version:'1.0.0'});
    await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/server/index.js')],
      env:{ATTENTION_DB:join(dir,'app.sqlite'),SAURON_CODEX_BIN:runtime},stderr:'pipe'}));
    return client;
  }
  let client=await start();
  try{
    const tools=await client.listTools();
    const uri=(tools.tools.find(tool=>tool.name==='open_attention')!._meta!.ui as any).resourceUri;
    expect(uri).toBe('ui://attention/list-v1');
    const resource=await client.readResource({uri});
    const html=(resource.contents[0] as {text:string}).text;
    await page.exposeFunction('attentionMcp',async(params:{name:string;arguments?:Record<string,unknown>})=>client.callTool(params));
    const harness=await build({stdin:{contents:`
      import { AppBridge,PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
      window.startSauronHarness=async(html)=>{
        const frame=document.querySelector('iframe');
        const bridge=new AppBridge(null,{name:'SauronTestHost',version:'1.0.0'},
          {serverTools:{},openLinks:{}},{hostContext:{theme:'light',displayMode:'fullscreen',
          availableDisplayModes:['fullscreen'],safeAreaInsets:{top:0,bottom:0,left:0,right:0}}});
        bridge.oncalltool=params=>window.attentionMcp(params);
        window.sendSauronSavedView=async()=>bridge.sendToolResult(await window.attentionMcp({name:'list_attention',arguments:{}}));
        window.sendSauronView=async(view)=>bridge.sendToolResult({content:[],structuredContent:view});
        bridge.onopenlink=async({url})=>{document.querySelector('output').textContent=url;return {};};
        bridge.oninitialized=async()=>{
          await bridge.sendToolInput({arguments:{}});
          await bridge.sendToolResult(await window.attentionMcp({name:'open_attention',arguments:{}}));
        };
        await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
        frame.srcdoc=html;
      };
    `,resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife'});
    await page.setContent('<h1>Local MCP Apps test harness</h1><output></output><iframe title="Sauron" sandbox="allow-scripts" style="width:100%;height:850px;border:0"></iframe>');
    await page.addScriptTag({content:harness.outputFiles[0].text});
    await page.evaluate(html=>(window as any).startSauronHarness(html),html);
    const app=page.frameLocator('iframe');
    await expect(app.getByRole('button',{name:'Add task',exact:true})).toBeEnabled();
    await expect(app.getByRole('heading',{name:'Start with one task',exact:true})).toBeVisible();
    await app.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(app.getByRole('button',{name:'Refreshing…',exact:true})).toBeDisabled();
    await expect(app.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled({timeout:10000});
    await app.getByRole('button',{name:'Diagnostics',exact:true}).click();
    await expect(app.getByText('MCP app · Local store')).toBeVisible();
    await app.getByRole('button',{name:'Create synthetic task',exact:true}).click();
    await app.getByRole('button',{name:'Close diagnostics'}).click();
    await app.getByRole('button',{name:/^Review the synthetic launch note/}).click();
    await app.getByRole('button',{name:'Open sample source'}).click();
    await expect(page.locator('output')).toHaveText('https://example.invalid/attention/review-proof');
    const beforeComplete=(await client.callTool({name:'list_attention',arguments:{}})).structuredContent as any;
    await app.getByRole('button',{name:/^Complete /}).click();
    await expect(app.getByRole('button',{name:/^History 1/})).toBeVisible();
    const result=await client.callTool({name:'list_attention',arguments:{}});
    expect((result.structuredContent as any).items[0].state).toBe('done');
    // Two responses can carry the same millisecond readAt. A delayed pre-save
    // host result must not visually undo the newer saved task version.
    const unrelated=(await client.callTool({name:'upsert_attention_items',arguments:{batchId:'unrelated-saved-task',items:[{
      obligationKey:'synthetic:waiting',sourceVersion:1,provider:'manual',title:'Unrelated saved task',nextAction:'Waiting for a synthetic fixture.',
      sourceState:'waiting',sourceUrl:'https://example.invalid/unrelated',lastCheckedAt:new Date().toISOString(),
    }]}})).structuredContent as any;
    await page.evaluate(view=>(window as any).sendSauronView(view),{...unrelated,
      items:unrelated.items.map((task:any)=>task.id===beforeComplete.items[0].id?beforeComplete.items[0]:task),
      readAt:(result.structuredContent as any).readAt});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await expect(app.getByRole('button',{name:/^History 1/})).toBeVisible();
    await expect(app.getByRole('radio',{name:/^Waiting 1/})).toBeVisible();
    expect(await app.getByRole('button',{name:/^Complete /}).count()).toBe(0);
    const sample=(result.structuredContent as any).items[0];
    await client.callTool({name:'upsert_attention_items',arguments:{batchId:'host-new-observation',items:[{
      obligationKey:sample.obligationKey,sourceVersion:sample.sourceVersion+1,provider:'manual',
      title:sample.title,nextAction:'Replayed through the supported MCP tool.',sourceState:'needs_you',sourceUrl:sample.sourceUrl,lastCheckedAt:new Date().toISOString(),
    }]}});
    await client.close();client=await start();
    await page.evaluate(()=>(window as any).sendSauronSavedView());
    await app.getByRole('button',{name:/^History 1/}).click();
    await expect(app.getByRole('heading',{name:sample.title,exact:true})).toBeVisible();
    await app.getByRole('button',{name:new RegExp('^'+sample.title)}).click();
    await expect(app.getByText('Your completion is saved. Source updates do not reopen this task.')).toBeVisible();
    const restarted=(await client.callTool({name:'list_attention',arguments:{}})).structuredContent as any;
    expect(restarted.storeId).toBe(beforeComplete.storeId);expect(restarted.items[0].state).toBe('done');
    mkdirSync('docs/evidence/repair-0.6.5',{recursive:true});
    writeFileSync('docs/evidence/repair-0.6.5/mcp-app-persistence.json',JSON.stringify({check:'MCP create → rendered completion → delayed saved view → replay → real stdio process restart → rendered Done',...restarted},null,2));
    await page.screenshot({path:'docs/evidence/repair-0.6.5/mcp-app-after-restart.png',fullPage:true});
    await app.getByRole('button',{name:'Add task',exact:true}).click();
    await app.getByLabel('Task name',{exact:true}).fill('Personal task through MCP Apps');
    // The app must submit through its tool API even in a host without allow-forms.
    await page.keyboard.press('Enter');
    await expect(app.getByRole('heading',{name:'Personal task through MCP Apps',exact:true})).toBeVisible();
    await app.getByRole('button',{name:/^Complete /}).click();
    await expect(app.getByRole('button',{name:/^History 2/})).toBeVisible();
    const personal=await client.callTool({name:'list_attention',arguments:{}});
    expect((personal.structuredContent as any).items.find((t:any)=>t.provider==='personal').state).toBe('done');
    await app.getByRole('button',{name:'Reopen task',exact:true}).click();
    await expect(app.getByRole('heading',{name:'Personal task through MCP Apps',exact:true})).toBeVisible();
    const reopened=await client.callTool({name:'list_attention',arguments:{}});
    expect((reopened.structuredContent as any).items.find((t:any)=>t.provider==='personal').state).toBe('needs_you');
    const seeded=await client.callTool({name:'upsert_attention_items',arguments:{batchId:'slack-reply-fixture',items:[{
      obligationKey:'slack:'+createHash('sha256').update(JSON.stringify([canonicalSourceUrl('slack','https://example.slack.com/archives/C123/p1792313076000000'),'Please review'])).digest('hex'),provider:'slack',sourceVersion:1,sourceKind:'slack',
      sourceUrl:'https://example.slack.com/archives/C123/p1792313076000000',actionKey:'Please review',
      title:'Slack discussion through MCP Apps',nextAction:'Reply to the discussion.',sourceState:'needs_you',resolved:false,lastCheckedAt:new Date().toISOString(),
    }]}});
    expect(seeded.isError).toBeUndefined();
    // Refresh is a source scan and would resolve this unobserved fixture.
    // Deliver the saved tool result as the host does after an explicit upsert.
    await page.evaluate(()=>(window as any).sendSauronSavedView());
    await expect(app.getByRole('heading',{name:'Slack discussion through MCP Apps',exact:true})).toBeVisible();
    await app.getByRole('button',{name:/^Slack discussion through MCP Apps/}).click();
    await app.getByRole('button',{name:'Prepare reply'}).click();
    const editor=app.getByLabel('Reply draft',{exact:true});await expect(editor).toHaveValue('Thanks! Could you share an example?');
    await editor.fill('Edited reply through the MCP bridge.');await app.getByRole('button',{name:'Copy reply'}).click();
    await expect(app.getByText('Reply selected. Press ⌘C or Ctrl+C to copy.')).toBeVisible();
    await app.getByRole('button',{name:'Send to Slack'}).click();await expect(app.getByText('Sent to Slack',{exact:true})).toBeVisible();
    await expect(editor).toHaveValue('Edited reply through the MCP bridge.');
    await app.getByRole('button',{name:'Open sent reply'}).click();
    await expect(page.locator('output')).toHaveText('https://example.slack.com/archives/C123/p1792313088000000');
  }finally{await client.close();rmSync(dir,{recursive:true,force:true});}
});
