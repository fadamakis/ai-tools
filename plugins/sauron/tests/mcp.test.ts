import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { syntheticObservation, type Result } from '../src/shared/contracts.js';

test('MCP discovery, {} global opening, app resource, replay and real process restart',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'attention-mcp-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  async function start(){
    const client=new Client({name:'attention-test',version:'1.0.0'},
      {versionNegotiation:{mode:{pin:'2026-07-28'}}});
    const transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/server/index.js')],env:{ATTENTION_DB:join(dir,'test.sqlite')},stderr:'pipe'});
    await client.connect(transport);return client;
  }
  let client=await start();
  try{
    const {tools}=await client.listTools();
    const entry=tools.find(t=>t.name==='open_attention')!;
    assert.deepEqual((entry._meta?.['openai/ui'] as any).entrypoints,[{type:'global'}]);
    assert.deepEqual((entry._meta?.ui as any).visibility,['app']);
    assert.equal(entry.icons?.[0].mimeType,'image/svg+xml');
    assert.deepEqual(entry.icons?.[0].sizes,['any']);
    assert.equal(Buffer.from(entry.icons![0].src.split(',')[1],'base64').toString(),readFileSync('assets/sidebar-icon.svg','utf8'));
    assert.deepEqual((tools.find(t=>t.name==='create_personal_task')!._meta?.ui as any).visibility,['app']);
    assert.equal((await client.callTool({name:'open_attention',arguments:{}})).isError,undefined);
    assert.equal((entry._meta?.ui as any).resourceUri,'ui://attention/list-v1');
    const resource=await client.readResource({uri:(entry._meta?.ui as any).resourceUri});
    assert.equal(tools.some(t=>t.name==='set_attention_layout'),false);
    for(const uri of ['ui://attention/list-v0.6.6','ui://attention/list-v0.6.5','ui://attention/list-v0.6.4','ui://attention/list-v0.6.3','ui://attention/list-v0.6.2','ui://attention/list-v0.6.1','ui://attention/list-v0.6.0','ui://attention/list-v0.5.0','ui://attention/list-v0.4.2','ui://attention/list-v0.4.1','ui://attention/list-v0.4.0','ui://attention/list-v0.3.1']){
      const previous=await client.readResource({uri});
      assert.deepEqual(previous.contents,resource.contents.map(item=>({...item,uri})));
    }
    const legacy=await client.readResource({uri:'ui://attention/list-v1'});
    assert.deepEqual(legacy.contents.map(item=>'text' in item?item.text:null),resource.contents.map(item=>'text' in item?item.text:null));
    assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
    assert.ok('text' in resource.contents[0] && resource.contents[0].text.includes('<div id="root">'));
    const before=(await client.callTool({name:'list_attention',arguments:{}})).structuredContent as Result;
    const runId=randomUUID();const identity={runId,expectedStoreId:before.storeId};
    const started=(await client.callTool({name:'sync_attention',arguments:{request:{...identity,phase:'start'}}})).structuredContent as Result;
    assert.equal(started.sync?.status,'running');
    const finished=(await client.callTool({name:'sync_attention',arguments:{request:{...identity,phase:'finish',checkedAt:new Date().toISOString(),
      sources:Object.fromEntries(['slack','granola','jira','github','calendar'].map(provider=>[provider,{status:'checked',detail:'Isolated synthetic empty fixture'}])),items:[]}}})).structuredContent as Result;
    assert.equal(finished.sync?.status,'completed');assert.ok(finished.sync?.lastSuccessAt);
    const batch={batchId:'mcp-proof',items:[syntheticObservation()]};
    const created=(await client.callTool({name:'upsert_attention_items',arguments:batch})).structuredContent as Result;
    await client.callTool({name:'decide_attention_item',arguments:{id:created.items[0].id,expectedVersion:created.items[0].version,action:'complete',operationId:'mcp-complete'}});
    assert.equal(((await client.callTool({name:'upsert_attention_items',arguments:batch})).structuredContent as Result).items[0].state,'done');
    await client.close();client=await start();
    const persisted=(await client.callTool({name:'list_attention',arguments:{}})).structuredContent as Result;
    assert.equal(persisted.items.length,1);assert.equal(persisted.items[0].state,'done');
    const invalid=await client.callTool({name:'upsert_attention_items',arguments:{...batch,items:[{...batch.items[0],provider:'slack'}]}});
    assert.equal(invalid.isError,true);
  }finally{await client.close();}
});
test('legacy MCP SDK 1 client can discover and open the SDK 2 service',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'attention-legacy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const client=new LegacyClient({name:'legacy-test',version:'1.0.0'});
  try{await client.connect(new LegacyTransport({command:process.execPath,args:[resolve('dist/server/index.js')],env:{ATTENTION_DB:join(dir,'legacy.sqlite')},stderr:'pipe'}));
    assert.equal((await client.listTools()).tools.length,17);
    assert.equal((await client.callTool({name:'open_attention',arguments:{}})).isError,undefined);
  }finally{await client.close();}
});
test('portable manifests match the actual built entrypoint',()=>{
  const plugin=JSON.parse(readFileSync('plugin.json','utf8'));const mcp=JSON.parse(readFileSync('mcp.json','utf8'));
  assert.equal(plugin.name,'sauron');assert.ok(plugin.extensions['com.openai'].interface.shortDescription.length<=30);
  assert.equal(mcp.mcpServers.sauron.args[0],'${PLUGIN_ROOT}/dist/server/index.js');
  assert.ok(readFileSync('dist/server/index.js','utf8').length>0);
});
