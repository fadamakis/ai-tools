import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const products = ['shelob','sauron','workbench'];
export function files(root) {
 const result=[];
 for(const item of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
  if(item.isSymbolicLink()) throw Error(`Symlink cannot be released: ${item.name}`);
  const full=path.join(root,item.name);
  if(item.isDirectory()) result.push(...files(full)); else result.push(full);
 }
 return result;
}
export function sourceFiles(root) {
 const result=[];
 for(const item of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
  if(['node_modules','dist','tests','test-results','playwright-report','evidence','repair-evidence','local-plugin','.data','docs'].includes(item.name)) continue;
  const full=path.join(root,item.name);
  if(item.isSymbolicLink()) throw Error(`Source symlink not supported: ${full}`);
  if(item.isDirectory()) result.push(...sourceFiles(full)); else result.push(full);
 }
 return result;
}
export function digest(root) {
 const hash=createHash('sha256');
 for(const file of files(root)) hash.update(path.relative(root,file)).update('\0').update(fs.readFileSync(file)).update('\0');
 return hash.digest('hex');
}
const semver = value => {
 if(!/^\d+\.\d+\.\d+$/.test(value)) throw Error(`Invalid version: ${value}`);
 return value.split('.').map(Number);
};
export function nextVersion(baseline, previous) {
 const current=semver(baseline); if(!previous) return baseline;
 const last=semver(previous), higher=current.some((n,i)=>n!==last[i] && current.slice(0,i).every((v,j)=>v===last[j]) && n>last[i]);
 return higher ? baseline : `${last[0]}.${last[1]}.${last[2]+1}`;
}
function copy(source,target,parts) {
 fs.mkdirSync(target,{recursive:true});
 for(const part of parts) if(fs.existsSync(path.join(source,part))) fs.cpSync(path.join(source,part),path.join(target,part),{recursive:true});
}
export function release({source=process.cwd(), output=path.join(source,'dist/release'), previous, sourceCommit='local', workspaceIds={}, buildProduct}={}) {
 const state=previous && fs.existsSync(path.join(previous,'release.json')) ? JSON.parse(fs.readFileSync(path.join(previous,'release.json'),'utf8')) : null;
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-release-'));
 const receipt={sourceCommit,products:{},changed:[]};
 try {
  for(const name of products) {
   const sourceRoot=path.join(source,'plugins',name);
   const parts=name==='sauron'?['plugin.json','.codex-plugin','mcp.json','README.md','THIRD_PARTY_NOTICES.md','assets','skills','dist','scripts/migrate-data.mjs','scripts/probe-local-runtime.mjs','scripts/prepare-local-scheduler.mjs','docs/local-updates.md','src/server/data-path.mjs']:['plugin.json','.codex-plugin','mcp.json','README.md','THIRD_PARTY_NOTICES.md','assets','skills','references','rules','schemas','scripts','server','app','shared'];
   const hash=createHash('sha256');
   const inputs=[...sourceFiles(sourceRoot),...sourceFiles(path.join(source,'packages/ui')),...files(path.join(source,'scripts')),path.join(source,'pnpm-lock.yaml'),path.join(source,'LICENSE')];
   for(const file of inputs.sort()) hash.update(path.relative(source,file)).update('\0').update(fs.readFileSync(file)).update('\0');
   const inputDigest=hash.digest('hex'), last=state?.products[name];
   const manifest=JSON.parse(fs.readFileSync(path.join(sourceRoot,'plugin.json'),'utf8'));
   const unchanged=last?.inputDigest===inputDigest;
   const version=unchanged?last.version:nextVersion(manifest.version,last?.version);
   const target=path.join(stage,'marketplace/plugins',name);
   if(unchanged) copy(path.join(previous,'plugins',name),target,fs.readdirSync(path.join(previous,'plugins',name)));
   else {
    // Rebuild at the final version so resource URIs, badges and manifests agree.
    const manifests=['plugin.json','.codex-plugin/plugin.json'];
    const saved=manifests.map(file=>[file,fs.readFileSync(path.join(sourceRoot,file),'utf8')]);
    try {
     for(const [file,text] of saved) {const value=JSON.parse(text);value.version=version;fs.writeFileSync(path.join(sourceRoot,file),JSON.stringify(value,null,2)+'\n');}
     if(buildProduct) buildProduct(name,sourceRoot);
     else if(name==='sauron') execFileSync(process.execPath,['scripts/build.mjs'],{cwd:sourceRoot,stdio:'inherit'});
     else execFileSync(process.execPath,[name==='shelob'?'scripts/build.mjs':'scripts/workbench-build.mjs'],{cwd:source,stdio:'inherit'});
     copy(sourceRoot,target,parts);
     fs.copyFileSync(path.join(source,'LICENSE'),path.join(target,'LICENSE'));
     if(name==='sauron') fs.writeFileSync(path.join(target,'package.json'),JSON.stringify({name:'sauron-runtime',private:true,type:'module',license:'MIT',engines:{node:'>=22.13'}})+'\n');
    } finally {for(const [file,text] of saved) fs.writeFileSync(path.join(sourceRoot,file),text);}
    receipt.changed.push(name);
   }
   receipt.products[name]={version,inputDigest,packageDigest:digest(target)};
  }
  const root=path.join(stage,'marketplace');
  fs.copyFileSync(path.join(source,'LICENSE'),path.join(root,'LICENSE'));
  fs.mkdirSync(path.join(root,'.agents/plugins'),{recursive:true});
  const marketplace={name:'ai-tools',interface:{displayName:'AI Tools'},plugins:products.map(name=>({name,...(workspaceIds[name]?{pluginId:workspaceIds[name]}:{}),source:{source:'local',path:`./plugins/${name}`}}))};
  fs.writeFileSync(path.join(root,'.agents/plugins/marketplace.json'),JSON.stringify(marketplace,null,2)+'\n');
  fs.writeFileSync(path.join(root,'release.json'),JSON.stringify(receipt,null,2)+'\n');
  fs.writeFileSync(path.join(root,'RELEASE.md'),`# AI Tools release\n\nSource commit: ${sourceCommit}\n\n`+products.map(name=>`- ${name}: ${receipt.products[name].version}`).join('\n')+'\n');
  fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(path.dirname(output),{recursive:true});fs.cpSync(root,output,{recursive:true});
  return receipt;
 } finally {fs.rmSync(stage,{recursive:true,force:true});}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 const args=process.argv.slice(2);const options={};
 for(let i=0;i<args.length;i++) {
  const key={'--previous':'previous','--output':'output','--source-commit':'sourceCommit','--workspace-ids':'idsFile'}[args[i]];
  if(!key||!args[i+1]) throw Error('Use --previous DIR --output DIR --source-commit SHA --workspace-ids FILE');
  options[key]=args[++i];
 }
 if(options.idsFile) options.workspaceIds=JSON.parse(fs.readFileSync(options.idsFile,'utf8'));
 console.log(JSON.stringify(release(options),null,2));
}
