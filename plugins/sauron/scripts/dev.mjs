import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import {resolve,join,basename,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {prepareLocalPlugin} from './prepare-local-plugin.mjs';
import {devPaths,assertLocalPath,acquireDevLock,currentBuild,lockStatus,runtimeStatuses} from './dev-state.mjs';

export const projectRoot=fileURLToPath(new URL('..',import.meta.url));
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const marketplaceFiles=['.agents/plugins/marketplace.json','plugins/sauron-dev/.codex-plugin/plugin.json','plugins/sauron-dev/.mcp.json','plugins/sauron-dev/assets/sauron.png','plugins/sauron-dev/assets/sidebar-icon.svg','plugins/sauron-dev/skills/update-sauron/SKILL.md'];

export function preflight(root=projectRoot){
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<13))throw Error('Sauron Dev requires Node 22.13 or newer.');
  const repo=resolve(root,'../..');
  const expected=readJson(join(repo,'package.json')).packageManager.replace('pnpm@','');
  const pnpm=spawnSync('pnpm',['--version'],{encoding:'utf8',cwd:repo});
  if(pnpm.status!==0||pnpm.stdout.trim()!==expected)throw Error(`Use pnpm ${expected}, then run pnpm install --frozen-lockfile from the repository root.`);
  for(const dependency of ['esbuild','typescript','tsx']){
    try{import.meta.resolve(dependency);}catch{throw Error('Dependencies are missing. Run pnpm install --frozen-lockfile from the repository root.');}
  }
  const paths=devPaths(root);
  for(const path of [paths.root,paths.database,paths.marketplace])assertLocalPath(root,path);
  if(existsSync(paths.database)&&!lstatSync(paths.database).isFile())throw Error('The dev database path must be a regular file.');
  return {node:process.versions.node,pnpm:expected};
}

