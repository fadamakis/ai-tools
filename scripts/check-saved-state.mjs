import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ReviewStore} from '../plugins/shelob/server/store.mjs';
import {BoardStore} from '../plugins/workbench/server/store.mjs';
import {SauronStore} from '../plugins/sauron/src/server/store.ts';
import {fingerprint} from '../plugins/sauron/scripts/migrate-data.mjs';
const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i+=2) {if(!['--shelob','--board','--sauron'].includes(args[i])||!args[i+1]) throw Error('Provide --shelob DIR --board DIR --sauron FILE');options[args[i].slice(2)]=path.resolve(args[i+1]);}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-saved-state-')),receipt={};
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
try {
 if(options.shelob) {
  const root=options.shelob, copy=path.join(temporary,'shelob');fs.mkdirSync(path.join(copy,'runs'),{recursive:true});let checked=0;
  for(const id of fs.readdirSync(path.join(root,'runs'))) {
   if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) continue;
   const manifest=path.join(root,'runs',id,'run.json');if(!fs.existsSync(manifest))continue;
   const before=hash(manifest),run=JSON.parse(fs.readFileSync(manifest,'utf8'));
   for(const file of [run.initial?.json,run.final?.json,run.nativeReview?.outputFile]) {
    if(!file||!fs.existsSync(file)) continue;
    if(!file.startsWith(root+path.sep)) throw Error('A saved report is outside its store; verify separately.');
    const target=path.join(copy,path.relative(root,file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);
    const assessments=path.join(path.dirname(file),'assessments.json');if(fs.existsSync(assessments))fs.copyFileSync(assessments,path.join(path.dirname(target),'assessments.json'));
   }
   const target=path.join(copy,'runs',id,'run.json');fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.writeFileSync(target,JSON.stringify(run).replaceAll(root,copy));
   new ReviewStore({root:copy}).get(id);assert.equal(hash(manifest),before);checked++;
  }
  receipt.shelob={reportsRead:checked,originalManifestsUnchanged:true};
 }
 if(options.board) {
  const source=path.join(options.board,'board.json'),before=hash(source),copy=path.join(temporary,'board');fs.mkdirSync(copy);fs.copyFileSync(source,path.join(copy,'board.json'));
  const original=JSON.parse(fs.readFileSync(source,'utf8')),loaded=new BoardStore({root:copy}).read();
  for(let i=0;i<loaded.tasks.length;i++)if(!Object.hasOwn(original.tasks[i],'evidenceChecks'))delete loaded.tasks[i].evidenceChecks;
  assert.deepEqual(loaded,original);assert.equal(hash(source),before);
  receipt.workbench={tasksRead:loaded.tasks.length,launchesRead:loaded.launches.length,allRecordsPreserved:true};
 }
 if(options.sauron) {
  const db=new DatabaseSync(options.sauron,{readOnly:true});
  try {
   const copy=path.join(temporary,'attention.sqlite');db.prepare('VACUUM INTO ?').run(copy);
   const before=new DatabaseSync(copy,{readOnly:true});const expected=fingerprint(before);before.close();
   const store=new SauronStore(copy);try {const view=store.view();assert.ok(view.storeId);receipt.sauron={tasksRead:view.items.length,storeIdentityRetained:true};} finally {store.close();}
   const after=new DatabaseSync(copy,{readOnly:true});try {assert.equal(fingerprint(after),expected);} finally {after.close();}
   receipt.sauron.allTablesPreserved=true;
  } finally {db.close();}
 }
 console.log(JSON.stringify(receipt,null,2));
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
