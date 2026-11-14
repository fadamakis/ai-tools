import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {devPaths,assertLocalPath,acquireDevLock,currentBuild,runtimeStatuses} from './dev-state.mjs';
import {inspectDevDatabase} from './dev-archive.mjs';

export async function bootstrapDevelopment({root=fileURLToPath(new URL('..',import.meta.url)),fresh=false,log=console.log}={},dependencies={}){
  const paths=devPaths(root);
  assertLocalPath(root,paths.database);
  if(process.env.ATTENTION_DB&&resolve(process.env.ATTENTION_DB)!==paths.database)throw Error('Sauron Dev bootstrap refuses a different ATTENTION_DB. Unset it and retry.');
  if(process.env.ATTENTION_DB)assertLocalPath(root,process.env.ATTENTION_DB);
  const release=acquireDevLock(root,fresh?'fresh-bootstrap':'bootstrap',{allowRuntimes:!fresh});
  try{
    const {storeId}=inspectDevDatabase(root),current=currentBuild(root);
    if(!fresh&&runtimeStatuses(root).some(owner=>owner.alive&&owner.buildId!==current.buildId))throw Error('An older Dev runtime is connected. Restart Codex and load the selected Dev build before bootstrapping.');
    const entry=join(current.build,'server/dev-bootstrap.js');assertLocalPath(root,entry);
    if(!existsSync(entry))throw Error('Selected Dev build lacks real-chat bootstrap. Run pnpm sauron:dev:build and load that build first.');
    const runtime=await import(pathToFileURL(entry).href);
    if(typeof runtime.bootstrapDev!=='function')throw Error('Selected Dev build lacks real-chat bootstrap. Rebuild Sauron Dev.');
    return await runtime.bootstrapDev({root,buildId:current.buildId,expectedStoreId:storeId,fresh,log},dependencies);
  }finally{release();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length>1||args.some(arg=>arg!=='--fresh')){console.error('Use sauron:dev:bootstrap [--fresh].');process.exitCode=1;}
  else bootstrapDevelopment({fresh:args.includes('--fresh')}).then(result=>{process.exitCode=result.status==='completed'?0:2;}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
