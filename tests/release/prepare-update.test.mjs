import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {comparePlugin,verifyChecksum,prepareUpdate} from '../../scripts/prepare-update.mjs';

function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-update-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const plugin=(name,version)=>{const folder=path.join(root,name);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'plugin.json'),JSON.stringify({name:'workbench',version}));return folder;};
 return {root,plugin};
}
test('compares actual published files, preserves no-op and rejects same-version changes or downgrade',t=>{
 const f=fixture(t),current=f.plugin('current','0.2.0'),candidate=f.plugin('candidate','0.2.0');
 assert.equal(comparePlugin(candidate).status,'needs-current-source');
 assert.equal(comparePlugin(candidate,current).status,'unchanged');
 fs.writeFileSync(path.join(candidate,'new.txt'),'new');
 assert.throws(()=>comparePlugin(candidate,current),/increase version/);
 fs.writeFileSync(path.join(candidate,'plugin.json'),JSON.stringify({name:'workbench',version:'0.3.0'}));
 fs.writeFileSync(path.join(current,'old.txt'),'old');
 const comparison=comparePlugin(candidate,current);
 assert.deepEqual(comparison.added,['new.txt']);assert.deepEqual(comparison.removed,['old.txt']);
 assert.equal(comparison.status,'needs-compatibility-review');
 fs.writeFileSync(path.join(candidate,'plugin.json'),JSON.stringify({name:'wrong',version:'0.4.0'}));
 assert.throws(()=>comparePlugin(candidate,current),/identity mismatch/);
});
test('supports existing Workbench build metadata while requiring greater SemVer',t=>{
 const f=fixture(t),old=f.plugin('old','0.1.0+codex.20261008160835'),next=f.plugin('next','0.2.0');
 assert.equal(comparePlugin(next,old).previousVersion,'0.1.0+codex.20261008160835');
 assert.throws(()=>comparePlugin(old,next),/increase version/);
});
test('invalid private listing mappings fail before any GitHub download',async t=>{
 const f=fixture(t),workspaceIds=path.join(f.root,'listing-ids.json');
 for(const value of [null,[],{other:'listing'},{workbench:42},{workbench:' '}]) {
  fs.writeFileSync(workspaceIds,JSON.stringify(value));
  await assert.rejects(prepareUpdate({workspaceIds}),/Workspace IDs must map product names/);
 }
});
test('rejects altered ZIPs and ambiguous checksum entries',t=>{
 const f=fixture(t),file=path.join(f.root,'workbench-0.2.0.zip');fs.writeFileSync(file,'zip');
 const sum=`${createHash('sha256').update('zip').digest('hex')}  ${path.basename(file)}\n`;
 verifyChecksum(file,sum);
 assert.throws(()=>verifyChecksum(file,sum+sum),/Checksum mismatch/);
 fs.appendFileSync(file,'changed');assert.throws(()=>verifyChecksum(file,sum),/Checksum mismatch/);
});
test('extractor refuses traversal and symlinks before writing package content',t=>{
 const f=fixture(t),extractor=path.resolve('scripts/extract-release.py');
 for(const kind of ['traversal','symlink','duplicate']) {
  const zip=path.join(f.root,`${kind}.zip`),destination=path.join(f.root,kind);
  execFileSync('python3',['-c',`import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n if sys.argv[2]=='traversal': z.writestr('../escape','bad')\n elif sys.argv[2]=='duplicate':\n  z.writestr('a','one'); z.writestr('A','two')\n else:\n  i=zipfile.ZipInfo('link'); i.external_attr=0o120777<<16; z.writestr(i,'/tmp/target')`,zip,kind]);
  assert.throws(()=>execFileSync('python3',[extractor,zip,destination],{stdio:'pipe'}));
  assert.equal(fs.existsSync(destination),false);
 }
});
