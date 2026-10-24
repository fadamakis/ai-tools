import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { SauronStore } from '../src/server/store.js';
import { DatabaseSync } from 'node:sqlite';
import { syntheticObservation, type Result } from '../src/shared/contracts.js';

test('store ID persists across connections/restart and distinguishes separate databases',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-identity-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const first=new SauronStore(join(dir,'one.sqlite'));
  const id=first.view().storeId;first.close();
  const reopened=new SauronStore(join(dir,'one.sqlite'));
  const second=new SauronStore(join(dir,'two.sqlite'));
  try{assert.equal(reopened.view().storeId,id);assert.notEqual(second.view().storeId,id);}
  finally{reopened.close();second.close();}
});

test('adding the store identity preserves a version-one database and its completed task',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-migration-'));const path=join(dir,'legacy.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const original=new SauronStore(path);
  original.upsert({batchId:'legacy',items:[syntheticObservation()]});
  original.decide({id:'synthetic:review-proof',operationId:'legacy-complete',expectedVersion:1,action:'complete'});
  original.close();
  const legacy=new DatabaseSync(path);legacy.exec('DROP TABLE metadata; PRAGMA user_version=1;');legacy.close();
  const migrated=new SauronStore(path);
  try{assert.equal(migrated.view().items[0].state,'done');assert.equal(migrated.view().items[0].version,2);assert.ok(migrated.view().storeId);}
  finally{migrated.close();}
});

test('generated local plugin launches tested workspace runtime and preserves its store outside the cache',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sauron-local-plugin-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  // Import the build helper without executing its CLI entrypoint.
  const helper=await import('../scripts/prepare-local-plugin.mjs');
  const adapter=await helper.prepareLocalPlugin({projectRoot:resolve('.'),outputDir:join(dir,'cache-copy'),databasePath:join(dir,'durable','tasks.sqlite')});
  const manifest=JSON.parse(readFileSync(join(adapter,'.codex-plugin/plugin.json'),'utf8'));
  assert.equal(manifest.name,'sauron');
  assert.equal(manifest.interface.logo,'./assets/sauron.png');
  assert.deepEqual(readFileSync(join(adapter,'assets/sauron.png')),readFileSync('assets/sauron.png'));
  assert.deepEqual(readFileSync(join(adapter,'assets/sidebar-icon.svg')),readFileSync('assets/sidebar-icon.svg'));
  const config=JSON.parse(readFileSync(resolve(adapter,manifest.mcpServers),'utf8')).mcpServers.sauron;
  assert.equal(config.cwd,resolve('.'));assert.equal(config.args[0],resolve('dist/server/index.js'));
  assert.equal(config.env.ATTENTION_DB,join(dir,'durable','tasks.sqlite'));
  assert.equal(readFileSync(join(adapter,'skills/update-sauron/SKILL.md'),'utf8'),readFileSync('skills/update-sauron/SKILL.md','utf8'));
  assert.ok(readFileSync(join(adapter,'skills/update-sauron/SKILL.md'),'utf8').includes('refresh_attention'));
  async function connect(){
    const client=new Client({name:'local-plugin-test',version:'1.0.0'});
    await client.connect(new StdioClientTransport({...config,stderr:'pipe'}));return client;
  }
  let client=await connect();
  try{
    const batch={batchId:'dot-bridge-proof-test',items:[syntheticObservation()]};
    const created=(await client.callTool({name:'upsert_attention_items',arguments:batch})).structuredContent as Result;
    const task=created.items[0];
    await client.callTool({name:'decide_attention_item',arguments:{id:task.id,expectedVersion:task.version,operationId:'complete-proof',action:'complete'}});
    const storeId=created.storeId;await client.close();client=await connect();
    const replay=(await client.callTool({name:'upsert_attention_items',arguments:batch})).structuredContent as Result;
    assert.equal(replay.storeId,storeId);assert.equal(replay.items[0].state,'done');assert.equal(replay.receipt?.duplicate,true);
  }finally{await client.close();}
});
