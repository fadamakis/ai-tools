import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {buildDevelopment,prepareMarketplace,resetDevelopment,doctor} from '../scripts/dev.mjs';
import {devPaths,currentBuild,acquireDevLock} from '../scripts/dev-state.mjs';
import {SauronStore} from '../src/server/store.ts';
import {seedDevStore,invokeFixture} from '../src/server/dev-fixtures.ts';
import {localPolicyArgs} from '../src/server/local-policy.ts';

const sourceRoot=resolve('.');
function fixtureRoot(t){
  const root=mkdtempSync(join(tmpdir(),'sauron-dev-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const directory of ['scripts','assets','skills/update-sauron'])mkdirSync(join(root,directory),{recursive:true});
  for(const file of ['scripts/dev-launch.mjs','scripts/dev-state.mjs','plugin.json','assets/sauron.png','assets/sidebar-icon.svg','skills/update-sauron/SKILL.md'])copyFileSync(join(sourceRoot,file),join(root,file));
  writeFileSync(join(root,'package.json'),' {"type":"module"}\n');
  return root;
}
async function fixtureBuild(root,output,buildId){
  mkdirSync(join(output,'server'),{recursive:true});mkdirSync(join(output,'ui'),{recursive:true});mkdirSync(join(output,'assets'),{recursive:true});
  await build({absWorkingDir:sourceRoot,entryPoints:{'dev-runtime':'src/server/dev-runtime.ts','dev-fixtures':'src/server/dev-fixtures.ts','index-verification':'src/server/index-verification.ts'},bundle:true,outdir:join(output,'server'),platform:'node',format:'esm',target:'node22',define:{__SAURON_DEV_BUILD_ID__:JSON.stringify(buildId)},banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
  copyFileSync(join(root,'plugin.json'),join(output,'plugin.json'));
  copyFileSync(join(root,'assets/sidebar-icon.svg'),join(output,'assets/sidebar-icon.svg'));
  writeFileSync(join(output,'ui/index.html'),`<html><body>Sauron Dev fixtures ${buildId}</body></html>`);
}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

test('setup creates a distinct dev marketplace; repeated setup/build preserve saved state',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  const first=await buildDevelopment({root,setup:true,build:fixtureBuild});
  const store=new SauronStore(paths.database);
  const storeId=store.storeId;
  const task=store.view().items.find(task=>task.provider==='manual');
  store.decide({id:task.id,expectedVersion:task.version,action:'dismiss',operationId:'dev-dismiss'});
  const before=store.view().items;store.close();
  const bytes=hash(paths.database);
  await buildDevelopment({root,setup:true,build:fixtureBuild});
  const last=await buildDevelopment({root,build:fixtureBuild});
  assert.notEqual(first.buildId,last.buildId);assert.equal(hash(paths.database),bytes);
  const reopened=new SauronStore(paths.database);
  assert.equal(reopened.storeId,storeId);assert.deepEqual(reopened.view().items,before);reopened.close();
  const adapter=join(paths.marketplace,'plugins/sauron-dev');
  const manifest=JSON.parse(readFileSync(join(adapter,'.codex-plugin/plugin.json'),'utf8'));
  assert.equal(manifest.name,'sauron-dev');assert.equal(manifest.interface.displayName,'Sauron Dev');assert.equal(manifest.pluginId,undefined);
  const config=JSON.parse(readFileSync(join(adapter,'.mcp.json'),'utf8')).mcpServers['sauron-dev'];
  assert.equal(config.env.ATTENTION_DB,paths.database);assert.deepEqual(config.args,[join(root,'scripts/dev-launch.mjs')]);
  const market=JSON.parse(readFileSync(join(paths.marketplace,'.agents/plugins/marketplace.json'),'utf8'));
  assert.equal(resolve(paths.marketplace,market.plugins[0].source.path),adapter);
  assert.match(readFileSync(join(adapter,'skills/update-sauron/SKILL.md'),'utf8'),/simulated/);
  assert.ok(doctor(root).filter(check=>check.name!=='Prerequisites').every(check=>check.ok));
});

test('failed or incomplete build leaves current build and database bytes unchanged',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  await buildDevelopment({root,setup:true,build:fixtureBuild});
  const pointer=readFileSync(paths.current,'utf8'),before=hash(paths.database);
  await assert.rejects(buildDevelopment({root,build:()=>{throw Error('Controlled build failure');}}),/Controlled build failure/);
  await assert.rejects(buildDevelopment({root,build:()=>{}}),/incomplete/);
  assert.equal(readFileSync(paths.current,'utf8'),pointer);assert.equal(hash(paths.database),before);
  assert.equal(existsSync(paths.lock),false);
});

test('reset archives existing state and refuses a live runtime',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  await buildDevelopment({root,setup:true,build:fixtureBuild});
  const before=hash(paths.database);
  const release=acquireDevLock(root,'test runtime');
  await assert.rejects(resetDevelopment(root),/busy/);
  await assert.rejects(buildDevelopment({root,build:fixtureBuild}),/busy/);
  release();
  const archive=await resetDevelopment(root);
  assert.equal(hash(join(archive,'attention.sqlite')),before);
  const archived=new SauronStore(join(archive,'attention.sqlite')),fresh=new SauronStore(paths.database);
  assert.notEqual(fresh.storeId,archived.storeId);assert.equal(fresh.view().items.length,4);
  archived.close();fresh.close();
});

test('seeding never overwrites existing data, rejects external path symlinks, and policy denies dev MCP',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  mkdirSync(paths.root,{recursive:true});seedDevStore(paths.database);const before=hash(paths.database);
  assert.throws(()=>seedDevStore(paths.database),/already exists/);assert.equal(hash(paths.database),before);
  const other=fixtureRoot(t);mkdirSync(join(other,'.data'));symlinkSync(root,join(other,'.data/sauron-dev'));
  await assert.rejects(buildDevelopment({root:other,setup:true,build:fixtureBuild}),/symbolic link/);
  assert.ok(localPolicyArgs().includes('mcp_servers.sauron-dev.enabled=false'));
});

