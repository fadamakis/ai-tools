import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync,rmSync,symlinkSync,readdirSync,statSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {build} from 'esbuild';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {buildDevelopment,resetDevelopment,doctor} from '../scripts/dev.mjs';
import {devPaths,currentBuild,acquireDevLock,acquireDevRuntimeLock} from '../scripts/dev-state.mjs';
import {SauronStore} from '../src/server/store.ts';
import {seedDevStore,invokeFixture} from '../src/server/dev-fixtures.ts';

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
function marketplaceSnapshot(root){
  const directory=devPaths(root).marketplace;
  const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>{
    const file=join(path,entry.name);
    return entry.isDirectory()?walk(file):[{file,hash:hash(file),modified:statSync(file).mtimeMs}];
  });
  return walk(directory);
}
async function connectFixture(root){
  const config=JSON.parse(readFileSync(join(devPaths(root).marketplace,'plugins/sauron-dev/.mcp.json'),'utf8')).mcpServers['sauron-dev'];
  const client=new Client({name:'dev-build-test',version:'1.0.0'});
  const transport=new StdioClientTransport({...config,stderr:'pipe'});
  try{await client.connect(transport);}catch(error){await transport.close();throw error;}
  return client;
}
const readFixture=async client=>(await client.callTool({name:'list_attention',arguments:{}})).structuredContent;


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
  assert.ok(doctor(root).filter(check=>check.name!=='Prerequisites').every(check=>check.ok));
});

test('reset archives saved decisions and creates a fresh fixture store',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  await buildDevelopment({root,setup:true,build:fixtureBuild});
  const store=new SauronStore(paths.database),operationId=randomUUID();
  const created=store.createPersonal({operationId,title:'Only in archived fixture data',sourceState:'needs_you'}).items.find(item=>item.id==='personal:'+operationId);
  store.decide({id:created.id,expectedVersion:created.version,action:'complete',operationId:randomUUID()});
  const saved=store.view();store.close();
  const before=hash(paths.database),archive=await resetDevelopment(root);
  assert.equal(hash(join(archive,'attention.sqlite')),before);
  const archived=new SauronStore(join(archive,'attention.sqlite')),fresh=new SauronStore(paths.database);
  try{
    assert.deepEqual(archived.view().items,saved.items);assert.equal(archived.storeId,saved.storeId);
    assert.notEqual(fresh.storeId,saved.storeId);assert.equal(fresh.view().items.some(item=>item.id===created.id),false);
    assert.ok(fresh.view().items.some(item=>item.provider==='manual'));
  }finally{archived.close();fresh.close();}
});

test('seeding never overwrites existing data and dev paths reject external symlinks',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  mkdirSync(paths.root,{recursive:true});seedDevStore(paths.database);const before=hash(paths.database);
  assert.throws(()=>seedDevStore(paths.database),/already exists/);assert.equal(hash(paths.database),before);
  const other=fixtureRoot(t);mkdirSync(join(other,'.data'));symlinkSync(root,join(other,'.data/sauron-dev'));
  await assert.rejects(buildDevelopment({root:other,setup:true,build:fixtureBuild}),/symbolic link/);
});

test('fixture refresh and reply use local store methods and never start a source or reply worker',t=>{
  const spawn=t.mock.method(childProcess,'spawn',()=>{throw Error('Fixture action attempted to start a worker');});
  syncBuiltinESMExports();
  t.after(()=>{spawn.mock.restore();syncBuiltinESMExports();});
  const root=fixtureRoot(t),paths=devPaths(root);mkdirSync(paths.root,{recursive:true});seedDevStore(paths.database);
  const store=new SauronStore(paths.database);t.after(()=>store.close());
  const refreshed=invokeFixture(store,'refresh_attention',{});
  assert.equal(refreshed.scan.status,'completed');assert.equal(refreshed.scan.sources.slack.status,'checked');
  const slack=refreshed.items.find(task=>task.provider==='slack');
  const draft=invokeFixture(store,'prepare_slack_reply',{taskId:slack.id,operationId:randomUUID()}).reply;
  assert.equal(draft.status,'ready');
  const sent=invokeFixture(store,'send_slack_reply',{draftId:draft.id,expectedRevision:draft.revision,text:draft.text,operationId:randomUUID()}).reply;
  assert.equal(sent.status,'sent');
  for(const name of ['check_local_attention','check_scheduled_attention','configure_attention_sync','sync_attention','new_external_action'])assert.throws(()=>invokeFixture(store,name,{}),/disabled|not available/);
  assert.equal(spawn.mock.callCount(),0);
});

