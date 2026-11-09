import {mkdirSync,writeFileSync,readFileSync,unlinkSync,rmdirSync,lstatSync,existsSync,realpathSync,readdirSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';

export function devPaths(projectRoot){
  const root=resolve(projectRoot,'.data/sauron-dev');
  return {root,database:join(root,'attention.sqlite'),current:join(root,'current.json'),lock:join(root,'runtime.lock'),runtimeLocks:join(root,'runtimes'),marketplace:resolve(projectRoot,'.data/sauron-dev-marketplace')};
}

export function assertLocalPath(projectRoot,target){
  const base=realpathSync(projectRoot);
  const rel=relative(resolve(projectRoot),resolve(target));
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Dev files must stay inside the Sauron checkout.');
  let cursor=base;
  for(const part of rel.split('/')){
    cursor=join(cursor,part);
    try{if(lstatSync(cursor).isSymbolicLink())throw Error(`Dev path must not use a symbolic link: ${cursor}`);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}

export function lockStatus(lock){
  if(!existsSync(lock))return null;
  let owner;
  try{owner=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'));}catch{throw Error(`Incomplete dev lock: ${lock}. Check for a running dev command before removing this lock.`);}
  if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw Error('Invalid dev lock owner.');
  let alive=true;
  try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
  return {...owner,alive};
}

export function runtimeStatuses(projectRoot){
  const {runtimeLocks}=devPaths(projectRoot);
  assertLocalPath(projectRoot,runtimeLocks);
  if(!existsSync(runtimeLocks))return [];
  return readdirSync(runtimeLocks).filter(name=>/^runtime-[a-f0-9-]+\.lock$/.test(name)).map(name=>{
    const path=join(runtimeLocks,name);
    assertLocalPath(projectRoot,path);
    return {path,...lockStatus(path)};
  });
}

export function acquireDevRuntimeLock(projectRoot){
  const {root,lock,runtimeLocks}=devPaths(projectRoot);
  assertLocalPath(projectRoot,runtimeLocks);
  mkdirSync(root,{recursive:true,mode:0o700});
  mkdirSync(runtimeLocks,{recursive:true,mode:0o700});
  const token=randomUUID(),path=join(runtimeLocks,`runtime-${token}.lock`);
  mkdirSync(path,{mode:0o700});
  writeFileSync(join(path,'owner.json'),JSON.stringify({pid:process.pid,purpose:'native runtime',token}),{mode:0o600});
  const release=()=>{unlinkSync(join(path,'owner.json'));rmdirSync(path);};
  try{
    const owner=lockStatus(lock);
    if(owner?.alive&&owner.purpose!=='native runtime'&&owner.purpose!=='build')throw Error(`Sauron Dev is busy (${owner.purpose}, PID ${owner.pid}). Retry when it finishes.`);
  }catch(error){release();throw error;}
  return release;
}

export function acquireDevLock(projectRoot,purpose){
  const {root,lock}=devPaths(projectRoot);
  assertLocalPath(projectRoot,lock);
  mkdirSync(root,{recursive:true,mode:0o700});
  const token=randomUUID();
  for(let attempt=0;attempt<2;attempt++){
    try{
      mkdirSync(lock,{mode:0o700});
      writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid,purpose,token}),{mode:0o600});
      const release=()=>{
        const owner=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'));
        if(owner.token!==token)throw Error('Dev lock ownership changed.');
        unlinkSync(join(lock,'owner.json'));rmdirSync(lock);
      };
      const runtimes=purpose==='build'?[]:runtimeStatuses(projectRoot).filter(owner=>owner.alive);
      if(runtimes.length){release();throw Error(`Sauron Dev is busy (${runtimes.length} native runtime${runtimes.length===1?'':'s'}). Quit Codex to stop its Sauron Dev runtimes, then retry.`);}
      return release;
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      const owner=lockStatus(lock);
      if(owner.alive)throw Error(`Sauron Dev is busy (${owner.purpose}, PID ${owner.pid}). Retry when that command finishes.`);
      unlinkSync(join(lock,'owner.json'));rmdirSync(lock);
    }
  }
  throw Error('Could not acquire the Sauron Dev lock. Retry once other dev commands have stopped.');
}

export function currentBuild(projectRoot){
  const paths=devPaths(projectRoot);
  assertLocalPath(projectRoot,paths.current);
  const current=JSON.parse(readFileSync(paths.current,'utf8'));
  if(typeof current.buildId!=='string'||!/^[a-zA-Z0-9-]+$/.test(current.buildId))throw Error('Invalid dev build ID. Run sauron:dev:setup.');
  const build=join(paths.root,'builds',current.buildId);
  assertLocalPath(projectRoot,build);
  return {...current,build};
}
