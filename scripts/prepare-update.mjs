import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {products, files, digest} from './release.mjs';
import {validate} from './validate.mjs';
import {checkPublic} from './check-public.mjs';
import {smokePackages} from './smoke-packages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'fadamakis/ai-tools';
const gh = args => execFileSync('gh', args, {encoding:'utf8', maxBuffer:32*1024*1024});
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function verifyChecksum(archive, checksumText) {
 const name = path.basename(archive);
 const entries = checksumText.trim().split('\n').map(line => line.match(/^([a-f0-9]{64})  ([^/\\]+)$/));
 if(entries.some(entry => !entry)) throw Error('Invalid SHA256SUMS');
 const matches = entries.filter(entry => entry[2] === name);
 if(matches.length !== 1 || matches[0][1] !== sha256(archive)) throw Error(`Checksum mismatch: ${name}`);
}

export function comparePlugin(candidate, current) {
 const manifest = json(path.join(candidate, 'plugin.json'));
 if(!current) return {status:'needs-current-source', version:manifest.version};
 const previous = json(path.join(current, fs.existsSync(path.join(current,'plugin.json')) ? 'plugin.json' : '.codex-plugin/plugin.json'));
 if(previous.name !== manifest.name) throw Error(`Plugin identity mismatch: ${previous.name} / ${manifest.name}`);
 const inventory = directory => new Map(files(directory).map(file => [path.relative(directory,file), sha256(file)]));
 const before=inventory(current), after=inventory(candidate);
 const added=[...after.keys()].filter(file=>!before.has(file));
 const removed=[...before.keys()].filter(file=>!after.has(file));
 const changed=[...after.keys()].filter(file=>before.has(file)&&before.get(file)!==after.get(file));
 if(!added.length&&!removed.length&&!changed.length) return {status:'unchanged',version:manifest.version,previousVersion:previous.version,added,removed,changed};
 // Ignore SemVer build metadata for precedence; older Workbench releases use +codex timestamps.
 const parse=value=>{const match=value.match(/^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/);if(!match)throw Error(`Unsupported published version: ${value}`);return match.slice(1).map(Number);};
 const next=parse(manifest.version), old=parse(previous.version);
 const first=next.findIndex((value,index)=>value!==old[index]);
 if(first<0||next[first]<old[first]) throw Error(`Changed package must increase version: ${previous.version} → ${manifest.version}`);
 return {status:'needs-compatibility-review',version:manifest.version,previousVersion:previous.version,added,removed,changed};
}

