import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dataPath } from '../src/server/data-path.mjs';

export function fingerprint(db) {
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const contents = tables.map(({name,sql}) => ({name, sql, rows: db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row)).sort()}));
  return createHash('sha256').update(JSON.stringify({version:db.prepare('PRAGMA user_version').get(),contents})).digest('hex');
}
export function migrateData({from, to = dataPath(), writersStopped = false}) {
  if (!writersStopped) throw Error('Stop Sauron and its scheduled writers, then pass --confirm-writers-stopped.');
  if (!from || !fs.statSync(from).isFile()) throw Error('Select an existing source SQLite database with --from.');
  const sourcePath = fs.realpathSync(from), target = path.resolve(to);
  if (fs.existsSync(target)) throw Error('Destination already exists. No databases were merged or replaced.');
  fs.mkdirSync(path.dirname(target), {recursive:true,mode:0o700});
  const temporary = `${target}.${randomUUID()}.tmp`;
  const source = new DatabaseSync(sourcePath, {readOnly:true});
  try {
    if (source.prepare('PRAGMA user_version').get().user_version > 3) throw Error('Unsupported newer database schema; migration stopped.');
    const before = fingerprint(source);
    // SQLite creates a consistent backup including committed WAL contents.
    source.prepare('VACUUM INTO ?').run(temporary);
    fs.chmodSync(temporary, 0o600);
    const copy = new DatabaseSync(temporary, {readOnly:true});
    try {
      if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || fingerprint(copy) !== before || fingerprint(source) !== before) throw Error('Backup verification failed or source changed; destination was not activated.');
    } finally { copy.close(); }
    const descriptor = fs.openSync(temporary,'r'); try {fs.fsyncSync(descriptor);} finally {fs.closeSync(descriptor);}
    // Exclusive hard link prevents a concurrent migration replacing a target.
    fs.linkSync(temporary,target);
    return {status:'verified',sourcePreserved:true,fingerprint:before,destination:target};
  } finally {source.close();fs.rmSync(temporary,{force:true});}
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), allowed = new Set(['--from','--to','--confirm-writers-stopped']);
    const options = {};
    for(let i=0;i<args.length;i++) {
      if (!allowed.has(args[i])) throw Error('Use --from SOURCE [--to DESTINATION] --confirm-writers-stopped');
      if(args[i]==='--confirm-writers-stopped') options.writersStopped=true;
      else {const key=args[i].slice(2); if(!args[i+1] || args[i+1].startsWith('--')) throw Error(`Missing ${key} path`); options[key]=args[++i];}
    }
    console.log(JSON.stringify(migrateData(options),null,2));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
