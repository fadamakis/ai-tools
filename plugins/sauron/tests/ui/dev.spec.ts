import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {seedDevStore} from '../../src/server/dev-fixtures.js';
import type {Result} from '../../src/shared/contracts.js';

const devBuild=process.env.SAURON_DEV_UI_BUILD;
test('Sauron Dev shows its build, simulates refresh and replies, and routes discussion to Dev',async({page})=>{
  expect(devBuild,'Run pnpm test:ui, or provide SAURON_DEV_UI_BUILD pointing to a complete Dev test build.').toBeTruthy();
  for(const file of ['server/dev-runtime.js','ui/index.html'])expect(existsSync(join(devBuild!,file)),`Missing Dev artifact ${file}. Run pnpm test:ui to build it.`).toBe(true);
  const dir=mkdtempSync(join(tmpdir(),'sauron-dev-ui-'));
  const database=join(dir,'attention.sqlite');
  const client=new Client({name:'dev-ui-test',version:'1.0.0'});
  try{
    seedDevStore(database);
    await client.connect(new StdioClientTransport({command:process.execPath,args:[join(devBuild!,'server/dev-runtime.js')],env:{ATTENTION_DB:database,SAURON_DEV_BUILD_ID:basename(devBuild!)},stderr:'pipe'}));
    const resource=await client.readResource({uri:'ui://attention/list-v1'});
    const html=(resource.contents[0] as {text:string}).text;
    await page.exposeFunction('devTool',async(params:any)=>client.callTool(params));
    const harness=await build({stdin:{contents:`
      import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
      import {OpenAIMessageParamsSchema} from '@openai/mcp-extensions/app';
      import {z} from 'zod';
      window.devMessages=[];
      window.mountDev=async(html)=>{
        const frame=document.querySelector('iframe');
        const bridge=new AppBridge(null,{name:'SauronDevTestHost',version:'1.0.0'},
          {serverTools:{},openLinks:{},message:{text:{}},experimental:{'openai/message':{}}},
          {hostContext:{theme:'light',displayMode:'fullscreen',availableDisplayModes:['fullscreen']}});
        bridge.oncalltool=params=>window.devTool(params);
        bridge.onopenlink=async()=>({});
        bridge.setRequestHandler(z.object({method:z.literal('ui/message'),params:OpenAIMessageParamsSchema}),async({params})=>{window.devMessages.push(params);return {};});
        bridge.oninitialized=async()=>bridge.sendToolResult(await window.devTool({name:'list_attention',arguments:{}}));
        await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));frame.srcdoc=html;
      };
    `,resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife'});
    await page.setViewportSize({width:1100,height:1000});
    await page.setContent('<iframe title="Sauron Dev" sandbox="allow-scripts" style="width:100%;height:950px;border:0"></iframe>');
    await page.addScriptTag({content:harness.outputFiles[0].text});
    await page.evaluate(html=>(window as any).mountDev(html),html);
    const app=page.frameLocator('iframe');
    await expect(app.getByText('Sauron Dev',{exact:true})).toBeVisible();
    await expect(app.locator('[data-dev-build]')).toHaveAttribute('data-dev-build',basename(devBuild!));
    await app.getByRole('button',{name:/^Fixture: review a Slack reply/}).click();
    await app.getByRole('button',{name:'Prepare reply',exact:true}).click();
    await expect(app.getByRole('textbox',{name:'Reply draft'})).toHaveValue(/Simulated reply/);
    await app.getByRole('textbox',{name:'Reply draft'}).fill('Edited fixture reply.');
    await app.getByRole('button',{name:'Simulate send',exact:true}).click();
    await expect(app.getByText('Simulated send complete',{exact:true})).toBeVisible();
    await app.getByRole('button',{name:'Discuss in new chat',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).devMessages.length)).toBe(1);
    const text=await page.evaluate(()=>(window as any).devMessages[0].content[0].text);
    expect(text).toContain('plugin://sauron-dev@sauron-dev');
    expect(text).not.toContain('plugin://sauron@ai-tools');
    const beforeSources=await client.callTool({name:'list_attention',arguments:{}});
    await app.getByRole('button',{name:'Refresh',exact:true}).click();
    await app.getByRole('menuitemcheckbox',{name:'GitHub',exact:true}).click();
    await expect(app.getByRole('menuitemcheckbox',{name:'GitHub',exact:true})).not.toBeChecked();
    const afterSources=await client.callTool({name:'list_attention',arguments:{}});
    expect((afterSources.structuredContent as any).items).toEqual((beforeSources.structuredContent as any).items);
    expect((afterSources.structuredContent as any).sourcePreferences.enabled.github).toBe(false);
    await app.getByRole('menuitem',{name:'Refresh now',exact:true}).click();
    await expect.poll(async()=>((await client.callTool({name:'list_attention',arguments:{}})).structuredContent as Result).scan?.id).not.toBe((beforeSources.structuredContent as Result).scan?.id);
    await expect(app.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();
  }finally{await client.close();rmSync(dir,{recursive:true,force:true});}
});
