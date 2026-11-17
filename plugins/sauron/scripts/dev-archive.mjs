import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {devPaths,assertLocalPath} from './dev-state.mjs';
import {fingerprint} from './migrate-data.mjs';

export function inspectDevDatabase(root){
  const {database}=devPaths(root);
  for(const suffix of ['','-wal','-shm'])assertLocalPath(root,database+suffix);
  if(!existsSync(database))throw Error('Dev database is missing. Run pnpm sauron:dev:setup.');
  const db=new DatabaseSync(database,{readOnly:true});
  try{
    if(Number(db.prepare('PRAGMA user_version').get().user_version)!==4)throw Error('Open a current Sauron Dev build to verify schema 4 before bootstrapping.');
    const storeId=db.prepare("SELECT value FROM metadata WHERE key='store_id'").get()?.value;
    if(typeof storeId!=='string')throw Error('Dev store identity is missing.');
    const review=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='organisation_review'").get()?.value??'null');
    return {storeId,review};
  }finally{db.close();}
}

export function replaceDevDatabase(root,initialise,{move=renameSync,expectedStoreId}={}){
  const paths=devPaths(root);
  for(const suffix of ['','-wal','-shm'])assertLocalPath(root,paths.database+suffix);
  const source=new DatabaseSync(paths.database,{readOnly:true});
  let before;
  try{
    if(expectedStoreId&&source.prepare("SELECT value FROM metadata WHERE key='store_id'").get()?.value!==expectedStoreId)throw Error('Dev store identity changed. Retry against the current store.');
    before=fingerprint(source);
  }finally{source.close();}
  const staged=join(paths.root,`empty-${randomUUID()}.sqlite`);
  assertLocalPath(root,staged);
  initialise(staged);
  const prepared=new DatabaseSync(staged,{readOnly:true});
  try{if(prepared.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('New Dev database failed verification. Original data is unchanged.');}finally{prepared.close();}
  const archive=join(paths.root,'archives',randomUUID());
  assertLocalPath(root,archive);
  mkdirSync(archive,{recursive:true,mode:0o700});
  const moved=[];
  try{
    for(const suffix of ['','-wal','-shm']){
      const from=paths.database+suffix;
      if(existsSync(from)){const to=join(archive,'attention.sqlite'+suffix);move(from,to);moved.push({from,to});}
    }
    const saved=new DatabaseSync(join(archive,'attention.sqlite'),{readOnly:true});
    try{
      if(saved.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||fingerprint(saved)!==before)throw Error('Dev archive failed verification.');
    }finally{saved.close();}
    move(staged,paths.database);
  }catch(error){
    for(const {from,to} of moved.reverse())renameSync(to,from);
    throw error;
  }
  return archive;
}