test('build publishes a new generation while existing native clients keep their build and saved decisions',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  const initial=await buildDevelopment({root,setup:true,build:fixtureBuild});
  const marketplace=marketplaceSnapshot(root);
  const clients=[];
  try{
    const first=await connectFixture(root),second=await connectFixture(root);clients.push(first,second);
    assert.equal((await first.listTools()).tools.find(tool=>tool.name==='open_attention').title,'Sauron Dev');
    const before=await readFixture(first),task=before.items.find(item=>item.provider==='personal'&&!item.userDecision);
    await first.callTool({name:'decide_attention_item',arguments:{id:task.id,expectedVersion:task.version,action:'complete',operationId:'complete-before-build'}});
    const saved=await readFixture(second);
    const latest=await buildDevelopment({root,build:fixtureBuild});
    assert.notEqual(latest.buildId,initial.buildId);assert.equal(currentBuild(root).buildId,latest.buildId);
    assert.deepEqual(marketplaceSnapshot(root),marketplace);
    for(const client of clients){
      const view=await readFixture(client);
      assert.equal(view.dev.buildId,initial.buildId);assert.equal(view.storeId,saved.storeId);assert.deepEqual(view.items,saved.items);
      assert.match((await client.readResource({uri:'ui://attention/list-v1'})).contents[0].text,new RegExp(initial.buildId));
    }
    const blocked=await first.callTool({name:'check_local_attention',arguments:{expectedStoreId:saved.storeId,reason:'manual'}});
    assert.equal(blocked.isError,true);
    await second.close();clients.pop();
    const reconnected=await connectFixture(root);clients.push(reconnected);
    const updated=await readFixture(reconnected);
    assert.equal(updated.dev.buildId,latest.buildId);assert.equal(updated.storeId,saved.storeId);assert.deepEqual(updated.items,saved.items);
    assert.match((await reconnected.readResource({uri:'ui://attention/list-v1'})).contents[0].text,new RegExp(latest.buildId));
    await assert.rejects(buildDevelopment({root,setup:true,build:fixtureBuild}),/busy/);
    await assert.rejects(resetDevelopment(root),/busy/);
    assert.ok(existsSync(join(paths.root,'builds',initial.buildId,'server/dev-runtime.js')));
  }finally{await Promise.all(clients.map(client=>client.close()));}
  const archive=await resetDevelopment(root);
  assert.ok(existsSync(join(archive,'attention.sqlite')));
});

test('a new native client can connect during an unfinished build and reads the last published generation',async t=>{
  const root=fixtureRoot(t);
  const initial=await buildDevelopment({root,setup:true,build:fixtureBuild});
  let resume,entered;
  const gate=new Promise(resolve=>{resume=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const building=buildDevelopment({root,build:async(...args)=>{await fixtureBuild(...args);entered();await gate;}});
  const clients=[];
  try{
    await Promise.race([started,building]);
    assert.equal(currentBuild(root).buildId,initial.buildId);
    await assert.rejects(buildDevelopment({root,build:fixtureBuild}),/busy/);
    await assert.rejects(buildDevelopment({root,setup:true,build:fixtureBuild}),/busy/);
    await assert.rejects(resetDevelopment(root),/busy/);
    const during=await connectFixture(root);clients.push(during);
    const before=await readFixture(during);assert.equal(before.dev.buildId,initial.buildId);
    resume();const latest=await building;
    assert.equal((await readFixture(during)).dev.buildId,initial.buildId);
    const after=await connectFixture(root);clients.push(after);
    const view=await readFixture(after);assert.equal(view.dev.buildId,latest.buildId);assert.equal(view.storeId,before.storeId);assert.deepEqual(view.items,before.items);
  }finally{resume();await building.catch(()=>{});await Promise.all(clients.map(client=>client.close()));}
});

test('failed and incomplete builds preserve the pointer, data and connected native clients',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  const initial=await buildDevelopment({root,setup:true,build:fixtureBuild});
  const client=await connectFixture(root);
  try{
    const before=await readFixture(client),pointer=readFileSync(paths.current,'utf8'),database=hash(paths.database),marketplace=marketplaceSnapshot(root);
    for(const build of [()=>{throw Error('Controlled connected build failure');},()=>{}]){
      await assert.rejects(buildDevelopment({root,build}),/Controlled connected build failure|incomplete/);
      assert.equal(readFileSync(paths.current,'utf8'),pointer);assert.equal(hash(paths.database),database);assert.deepEqual(marketplaceSnapshot(root),marketplace);
      const saved=await readFixture(client);assert.equal(saved.dev.buildId,initial.buildId);assert.equal(saved.storeId,before.storeId);assert.deepEqual(saved.items,before.items);
      assert.equal(existsSync(paths.lock),false);
    }
  }finally{await client.close();}
});

test('maintenance commands serialize while only build locks allow new native runtimes',t=>{
  const root=fixtureRoot(t);
  for(const purpose of ['build','setup','reset']){
    const release=acquireDevLock(root,purpose);
    try{
      for(const other of ['build','setup','reset'])assert.throws(()=>acquireDevLock(root,other),/busy/);
      if(purpose==='build'){const releaseRuntime=acquireDevRuntimeLock(root);releaseRuntime();}
      else assert.throws(()=>acquireDevRuntimeLock(root),/busy/);
    }finally{release();}
  }
});

test('ordinary builds reject missing adapter metadata or build pointer without changing data',async t=>{
  const root=fixtureRoot(t),paths=devPaths(root);
  await buildDevelopment({root,setup:true,build:fixtureBuild});
  const before=hash(paths.database),pointer=readFileSync(paths.current,'utf8');
  for(const missing of [join(paths.marketplace,'plugins/sauron-dev/.mcp.json'),paths.current]){
    const contents=readFileSync(missing),mode=statSync(missing).mode&0o777;
    unlinkSync(missing);
    try{
      let called=false;
      await assert.rejects(buildDevelopment({root,build:()=>{called=true;}}),/Run pnpm sauron:dev:setup/);
      assert.equal(called,false);assert.equal(existsSync(missing),false);assert.equal(hash(paths.database),before);
      if(missing!==paths.current)assert.equal(readFileSync(paths.current,'utf8'),pointer);
    }finally{writeFileSync(missing,contents,{mode});}
  }
});
