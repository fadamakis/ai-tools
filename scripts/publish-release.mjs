import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {release,files} from './release.mjs';
import {checkPublic} from './check-public.mjs';
import {validate} from './validate.mjs';
import {smokePackages} from './smoke-packages.mjs';
async function publishArchiveRelease(packageRoot,receipt,tag) {
 const {spawnSync}=await import('node:child_process');
 if(spawnSync('gh',['release','view',tag],{stdio:'ignore'}).status===0) {console.log('GitHub Release already exists.');return;}
 const archives=path.resolve('dist/archives');fs.rmSync(archives,{recursive:true,force:true});fs.mkdirSync(archives,{recursive:true});
 for(const [name,product] of Object.entries(receipt.products)) {
  const filename=path.join(archives,`${name}-${product.version}.zip`);
  execFileSync('zip',['-qr',filename,'.'],{cwd:path.resolve(packageRoot,'plugins',name)});
 }
 const checksums=[];
 const {createHash}=await import('node:crypto');
 for(const file of files(archives)) checksums.push(`${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`);
 fs.writeFileSync(path.join(archives,'SHA256SUMS'),checksums.join('\n')+'\n');
 execFileSync('gh',['release','create',tag,...files(archives),'--title',`AI Tools ${source.slice(0,12)}`,'--notes-file',path.resolve(packageRoot,'RELEASE.md'),'--target','releases'],{stdio:'inherit'});
}
const git=(args,options={})=>execFileSync('git',args,{encoding:'utf8',...options}).trim();
const source=git(['rev-parse','HEAD']);
const remoteMain=git(['ls-remote','origin','refs/heads/main']).split(/\s+/)[0];
if(source!==remoteMain) {console.log('A newer main commit exists; this run will not publish.');process.exit(0);}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-publish-'));
try {
 const previous=path.join(temp,'previous');
 const refs=git(['ls-remote','origin','refs/heads/releases']);
 if(refs) {
  git(['clone','--depth','1','--branch','releases',git(['remote','get-url','origin']),previous]);
 }
 if(refs) {
  const prior=JSON.parse(fs.readFileSync(path.join(previous,'release.json'),'utf8'));
  if(prior.sourceCommit===source) {
   validate(previous,true);checkPublic(previous,{packaged:true});
   execFileSync(process.execPath,['scripts/scan-secrets.mjs','--packages',previous],{stdio:'inherit'});
   await smokePackages(previous);
   await publishArchiveRelease(previous,prior,`release-${source}`);
   console.log('This source commit was already published; verified existing packages and completed any missing archive release.');
   process.exit(0);
  }
 }
 const receipt=release({previous:refs?previous:undefined,sourceCommit:source});
 validate(path.resolve('dist/release'),true);
 checkPublic(path.resolve('dist/release'),{packaged:true});
 execFileSync(process.execPath,['scripts/scan-secrets.mjs','--packages','dist/release'],{stdio:'inherit'});
 const smoke=await smokePackages('dist/release');
 fs.writeFileSync('dist/release/smoke.json',JSON.stringify(smoke,null,2)+'\n');
 // Never publish over a newer main commit, even if it arrived during the build.
 if(source!==git(['ls-remote','origin','refs/heads/main']).split(/\s+/)[0]) {console.log('Main advanced during packaging; publication skipped.');process.exit(0);}
 const work=refs?previous:path.join(temp,'new');
 if(!refs) {fs.mkdirSync(work);git(['init','-b','releases'],{cwd:work});git(['remote','add','origin',git(['remote','get-url','origin'])],{cwd:work});}
 for(const item of fs.readdirSync(work)) if(item!=='.git') fs.rmSync(path.join(work,item),{recursive:true,force:true});
 fs.cpSync('dist/release',work,{recursive:true});
 git(['config','user.name','github-actions[bot]'],{cwd:work});git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com'],{cwd:work});
 git(['add','--all'],{cwd:work});git(['commit','-m',`Release ${source.slice(0,12)}`],{cwd:work});
 git(['push','origin','HEAD:refs/heads/releases'],{cwd:work});
 // Immutable tag connects the source snapshot, packages, and release receipt.
 const tag=`release-${source}`;git(['tag',tag],{cwd:work});git(['push','origin',`refs/tags/${tag}`],{cwd:work});
 await publishArchiveRelease(path.resolve('dist/release'),receipt,tag);
 console.log(JSON.stringify({published:true,sourceCommit:source,receipt},null,2));
} finally {fs.rmSync(temp,{recursive:true,force:true});}
