import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {SauronStore} from '../src/server/store.js';
import {syntheticObservation} from '../src/shared/contracts.js';
import {discussionConversationUrl} from '../src/server/discussion-context.js';

test('discussion links survive observations and restart without changing tasks or decisions',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-discussions-')),path=join(dir,'fixture.sqlite');
  let store=new SauronStore(path);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  store.upsert({batchId:'fixture',items:[syntheticObservation()]});
  store.decide({id:'synthetic:review-proof',expectedVersion:1,operationId:randomUUID(),action:'complete'});
  const before=store.view(),url=`https://chatgpt.com/c/${randomUUID()}`;
  const request={expectedStoreId:store.storeId,taskId:before.items[0].id,url};
  const saved=store.saveDiscussion({...request,url:url+'?model=test#ignored'});
  assert.deepEqual(saved.items,before.items);assert.equal(saved.discussion?.url,url);
  assert.equal(store.saveDiscussion(request).receipt?.duplicate,true);
  const otherUrl=`codex://threads/${randomUUID()}`;
  assert.equal(store.saveDiscussion({...request,url:otherUrl}).discussions?.length,2);
  store.upsert({batchId:'later',items:[syntheticObservation(2)]});
  const after=store.view();assert.equal(after.items[0].state,'done');
  store.close();store=new SauronStore(path);
  assert.equal(store.storeId,before.storeId);assert.deepEqual(store.view().items,after.items);
  assert.deepEqual(store.view().discussions,after.discussions);
  assert.deepEqual(new Set(store.view().discussions?.map(link=>link.url)),new Set([url,otherUrl]));
});

test('wrong stores, unknown entries and non-conversation URLs cannot create discussion links',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-discussion-validation-')),store=new SauronStore(join(dir,'fixture.sqlite'));
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  store.upsert({batchId:'fixture',items:[syntheticObservation()]});
  const before=store.view(),request={expectedStoreId:store.storeId,taskId:before.items[0].id,url:`https://chatgpt.com/c/${randomUUID()}`};
  assert.throws(()=>store.saveDiscussion({...request,expectedStoreId:randomUUID()}),/Store ID/);
  assert.throws(()=>store.saveDiscussion({...request,taskId:'synthetic:missing'}),/no longer exists/);
  for(const url of ['javascript:alert(1)','https://chatgpt.com.evil.invalid/c/'+randomUUID(),'https://user@chatgpt.com/c/'+randomUUID(),'https://chatgpt.com/share/'+randomUUID(),'codex://settings/'+randomUUID()])assert.throws(()=>store.saveDiscussion({...request,url}));
  assert.deepEqual(store.view().items,before.items);assert.deepEqual(store.view().discussions,[]);
});

test('automatic linking derives identity from per-call metadata and refuses absent or malformed identities',()=>{
  const id=randomUUID(),other=randomUUID();
  assert.equal(discussionConversationUrl({'openai/conversationId':id,'openai/threadId':other}),`https://chatgpt.com/c/${id}`);
  assert.equal(discussionConversationUrl({'openai/threadId':id}),`codex://threads/${id}`);
  assert.equal(discussionConversationUrl({'x-codex-turn-metadata':JSON.stringify({thread_id:id})}),`codex://threads/${id}`);
  assert.equal(discussionConversationUrl({thread:{id}}),`codex://threads/${id}`);
  for(const meta of [undefined,{}, {'openai/threadId':'not-a-thread'}, {'x-codex-turn-metadata':'invalid'}])assert.equal(discussionConversationUrl(meta),undefined);
});

test('the real MCP tool saves the host conversation idempotently and exposes pasted links only to the app',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-discussion-mcp-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const client=new Client({name:'discussion-mcp-test',version:'1.0.0'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/server/index.js')],env:{ATTENTION_DB:join(dir,'fixture.sqlite')},stderr:'pipe'}));
    await client.callTool({name:'upsert_attention_items',arguments:{batchId:'fixture',items:[syntheticObservation()]}});
    const before=(await client.callTool({name:'list_attention',arguments:{}})).structuredContent as any;
    const args={expectedStoreId:before.storeId,taskId:before.items[0].id};
    const missing=await client.callTool({name:'link_attention_discussion',arguments:args});assert.equal(missing.isError,true);
    const id=randomUUID(),request={name:'link_attention_discussion',arguments:args,_meta:{'x-codex-turn-metadata':JSON.stringify({thread_id:id})}};
    const saved=await client.callTool(request);assert.ok(!saved.isError);
    assert.equal((saved.structuredContent as any).discussion.url,`codex://threads/${id}`);
    const replay=await client.callTool(request);assert.equal((replay.structuredContent as any).receipt.duplicate,true);
    assert.equal(Object.prototype.hasOwnProperty.call(replay.structuredContent,'items'),false);
    assert.deepEqual(((await client.callTool({name:'list_attention',arguments:{}})).structuredContent as any).items,before.items);
    const {tools}=await client.listTools();
    assert.deepEqual((tools.find(tool=>tool.name==='save_attention_discussion_link')!._meta?.ui as any).visibility,['app']);
  }finally{await client.close();}
});