export async function prepareUpdate({tag, published, workspaceIds}={}) {
 const ids=workspaceIds?json(workspaceIds):{};
 if(!ids||typeof ids!=='object'||Array.isArray(ids)||Object.entries(ids).some(([name,id])=>!products.includes(name)||typeof id!=='string'||!id.trim())) throw Error('Workspace IDs must map product names to verified listing IDs');
 const selected=JSON.parse(gh(['release','view',...(tag?[tag]:[]),'--repo',repository,'--json','tagName,isDraft,isPrerelease,url,assets']));
 const match=selected.tagName.match(/^release-([a-f0-9]{40})$/);
 if(!match||selected.isDraft||selected.isPrerelease) throw Error('Select a completed stable AI Tools release');
 const sourceCommit=match[1];
 const runs=JSON.parse(gh(['run','list','--repo',repository,'--workflow','ci.yml','--commit',sourceCommit,'--branch','main','--event','push','--json','status,conclusion,url','--limit','100']));
 const successful=runs.find(run=>run.status==='completed'&&run.conclusion==='success');
 if(!successful) throw Error('No successful main push CI run for this release');
 const receipt=JSON.parse(Buffer.from(gh(['api',`repos/${repository}/contents/release.json?ref=${selected.tagName}`,'--jq','.content']).trim(),'base64').toString('utf8'));
 if(receipt.sourceCommit!==sourceCommit) throw Error('Release source receipt does not match tag');
 for(const name of products) {
  const product=receipt.products?.[name];
  if(!product||!/^\d+\.\d+\.\d+$/.test(product.version)||!/^[a-f0-9]{64}$/.test(product.packageDigest)) throw Error(`Invalid release receipt: ${name}`);
 }
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-update-'));
 try {
  const downloads=path.join(temporary,'downloads');fs.mkdirSync(downloads);
  const expected=['SHA256SUMS',...products.map(name=>`${name}-${receipt.products[name].version}.zip`)];
  for(const name of expected) if(selected.assets.filter(asset=>asset.name===name).length!==1) throw Error(`Missing or duplicate release asset: ${name}`);
  gh(['release','download',selected.tagName,'--repo',repository,'--dir',downloads,...expected.flatMap(name=>['--pattern',name])]);
  const checksums=fs.readFileSync(path.join(downloads,'SHA256SUMS'),'utf8');
  const packages=path.join(temporary,'packages');fs.mkdirSync(path.join(packages,'plugins'),{recursive:true});
  const planProducts={};
  for(const name of products) {
   const filename=`${name}-${receipt.products[name].version}.zip`, archive=path.join(downloads,filename), target=path.join(packages,'plugins',name);
   verifyChecksum(archive,checksums);
   execFileSync('python3',[path.join(root,'scripts/extract-release.py'),archive,target],{stdio:'pipe'});
   if(digest(target)!==receipt.products[name].packageDigest) throw Error(`Package differs from immutable release receipt: ${name}`);
   const manifest=json(path.join(target,'plugin.json'));
   if(manifest.version!==receipt.products[name].version||manifest.name!==name) throw Error(`Manifest does not match receipt: ${name}`);
   const current=published&&fs.existsSync(path.join(published,name))?path.join(published,name):undefined;
   planProducts[name]={pluginId:ids[name]||null,archive:filename,packageDigest:receipt.products[name].packageDigest,...comparePlugin(target,current)};
  }
  fs.copyFileSync(path.join(packages,'plugins/shelob/LICENSE'),path.join(packages,'LICENSE'));
  fs.mkdirSync(path.join(packages,'.agents/plugins'),{recursive:true});
  fs.writeFileSync(path.join(packages,'.agents/plugins/marketplace.json'),JSON.stringify({name:'ai-tools',plugins:products.map(name=>({name,source:{source:'local',path:`./plugins/${name}`}}))}));
  validate(packages,true);
  checkPublic(packages,{packaged:true});
  const smoke=await smokePackages(packages);
  // Do not clobber a prior upload plan or a user's downloaded current-source archives.
  const destinationParent=path.join(root,'dist/updates');fs.mkdirSync(destinationParent,{recursive:true});
  const destination=fs.mkdtempSync(path.join(destinationParent,`${sourceCommit.slice(0,12)}-`));
  for(const name of products) planProducts[name].archive=path.join(destination,'downloads',planProducts[name].archive);
  const plan={schemaVersion:1,preparedAt:new Date().toISOString(),repository,tag:selected.tagName,sourceCommit,releaseUrl:selected.url,ciUrl:successful.url,smoke,products:planProducts,published:false};
  fs.writeFileSync(path.join(temporary,'plan.json'),JSON.stringify(plan,null,2)+'\n');
  fs.writeFileSync(path.join(temporary,'release.json'),JSON.stringify(receipt,null,2)+'\n');
  for(const item of fs.readdirSync(temporary)) fs.cpSync(path.join(temporary,item),path.join(destination,item),{recursive:true});
  return {plan:path.join(destination,'plan.json'),...plan};
 } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 try {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2) {
   const key={'--tag':'tag','--published':'published','--workspace-ids':'workspaceIds'}[args[i]];
   if(!key||!args[i+1]) throw Error('Usage: pnpm update:prepare [--tag release-SHA] [--published /directory/with/plugin-folders] [--workspace-ids /private/listing-ids.json]');
   options[key]=key==='tag'?args[i+1]:path.resolve(args[i+1]);
  }
  console.log(JSON.stringify(await prepareUpdate(options),null,2));
 } catch(error) {console.error(error.message);process.exitCode=1;}
}
