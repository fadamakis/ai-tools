import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {files,products} from './release.mjs';

const textFile = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|html|css|toml|txt|svg|template)$/i;
const textNames = new Set(['LICENSE','.gitignore','.npmrc','.gitattributes']);
const safeTenants = new Set(['example','example-workspace','your-workspace','tenant','api','developer','docs']);

export function inspectPublicText(text, filename) {
  const findings=[];
  const record=(category,index)=>findings.push({category,file:filename,line:text.slice(0,index).split('\n').length});
  for(const match of text.matchAll(/https?:\/\/([a-z0-9-]+)\.(?:slack\.com|atlassian\.net)\b/gi)) {
    if(!safeTenants.has(match[1].toLowerCase()))record('workspace-specific URL',match.index);
  }
  for(const match of text.matchAll(/\/(?:Users|home)\/(?!you(?:\/|\b)|example(?:\/|\b)|designer(?:\/|\b))[^/\s'"`<>]+\//g))record('personal home path',match.index);
  for(const match of text.matchAll(/\bPlugin_[a-f0-9]{32}\b/gi))record('workspace listing binding',match.index);
  for(const match of text.matchAll(/https?:\/\/(?:[a-z0-9-]+\.)*preply\.(?:org|com)\b/gi))record('organization-specific host',match.index);
  return findings;
}

export function sourcePaths(root) {
  return execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'})
    .split('\0').filter(name=>name&&fs.existsSync(path.join(root,name))).map(name=>path.join(root,name));
}

function linkTarget(root,file,target) {
  if(!target||target.startsWith('#')||target.includes('<')||target.includes('$'))return null;
  const repository=target.match(/^https:\/\/github\.com\/fadamakis\/ai-tools\/(?:blob|tree)\/main\/(.+?)(?:#.*)?$/);
  if(repository) {
    // Public source links are checked against the owning source checkout, not an extracted ZIP.
    if(!fs.existsSync(path.join(root,'.git')))return null;
    return path.resolve(root,decodeURIComponent(repository[1]));
  }
  if(/^[a-z][a-z\d+.-]*:/i.test(target))return null;
  return path.resolve(path.dirname(file),decodeURIComponent(target.split('#')[0]));
}

export function checkPublic(root=process.cwd(),{packaged=false}={}) {
  root=path.resolve(root);
  const license=fs.readFileSync(path.join(root,'LICENSE'),'utf8');
  assert.match(license,/^MIT License\n/);
  assert.match(license,/Permission is hereby granted/);
  const candidates=packaged?files(root):sourcePaths(root);
  const findings=[];
  for(const file of candidates) {
    const relative=path.relative(root,file);
    assert.equal(fs.lstatSync(file).isSymbolicLink(),false,`Public source cannot contain a symlink: ${relative}`);
    if(/(?:^|\/)(?:\.env(?:\.(?!example$)[^/]+)?|[^/]+\.(?:sqlite(?:-[^/]*)?|db|pem|p12))$/i.test(relative))findings.push({file:relative,category:'private runtime or credential file'});
    if(!textFile.test(file)&&!textNames.has(path.basename(file)))continue;
    const text=fs.readFileSync(file,'utf8');
    findings.push(...inspectPublicText(text,relative));
    if(file.endsWith('.md'))for(const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target=linkTarget(root,file,match[1]);
      if(target&&(!target.startsWith(root+path.sep)||!fs.existsSync(target)))findings.push({file:relative,category:'missing or escaping documentation link',line:text.slice(0,match.index).split('\n').length});
    }
  }
  for(const name of products) {
    const plugin=path.join(root,'plugins',name),manifest=JSON.parse(fs.readFileSync(path.join(plugin,'plugin.json'),'utf8'));
    assert.equal(manifest.license,'MIT',`${name}: project license metadata missing`);
    if(packaged)assert.equal(fs.readFileSync(path.join(plugin,'LICENSE'),'utf8'),license,`${name}: distributed project license differs`);
  }
  if(packaged) {
    const catalog=JSON.parse(fs.readFileSync(path.join(root,'.agents/plugins/marketplace.json'),'utf8'));
    assert.ok(catalog.plugins.every(entry=>!Object.hasOwn(entry,'pluginId')),'Public catalog must not contain workspace listing bindings');
  }
  assert.equal(findings.length,0,`Public distribution checks failed (values omitted):\n${JSON.stringify(findings,null,2)}`);
  return {filesChecked:candidates.length,products:products.length,status:'passed'};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))console.log(JSON.stringify(checkPublic(process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:process.cwd(),{packaged:process.argv.includes('--packaged')})));