export async function prepareMarketplace(root=projectRoot){
  const paths=devPaths(root);
  assertLocalPath(root,paths.marketplace);
  for(const file of marketplaceFiles)assertLocalPath(root,join(paths.marketplace,file));
  const adapter=await prepareLocalPlugin({projectRoot:root,outputDir:join(paths.marketplace,'plugins/sauron-dev'),
    databasePath:paths.database,pluginName:'sauron-dev',displayName:'Sauron Dev',serverName:'sauron-dev',
    runtimePath:join(root,'scripts/dev-launch.mjs')});
  writeFileSync(join(adapter,'skills/update-sauron/SKILL.md'),`---\nname: update-sauron\ndescription: Inspect the isolated Sauron Dev fixture list.\n---\n\nUse only the sauron-dev MCP server. Read list_attention for fixture tasks. Refresh and reply actions are simulated. Do not read connected services, send messages, start schedules, or call production Sauron for this dev workflow.\n`);
  mkdirSync(join(paths.marketplace,'.agents/plugins'),{recursive:true});
  writeFileSync(join(paths.marketplace,'.agents/plugins/marketplace.json'),JSON.stringify({name:'sauron-dev',interface:{displayName:'Sauron Dev'},plugins:[{name:'sauron-dev',source:{source:'local',path:'./plugins/sauron-dev'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]},null,2)+'\n');
  return paths.marketplace;
}

export async function buildDevelopment({root=projectRoot,setup=false,build=runBuild}={}){
  const paths=devPaths(root);
  for(const target of [paths.root,paths.database,paths.marketplace])assertLocalPath(root,target);
  const release=acquireDevLock(root,setup?'setup':'build');
  try{
    if(!setup&&!existsSync(paths.database))throw Error('Dev database is missing. Run pnpm sauron:dev:setup first.');
    if(!setup){
      for(const path of [paths.current,...marketplaceFiles.map(file=>join(paths.marketplace,file))]){
        assertLocalPath(root,path);
        if(!existsSync(path)||!lstatSync(path).isFile())throw Error('Dev setup files are missing. Run pnpm sauron:dev:setup first.');
      }
    }
    const buildId=new Date().toISOString().replace(/[-:.TZ]/g,'')+'-'+randomUUID().slice(0,8);
    const output=join(paths.root,'builds',buildId);
    assertLocalPath(root,output);
    await build(root,output,buildId);
    for(const file of ['server/dev-runtime.js','server/dev-fixtures.js','ui/index.html','plugin.json','assets/sidebar-icon.svg']){
      if(!existsSync(join(output,file)))throw Error(`Dev build is incomplete: ${file}. Previous build remains selected.`);
    }
    if(setup&&!existsSync(paths.database)){
      const {seedDevStore}=await import(pathToFileURL(join(output,'server/dev-fixtures.js')).href);
      const staging=join(paths.root,`seed-${randomUUID()}.sqlite`);
      seedDevStore(staging);
      renameSync(staging,paths.database);
    }
    if(setup)await prepareMarketplace(root);
    const current={buildId};
    const temporary=join(paths.root,`current-${randomUUID()}.tmp`);
    writeFileSync(temporary,JSON.stringify(current,null,2)+'\n',{mode:0o600});
    renameSync(temporary,paths.current);
    return {...current,marketplace:paths.marketplace,database:paths.database};
  }finally{release();}
}

function runBuild(root,output,buildId){
  for(const args of [['exec','tsc','--noEmit'],['exec','node','scripts/build.mjs']]){
    const result=spawnSync('pnpm',args,{cwd:root,stdio:'inherit',env:{...process.env,SAURON_BUILD_DIR:output,SAURON_DEV_BUILD_ID:buildId}});
    if(result.status!==0)throw Error('Dev build failed. The previous successful build and fixture data are unchanged.');
  }
}

export function doctor(root=projectRoot){
  const checks=[];
  const check=(name,fn)=>{try{checks.push({name,ok:true,detail:fn()});}catch(error){checks.push({name,ok:false,detail:error.message});}};
  check('Prerequisites',()=>preflight(root));
  const paths=devPaths(root);
  check('Fixture database',()=>{
    assertLocalPath(root,paths.database);
    if(!existsSync(paths.database)||!lstatSync(paths.database).isFile())throw Error('Missing fixture database. Run pnpm sauron:dev:setup.');
    return paths.database;
  });
  check('Workspace build',()=>{
    const current=currentBuild(root);
    for(const file of ['server/dev-runtime.js','server/dev-fixtures.js','ui/index.html','plugin.json','assets/sidebar-icon.svg'])if(!existsSync(join(current.build,file)))throw Error(`Missing ${file}. Run pnpm sauron:dev:build.`);
    if(!readFileSync(join(current.build,'ui/index.html'),'utf8').includes(current.buildId))throw Error('UI build ID differs from selected build. Rebuild.');
    return current;
  });
  check('Adapter and marketplace',()=>{
    assertLocalPath(root,paths.marketplace);
    const adapter=join(paths.marketplace,'plugins/sauron-dev');
    const manifest=readJson(join(adapter,'.codex-plugin/plugin.json'));
    const servers=readJson(join(adapter,'.mcp.json')).mcpServers;
    const config=servers['sauron-dev'];
    const marketplace=readJson(join(paths.marketplace,'.agents/plugins/marketplace.json'));
    if(manifest.name!=='sauron-dev'||manifest.interface.displayName!=='Sauron Dev'||manifest.pluginId||Object.keys(servers).length!==1||!isAbsolute(config?.command||'')||basename(config.command)!=='node'||!existsSync(config.command)||config?.args?.length!==1||config.args[0]!==join(root,'scripts/dev-launch.mjs')||config?.cwd!==root||config?.env?.ATTENTION_DB!==paths.database||marketplace.name!=='sauron-dev'||marketplace.plugins?.length!==1||marketplace.plugins[0].name!=='sauron-dev'||marketplace.plugins[0].source?.path!=='./plugins/sauron-dev')throw Error('Adapter differs from this checkout or fixture database. Run pnpm sauron:dev:setup.');
    return {plugin:'sauron-dev@sauron-dev',marketplace:paths.marketplace};
  });
  check('Runtime lock',()=>{const owner=lockStatus(paths.lock),runtimes=runtimeStatuses(root).filter(item=>item.alive);return owner||runtimes.length?{exclusive:owner,runtimes}: 'Not connected';});
  return checks;
}

export async function resetDevelopment(root=projectRoot){
  const paths=devPaths(root);
  assertLocalPath(root,paths.database);
  const release=acquireDevLock(root,'reset');
  try{
    if(!existsSync(paths.database))throw Error('Dev database is missing. Run pnpm sauron:dev:setup.');
    const current=currentBuild(root);
    const {seedDevStore}=await import(pathToFileURL(join(current.build,'server/dev-fixtures.js')).href);
    const staged=join(paths.root,`seed-${randomUUID()}.sqlite`);
    seedDevStore(staged);
    const archive=join(paths.root,'archives',randomUUID());
    mkdirSync(archive,{recursive:true,mode:0o700});
    const moved=[];
    try{
      for(const suffix of ['','-wal','-shm']){
        const from=paths.database+suffix;
        if(existsSync(from)){
          assertLocalPath(root,from);
          const to=join(archive,'attention.sqlite'+suffix);
          renameSync(from,to);moved.push({from,to});
        }
      }
      renameSync(staged,paths.database);
    }catch(error){for(const {from,to} of moved.reverse())renameSync(to,from);throw error;}
    return archive;
  }finally{release();}
}

async function main(){
  const [command,...extra]=process.argv.slice(2);
  if(extra.length||!['setup','build','doctor','reset'].includes(command))throw Error('Use setup, build, doctor, or reset without additional arguments.');
  if(command==='doctor'){
    const checks=doctor();
    for(const check of checks)console.log(`${check.ok?'OK':'FAIL'} ${check.name}: ${typeof check.detail==='string'?check.detail:JSON.stringify(check.detail)}`);
    console.log('Desktop activation is not checked here. Compare the build ID shown in the Sauron Dev panel.');
    if(checks.some(check=>!check.ok))process.exitCode=1;
    return;
  }
  preflight();
  if(command==='reset'){
    if(!process.stdin.isTTY)throw Error('Run sauron:dev:reset in an interactive terminal and confirm the fixture reset.');
    const prompt=createInterface({input:process.stdin,output:process.stdout});
    let answer;
    try{answer=await prompt.question('Archive Sauron Dev fixture data and start fresh? Type reset: ');}finally{prompt.close();}
    if(answer!=='reset'){console.log('Fixture reset cancelled.');return;}
    console.log(`Previous fixture data archived at ${await resetDevelopment()}`);
    return;
  }
  const result=await buildDevelopment({setup:command==='setup'});
  console.log(`Sauron Dev fixtures · build ${result.buildId}\nDatabase: ${result.database}\nMarketplace: ${result.marketplace}`);
  if(command==='setup')console.log(`Register once:\ncodex plugin marketplace add '${result.marketplace.replaceAll("'","'\\''")}'\nThen restart the desktop app and install Sauron Dev from the Sauron Dev marketplace in Plugins.`);
  console.log('Running Sauron Dev processes keep their current build. Restart Codex and reopen Sauron Dev to load the selected build. No uninstall is needed.');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
