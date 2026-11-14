import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexChatReader} from '../src/server/chat-reader.js';

test('I-01 I-02: the adapter uses only paginated read RPCs and never starts or resumes chats',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-chat-reader-')),cli=join(dir,'runtime.cjs'),log=join(dir,'calls.jsonl'),id=randomUUID();
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(cli,`#!/usr/bin/env node\nif(process.argv[2]==='mcp'){process.stdout.write('[]');process.exit(0);}const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const q=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method:q.method,params:q.params})+'\\n');if(!q.id)return;let result={};const chat={id:${JSON.stringify(id)},name:'Observed title',preview:'',createdAt:1,updatedAt:1794640000};switch(q.method){case 'thread/list':result={data:q.params.archived?[]:[chat],nextCursor:null};break;case 'thread/read':result={thread:chat};break;case 'thread/turns/list':result={data:[{id:'turn',startedAt:1794640000,completedAt:1794640100}],nextCursor:null};break;case 'thread/items/list':result={data:[{turnId:'turn',item:{id:'user',type:'userMessage',content:[{type:'text',text:'Group the work.'}]}},{turnId:'turn',item:{id:'command',type:'commandExecution',aggregatedOutput:'Excluded tool output'}},{turnId:'turn',item:{id:'final',type:'agentMessage',phase:'final',text:'Ready for review.'}}],nextCursor:null};break;}process.stdout.write(JSON.stringify({id:q.id,result})+'\\n');});`,{mode:0o700});
  const reader=new CodexChatReader(cli);try{await reader.probe();const evidence=await reader.read({id,title:'Observed title',createdAt:1,updatedAt:1794640000},'2026-11-01T00:00:00Z','2026-11-15T00:00:00Z');assert.equal(evidence.messages.length,2);assert.equal(evidence.messages[1].text,'Ready for review.');assert.ok(evidence.latestAssistant);assert.ok(!JSON.stringify(evidence).includes('Excluded tool output'));}finally{reader.close();}
  const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.ok(calls.every(call=>['initialize','initialized','thread/list','thread/read','thread/turns/list','thread/items/list'].includes(call.method)));assert.ok(calls.some(call=>call.method==='thread/list'&&call.params.archived===true));assert.ok(calls.some(call=>call.method==='thread/list'&&call.params.sortKey==='updated_at'));
});
test('I-02: unsupported pagination fails capability verification without mutation fallbacks',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-chat-missing-')),cli=join(dir,'runtime.cjs');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(cli,`#!/usr/bin/env node\nif(process.argv[2]==='mcp'){process.stdout.write('[]');process.exit(0);}require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id)process.stdout.write(JSON.stringify(q.method==='initialize'?{id:q.id,result:{}}:{id:q.id,error:{code:-32601,message:'Unavailable'}})+'\\n');});`,{mode:0o700});
  const reader=new CodexChatReader(cli);try{await assert.rejects(reader.probe(),/required read/);}finally{reader.close();}
});
