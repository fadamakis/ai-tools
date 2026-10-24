import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {migrateData,fingerprint} from '../../plugins/sauron/scripts/migrate-data.mjs';
import {dataPath} from '../../plugins/sauron/src/server/data-path.mjs';

test('Sauron database backup preserves WAL records, store identity and reply receipts without replacing targets',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-migration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const from=path.join(dir,'old.sqlite'),to=path.join(dir,'new/attention.sqlite');
 const db=new DatabaseSync(from);db.exec("PRAGMA journal_mode=WAL; PRAGMA user_version=3; CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT); CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE replies (id TEXT, status TEXT); INSERT INTO tasks VALUES ('one','{\"state\":\"done\"}'); INSERT INTO metadata VALUES ('store_id','existing-store'); INSERT INTO replies VALUES ('receipt','unknown');");
 const before=fingerprint(db);
 assert.throws(()=>migrateData({from,to}),/Stop Sauron/);
 const result=migrateData({from,to,writersStopped:true});assert.equal(result.fingerprint,before);
 const copy=new DatabaseSync(to,{readOnly:true});assert.equal(fingerprint(copy),before);copy.close();
 assert.equal(fingerprint(db),before);db.close();
 assert.throws(()=>migrateData({from,to,writersStopped:true}),/already exists/);
 assert.equal(fs.statSync(to).mode&0o777,0o600);
});
test('future Sauron schemas are rejected without activating a destination',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-future-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const from=path.join(dir,'future.sqlite'),to=path.join(dir,'new.sqlite');const db=new DatabaseSync(from);db.exec('PRAGMA user_version=99');db.close();
 assert.throws(()=>migrateData({from,to,writersStopped:true}),/Unsupported newer/);assert.equal(fs.existsSync(to),false);
});
test('Sauron data stays outside the plugin cache and honors an explicit override',()=>{
 assert.equal(dataPath({},'/home/example','darwin'),'/home/example/Library/Application Support/Sauron/attention.sqlite');
 assert.equal(dataPath({ATTENTION_DB:'/tmp/isolated.sqlite'}),'/tmp/isolated.sqlite');
});