test('fixture refresh and reply use local store methods and never start a source or reply worker',t=>{
  const root=fixtureRoot(t),paths=devPaths(root);mkdirSync(paths.root,{recursive:true});seedDevStore(paths.database);
  const store=new SauronStore(paths.database);t.after(()=>store.close());
  const refreshed=invokeFixture(store,'refresh_attention',{});
  assert.equal(refreshed.scan.status,'completed');assert.match(refreshed.scan.sources.slack.detail,/Simulated/);
  const slack=refreshed.items.find(task=>task.provider==='slack');
  const draft=invokeFixture(store,'prepare_slack_reply',{taskId:slack.id,operationId:randomUUID()}).reply;
  assert.equal(draft.status,'ready');assert.match(draft.destination,/no Slack connection/);
  const sent=invokeFixture(store,'send_slack_reply',{draftId:draft.id,expectedRevision:draft.revision,text:draft.text,operationId:randomUUID()}).reply;
  assert.equal(sent.status,'sent');
  for(const name of ['check_local_attention','check_scheduled_attention','configure_attention_sync','sync_attention','new_external_action'])assert.throws(()=>invokeFixture(store,name,{}),/disabled|not available/);
});

test('generated adapter serves matching build identity and preserves decisions after client restart',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  const result=await buildDevelopment({root,setup:true,build:fixtureBuild});
  const config=JSON.parse(readFileSync(join(paths.marketplace,'plugins/sauron-dev/.mcp.json'),'utf8')).mcpServers['sauron-dev'];
  const connect=async()=>{
    const client=new Client({name:'dev-test',version:'1.0.0'});
    const transport=new StdioClientTransport({...config,stderr:'pipe'});
    let stderr='';transport.stderr?.on('data',data=>{stderr+=data;});
    try{await client.connect(transport);}catch(error){await transport.close();throw Error(`${error.message}\n${stderr}`);}
    return client;
  };
  let client=await connect();
  try{
    assert.equal((await client.listTools()).tools.find(tool=>tool.name==='open_attention').title,'Sauron Dev');
    const first=await client.callTool({name:'list_attention',arguments:{}});
    assert.equal(first.structuredContent.dev.buildId,result.buildId);
    assert.match((await client.readResource({uri:'ui://attention/list-v1'})).contents[0].text,new RegExp(result.buildId));
    const task=first.structuredContent.items.find(task=>task.provider==='personal'&&task.state==='needs_you');
    await client.callTool({name:'decide_attention_item',arguments:{id:task.id,expectedVersion:task.version,action:'complete',operationId:'native-complete'}});
    await assert.rejects(resetDevelopment(root),/busy/);
    const blocked=await client.callTool({name:'check_local_attention',arguments:{expectedStoreId:first.structuredContent.storeId,reason:'manual'}});
    assert.equal(blocked.isError,true);
    await client.close();client=await connect();
    const restored=(await client.callTool({name:'list_attention',arguments:{}})).structuredContent;
    assert.equal(restored.storeId,first.structuredContent.storeId);
    assert.equal(restored.items.find(item=>item.id===task.id).state,'done');
  }finally{await client.close();}
});

test('multiple native clients can connect while build and reset remain blocked',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  await buildDevelopment({root,setup:true,build:fixtureBuild});
  const config=JSON.parse(readFileSync(join(paths.marketplace,'plugins/sauron-dev/.mcp.json'),'utf8')).mcpServers['sauron-dev'];
  const connect=async()=>{
    const client=new Client({name:'dev-concurrent-test',version:'1.0.0'});
    await client.connect(new StdioClientTransport({...config,stderr:'pipe'}));
    return client;
  };
  let first,second;
  try{
    first=await connect();second=await connect();
    const left=await first.callTool({name:'list_attention',arguments:{}});
    const right=await second.callTool({name:'list_attention',arguments:{}});
    assert.equal(left.structuredContent.storeId,right.structuredContent.storeId);
    await assert.rejects(buildDevelopment({root,build:fixtureBuild}),/busy/);
    await assert.rejects(resetDevelopment(root),/busy/);
    await first.close();first=null;
    await assert.rejects(buildDevelopment({root,build:fixtureBuild}),/busy/);
  }finally{if(first)await first.close();if(second)await second.close();}
  await buildDevelopment({root,build:fixtureBuild});
});

test('candidate reader preserves every saved task and legacy reader can reopen the disposable copy',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  const result=await buildDevelopment({root,setup:true,build:fixtureBuild});
  const baseline=new SauronStore(paths.database),saved=baseline.view();baseline.close();
  const original=hash(paths.database),copy=join(paths.root,'compatibility-copy.sqlite');copyFileSync(paths.database,copy);
  const {SauronStore:CandidateStore}=await import(pathToFileURL(join(currentBuild(root).build,'server/index-verification.js')).href);
  const candidate=new CandidateStore(copy);
  assert.deepEqual(candidate.view().items,saved.items);assert.equal(candidate.storeId,saved.storeId);candidate.close();
  const old=new SauronStore(copy);assert.deepEqual(old.view().items,saved.items);old.close();
  assert.equal(hash(paths.database),original);assert.ok(result.buildId);
});
