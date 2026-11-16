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
  const existingThread=randomUUID(),otherUrl=`codex://threads/${existingThread}`;
  assert.equal(store.saveDiscussion({...request,url:otherUrl}).discussions?.length,2);
  const reused=store.trackCodexThreads({expectedStoreId:store.storeId,threads:[{threadId:existingThread,title:'Existing linked chat'}]});
  assert.equal(reused.trackedThreads?.[0]?.status,'already_tracked');
  assert.equal(reused.trackedThreads?.[0]?.taskId,before.items[0].id);
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

test('selected Codex chats create linked tasks once and preserve decisions across restart',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-tracked-chats-')),path=join(dir,'fixture.sqlite');
  let store=new SauronStore(path);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const first=randomUUID(),second=randomUUID(),request={expectedStoreId:store.storeId,threads:[
    {threadId:first,title:'First selected chat'},
    {threadId:second,title:'Second selected chat',nextAction:'Continue the conversation.'},
  ]};
  const created=store.trackCodexThreads(request);
  assert.deepEqual(created.trackedThreads?.map(item=>item.status),['created','created']);
  assert.equal(created.items.length,2);
  assert.deepEqual(new Set(created.discussions?.map(link=>link.url)),new Set([`codex://threads/${first}`,`codex://threads/${second}`]));
  const firstTask=created.items.find(item=>item.id===`personal:${first}`)!;
  store.decide({id:firstTask.id,expectedVersion:firstTask.version,operationId:randomUUID(),action:'complete'});
  const replay=store.trackCodexThreads({...request,threads:[{threadId:first,title:'Renamed chat'},{threadId:second,title:'Second selected chat'}]});
  assert.deepEqual(replay.trackedThreads?.map(item=>item.status),['already_tracked','already_tracked']);
  assert.equal(replay.items.find(item=>item.id===firstTask.id)?.state,'done');
  assert.equal(replay.items.find(item=>item.id===firstTask.id)?.title,'First selected chat');
  store.close();store=new SauronStore(path);
  assert.equal(store.view().items.length,2);
  assert.equal(store.view().discussions?.length,2);
  assert.deepEqual(store.trackCodexThreads(request).trackedThreads?.map(item=>item.status),['already_tracked','already_tracked']);
});

test('tracking reports a colliding chat separately and never writes to the wrong store',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-tracked-chat-errors-')),store=new SauronStore(join(dir,'fixture.sqlite'));
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const collision=randomUUID(),good=randomUUID();
  store.createPersonal({operationId:collision,title:'Unrelated personal task'});
  const request={expectedStoreId:store.storeId,threads:[{threadId:collision,title:'Collision'},{threadId:good,title:'Good chat'}]};
  assert.throws(()=>store.trackCodexThreads({...request,expectedStoreId:randomUUID()}),/Store ID/);
  assert.throws(()=>store.trackCodexThreads({...request,threads:[request.threads[0],request.threads[0]]}),/distinct Codex chats/);
  const result=store.trackCodexThreads(request);
  assert.deepEqual(result.trackedThreads?.map(item=>item.status),['failed','created']);
  assert.equal(result.items.length,2);
  assert.equal(result.discussions?.length,1);
  assert.equal(result.items.find(item=>item.id===`personal:${collision}`)?.title,'Unrelated personal task');
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
    const selected=randomUUID();
    const tracked=await client.callTool({name:'track_codex_threads',arguments:{expectedStoreId:before.storeId,threads:[{threadId:selected,title:'Selected Codex chat'}]}});
    assert.equal(tracked.isError,undefined);
    assert.equal((tracked.structuredContent as any).trackedThreads[0].status,'created');
    assert.equal((tracked.structuredContent as any).discussions.find((link:any)=>link.taskId===`personal:${selected}`)?.url,`codex://threads/${selected}`);
  }finally{await client.close();}
});
