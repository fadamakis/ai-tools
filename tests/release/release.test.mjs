import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {release,products,digest} from '../../scripts/release.mjs';
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-publish-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const directory of ['packages/ui','scripts']) fs.mkdirSync(path.join(root,directory),{recursive:true});
 fs.writeFileSync(path.join(root,'packages/ui/index.jsx'),'shared-ui');fs.writeFileSync(path.join(root,'pnpm-lock.yaml'),'pinned');
 fs.writeFileSync(path.join(root,'LICENSE'),'MIT License\nCopyright (c) 2026 Example Author\n');
 for(const name of products) {
  const plugin=path.join(root,'plugins',name);fs.mkdirSync(path.join(plugin,'.codex-plugin'),{recursive:true});fs.mkdirSync(path.join(plugin,'assets'));
  for(const file of ['plugin.json','.codex-plugin/plugin.json'])fs.writeFileSync(path.join(plugin,file),JSON.stringify({name,version:'0.2.0'}));
  fs.writeFileSync(path.join(plugin,'assets/logic.mjs'),name);
 }
 const builds=[];const buildProduct=(name,plugin)=>{builds.push(name);fs.mkdirSync(path.join(plugin,'dist'),{recursive:true});fs.writeFileSync(path.join(plugin,'dist/bundle.js'),JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json'))).version);};
 return {root,builds,run:(output,previous)=>release({source:root,output:path.join(root,output),previous:previous?path.join(root,previous):undefined,sourceCommit:output,workspaceIds:{workbench:'verified-test-id'},buildProduct})};
}
test('unchanged releases retain versions and byte-identical packages; isolated changes only release their product',t=>{
 const f=fixture(t);const first=f.run('one');assert.equal(first.changed.length,3);
 for(const name of products) assert.equal(fs.readFileSync(path.join(f.root,'one/plugins',name,'LICENSE'),'utf8'),fs.readFileSync(path.join(f.root,'LICENSE'),'utf8'));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'one/plugins/sauron/package.json'))),{name:'sauron-runtime',private:true,type:'module',license:'MIT',engines:{node:'>=22.13'}});
 // Generated UI screenshots are not runtime source and must not trigger updates.
 fs.mkdirSync(path.join(f.root,'plugins/sauron/evidence'),{recursive:true});
 fs.writeFileSync(path.join(f.root,'plugins/sauron/evidence/test.png'),'generated screenshot');
 const second=f.run('two','one');assert.deepEqual(second.changed,[]);
 for(const name of products) {assert.equal(second.products[name].version,first.products[name].version);assert.equal(digest(path.join(f.root,'one/plugins',name)),digest(path.join(f.root,'two/plugins',name)));}
 fs.appendFileSync(path.join(f.root,'plugins/sauron/assets/logic.mjs'),'change');
 const third=f.run('three','two');assert.deepEqual(third.changed,['sauron']);assert.equal(third.products.sauron.version,'0.2.1');assert.equal(third.products.shelob.version,'0.2.0');
 fs.appendFileSync(path.join(f.root,'packages/ui/index.jsx'),'shared change');
 const fourth=f.run('four','three');assert.deepEqual(fourth.changed,products);
 assert.equal(fourth.products.sauron.version,'0.2.2');
 const catalog=JSON.parse(fs.readFileSync(path.join(f.root,'four/.agents/plugins/marketplace.json')));
 assert.equal(catalog.plugins.find(item=>item.name==='workbench').pluginId,'verified-test-id');
});
test('public marketplace has no workspace binding, and a license change republishes every product',t=>{
 const f=fixture(t);
 const first=release({source:f.root,output:path.join(f.root,'public-one'),buildProduct:()=>{}});
 const catalog=JSON.parse(fs.readFileSync(path.join(f.root,'public-one/.agents/plugins/marketplace.json')));
 assert.ok(catalog.plugins.every(entry=>!Object.hasOwn(entry,'pluginId')));
 fs.appendFileSync(path.join(f.root,'LICENSE'),'Additional copyright attribution\n');
 const second=release({source:f.root,output:path.join(f.root,'public-two'),previous:path.join(f.root,'public-one'),buildProduct:()=>{}});
 assert.deepEqual(second.changed,products);
 for(const name of products) {
  assert.notEqual(second.products[name].packageDigest,first.products[name].packageDigest);
  assert.match(fs.readFileSync(path.join(f.root,'public-two/plugins',name,'LICENSE'),'utf8'),/Additional copyright attribution/);
 }
});
test('failed package build leaves the prior marketplace intact and restores source versions',t=>{
 const f=fixture(t);f.run('stable');const before=digest(path.join(f.root,'stable'));
 fs.appendFileSync(path.join(f.root,'plugins/shelob/assets/logic.mjs'),'bad change');
 assert.throws(()=>release({source:f.root,output:path.join(f.root,'stable'),previous:path.join(f.root,'stable'),buildProduct:()=>{throw Error('failed validation');}}),/failed validation/);
 assert.equal(digest(path.join(f.root,'stable')),before);
 for(const name of products) assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'plugins',name,'plugin.json'))).version,'0.2.0');
});
