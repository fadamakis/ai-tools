import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setOrganisationSchedule} from '../src/server/organisation-scheduler.js';
import {runReadOnlyAgent} from '../src/server/agent-runner.js';

test('I-02: the proposal worker disables newly discovered servers without relaxing the source scanner policy',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-no-tools-')),cli=join(dir,'runtime.cjs');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(cli,`#!/usr/bin/env node\nconst fs=require('node:fs'),args=process.argv.slice(2);if(args[0]==='mcp'){process.stdout.write(JSON.stringify([{name:'future-server',enabled:!args.includes('mcp_servers.future-server.enabled=false'),transport:{type:'stdio'}}]));process.exit(0);}if(!args.includes('mcp_servers.future-server.enabled=false')||!args.includes('mcp_servers.future-server.command="/usr/bin/false"'))process.exit(1);fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({changes:[]}));`,{mode:0o700});
  const schema={type:'object',properties:{changes:{type:'array',items:{type:'string'}}},required:['changes'],additionalProperties:false};
  await assert.rejects(runReadOnlyAgent('Synthetic fixture only.',schema,{cli,providers:[],timeoutMs:3000}),/policy/);
  const result=await runReadOnlyAgent('Synthetic fixture only.',schema,{cli,providers:[],denyAllLocalServers:true,timeoutMs:3000});assert.deepEqual(result.output,{changes:[]});assert.equal(result.observedTools.length,0);
});
test('O-04: schedules are explicit, use stable runtime copies, and can be disabled without deleting task data',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-schedule-')),id=randomUUID(),database=join(dir,'attention.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(database,'synthetic database placeholder');
  for(const name of ['check-organisation.js','organisation-worker.js'])writeFileSync(join(dir,name),'synthetic runtime');
  const calls:string[][]=[];const options={platform:'darwin',uid:501,sourceDirectory:dir,run:(args:string[])=>{calls.push(args);return args[0]==='print'?1:0;}};
  assert.equal(existsSync(join(dir,'organisation-runtime')),false);setOrganisationSchedule(database,id,true,options);
  assert.ok(calls.some(args=>args[0]==='bootstrap'));const plist=join(dir,'organisation-runtime/review.plist');const text=readFileSync(plist,'utf8');assert.ok(text.includes('--expected-store-id'));assert.ok(text.includes(id));assert.ok(!text.includes('plugins/cache'));assert.equal(statSync(plist).mode&0o777,0o600);
  setOrganisationSchedule(database,id,false,{...options,run:(args:string[])=>{calls.push(args);return 0;}});assert.ok(calls.some(args=>args[0]==='bootout'));assert.equal(existsSync(plist),false);assert.equal(readFileSync(database,'utf8'),'synthetic database placeholder');
});
