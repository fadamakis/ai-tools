import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeNotices} from '../../scripts/notices.mjs';

function fixture(t,metadata) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-notices-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,'node_modules',metadata.name);fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify(metadata));
  fs.writeFileSync(path.join(directory,'index.js'),'export const example = true;');
  return {root,directory,output:path.join(root,'NOTICES.md'),results:[{metafile:{inputs:{[`node_modules/${metadata.name}/index.js`]:{}}}}]};
}

test('bundled legacy format receives its declared MIT grant and original attribution',t=>{
  const f=fixture(t,{name:'format',version:'0.2.2',licenses:[{type:'MIT'}]});
  writeNotices(f.results,f.output,{baseDirectory:f.root});
  const text=fs.readFileSync(f.output,'utf8');
  assert.match(text,/License: MIT/);assert.match(text,/Copyright 2010 - 2014 Sami Samhuri/);assert.match(text,/Permission is hereby granted/);
});

test('a newly bundled dependency without its license text blocks packaging',t=>{
  const f=fixture(t,{name:'unlicensed-fixture',version:'1.0.0',license:'MIT'});
  assert.throws(()=>writeNotices(f.results,f.output,{baseDirectory:f.root}),/Missing license declaration or text/);
  fs.writeFileSync(path.join(f.directory,'MIT-LICENSE'),'Fixture license grant');
  assert.equal(writeNotices(f.results,f.output,{baseDirectory:f.root}),1);
  assert.match(fs.readFileSync(f.output,'utf8'),/Fixture license grant/);
});

test('nested distribution metadata uses the package root license and retains upstream notices',t=>{
  const f=fixture(t,{name:'@example/nested',version:'1.0.0',license:'Apache-2.0'});
  fs.mkdirSync(path.join(f.directory,'dist'));
  fs.writeFileSync(path.join(f.directory,'dist/package.json'),JSON.stringify({name:'@example/nested',version:'1.0.0',license:'Apache-2.0'}));
  fs.writeFileSync(path.join(f.directory,'dist/index.js'),'export const example = true;');
  fs.writeFileSync(path.join(f.directory,'LICENSE'),'Package root grant');
  fs.writeFileSync(path.join(f.directory,'NOTICE'),'Original attribution');
  f.results[0].metafile.inputs={'node_modules/@example/nested/dist/index.js':{}};
  assert.equal(writeNotices(f.results,f.output,{baseDirectory:f.root}),1);
  const text=fs.readFileSync(f.output,'utf8');
  assert.match(text,/Package root grant/);assert.match(text,/Original attribution/);
});
