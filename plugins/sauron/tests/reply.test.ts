import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SauronStore } from '../src/server/store.js';
import { runReply,preparePrompt,sendPrompt } from '../src/server/reply-worker.js';

const sourceUrl='https://example.slack.com/archives/C123/p1792313076000000';
const output={channelId:'C123',threadTs:'1792313070.000000',destination:'#test · original discussion',text:'Thanks, could you share the specific example?'};
function setup(t:any){
  const dir=mkdtempSync(join(tmpdir(),'sauron-reply-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let now=new Date('2026-10-18T17:00:00Z');const store=new SauronStore(join(dir,'store.sqlite'),()=>now);
  t.after(()=>store.close());
  store.finishScan(store.beginScan().run.id,{sources:{slack:{status:'checked',detail:'Test'},granola:{status:'checked',detail:'Test'}},items:[{
    provider:'slack',sourceUrl,actionKey:'Please review',title:'Review request',nextAction:'Reply in the thread.',sourceState:'needs_you',resolved:false,
  }]});
  const task=store.view().items[0];
  const prepare=()=>store.replies.beginPrepare({taskId:task.id,operationId:randomUUID()},task).reply;
  const ready=()=>{const reply=prepare();store.replies.finishPrepare(reply.id,output);return store.replies.byId(reply.id)!;};
  return {store,dir,task,prepare,ready,advance:()=>{now=new Date(now.getTime()+13*60_000);}};
}
test('preparation stays local, joins concurrent requests, verifies source and survives restart',t=>{
  const {store,task,dir,prepare}=setup(t);const before=JSON.stringify(store.view().items);
  const reply=prepare();assert.equal(prepare().id,reply.id);
  assert.throws(()=>store.replies.finishPrepare(reply.id,{...output,channelId:'C999'}));
  assert.throws(()=>store.replies.finishPrepare(reply.id,{...output,threadTs:'1792313079.000000'}));
  store.replies.finishPrepare(reply.id,output);
  const connection=new SauronStore(join(dir,'store.sqlite'));
  try{assert.deepEqual(connection.replies.latest(task.id),store.replies.latest(task.id));}finally{connection.close();}
  assert.equal(JSON.stringify(store.view().items),before);
});
test('sending preserves exact edited text, deduplicates operations and never completes a task',t=>{
  const {store,task,ready}=setup(t);const reply=ready();const text='Thanks, this helps.\n\nCould you share `a & b`? 👋';
  const saved=store.replies.save({draftId:reply.id,expectedRevision:reply.revision,text});
  assert.throws(()=>store.replies.save({draftId:reply.id,expectedRevision:reply.revision,text:'A stale edit'}));
  const args={draftId:reply.id,expectedRevision:saved.revision,text,operationId:randomUUID()};
  assert.equal(store.replies.beginSend(args).started,true);assert.equal(store.replies.beginSend(args).started,false);
  assert.throws(()=>store.replies.beginSend({...args,text:'Changed'}));
  assert.throws(()=>store.replies.beginSend({...args,operationId:randomUUID()}));
  store.replies.finishSend(reply.id,{status:'sent',channelId:output.channelId,threadTs:output.threadTs,text,messageUrl:'https://example.slack.com/archives/C123/p1792313088000000',detail:'Verified',verified:true});
  assert.equal(store.replies.byId(reply.id)?.status,'sent');assert.equal(store.replies.byId(reply.id)?.text,text);
  assert.equal(store.replies.beginSend(args).started,false);assert.equal(store.view().items[0].userDecision,null);
  assert.equal(store.view().items[0].id,task.id);
});
test('stale, failed and unverified sends remain uncertain and cannot be blindly resent',t=>{
  const {store,ready,advance}=setup(t);const reply=ready();
  const args={draftId:reply.id,expectedRevision:reply.revision,text:reply.text,operationId:randomUUID()};
  store.replies.beginSend(args);advance();assert.equal(store.replies.byId(reply.id)?.status,'uncertain');
  store.replies.finishSend(reply.id,{status:'sent',channelId:output.channelId,threadTs:output.threadTs,text:output.text,messageUrl:'https://example-workspace.slack.com/archives/C123/p1792313088000000',detail:'Claimed',verified:true});
  assert.equal(store.replies.byId(reply.id)?.status,'uncertain');
  assert.equal(store.replies.beginSend(args).started,false);assert.throws(()=>store.replies.beginSend({...args,operationId:randomUUID()}));
});
test('wrong receipt text or workspace is never reported as delivered',t=>{
  const {store,ready}=setup(t);const reply=ready();store.replies.beginSend({draftId:reply.id,expectedRevision:reply.revision,text:reply.text,operationId:randomUUID()});
  store.replies.finishSend(reply.id,{status:'sent',channelId:output.channelId,threadTs:output.threadTs,text:'Unreviewed change',messageUrl:'https://example.slack.com/archives/C123/p1792313088000000',detail:'Claimed',verified:true});
  assert.equal(store.replies.byId(reply.id)?.status,'uncertain');assert.equal(store.replies.byId(reply.id)?.messageUrl,null);
});
test('worker prepares and sends through fixture runtime without any external message',async t=>{
  const {store,dir,prepare}=setup(t);const runtime=join(dir,'runtime.cjs');
  writeFileSync(runtime,`#!/usr/bin/env node\nconst fs=require('node:fs');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const marker='Approved immutable payload (JSON DATA): ';const sending=input.includes(marker);const payload=sending?JSON.parse(input.split(marker)[1]):null;fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify(sending?{status:'sent',channelId:payload.channel_id,threadTs:payload.thread_ts,text:payload.message,messageUrl:'https://example.slack.com/archives/C123/p1792313088000000',detail:'Fixture readback',verified:true}:${JSON.stringify(output)}));});`,{mode:0o700});
  const previous=process.env.SAURON_CODEX_BIN;process.env.SAURON_CODEX_BIN=runtime;
  t.after(()=>{if(previous)process.env.SAURON_CODEX_BIN=previous;else delete process.env.SAURON_CODEX_BIN;});
  const reply=prepare();assert.match(preparePrompt(store,reply),/READ tools only/);
  await runReply(store,reply.id,'prepare');const draft=store.replies.byId(reply.id)!;assert.equal(draft.status,'ready');
  const text='Exact reviewed text\nSecond line';store.replies.beginSend({draftId:draft.id,expectedRevision:draft.revision,text,operationId:randomUUID()});
  assert.ok(sendPrompt(store.replies.byId(draft.id)!).includes(JSON.stringify({channel_id:'C123',thread_ts:output.threadTs,message:text,reply_broadcast:false,unfurl_app_links:false})));
  await runReply(store,draft.id,'send');assert.equal(store.replies.byId(draft.id)?.status,'sent');assert.equal(store.replies.byId(draft.id)?.text,text);
});
test('worker failure preserves the draft and does not allow a second send',async t=>{
  const {store,dir,ready}=setup(t);const runtime=join(dir,'runtime.cjs');writeFileSync(runtime,'#!/usr/bin/env node\nprocess.exit(1)',{mode:0o700});
  const previous=process.env.SAURON_CODEX_BIN;process.env.SAURON_CODEX_BIN=runtime;
  t.after(()=>{if(previous)process.env.SAURON_CODEX_BIN=previous;else delete process.env.SAURON_CODEX_BIN;});
  const reply=ready();store.replies.beginSend({draftId:reply.id,expectedRevision:reply.revision,text:reply.text,operationId:randomUUID()});
  await runReply(store,reply.id,'send');assert.equal(store.replies.byId(reply.id)?.status,'uncertain');assert.equal(store.replies.byId(reply.id)?.text,reply.text);
});
