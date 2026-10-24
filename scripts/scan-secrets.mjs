import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {sourcePaths} from './check-public.mjs';

const root=process.cwd(),config=JSON.parse(fs.readFileSync(path.join(root,'scripts/security-tools.json'),'utf8'));
const platform=`${process.platform}-${process.arch}`,archive=config.archives[platform];
if(!archive&&!process.env.GITLEAKS_BINARY)throw Error(`Secret scanner bootstrap is not configured for ${platform}. Supply a verified GITLEAKS_BINARY.`);
const cache=path.join(root,'.cache/security',config.version),binary=process.env.GITLEAKS_BINARY||path.join(cache,'gitleaks');
if(!fs.existsSync(binary)) {
  fs.mkdirSync(cache,{recursive:true});
  const response=await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${config.version}/${archive.name}`,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Scanner download failed: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==archive.sha256)throw Error('Scanner archive checksum differs from the pinned release');
  const compressed=path.join(cache,archive.name);fs.writeFileSync(compressed,bytes);
  execFileSync('tar',['-xzf',compressed,'-C',cache,'gitleaks']);fs.chmodSync(binary,0o700);
}
const version=execFileSync(binary,['version'],{encoding:'utf8'}).trim();
if(version!==config.version)throw Error(`Expected Gitleaks ${config.version}; received ${version}`);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ai-tools-secret-scan-'));
const reportDirectory=path.join(root,'dist/security');fs.mkdirSync(reportDirectory,{recursive:true});
const run=(mode,target,label,extra=[])=>{
  const result=spawnSync(binary,[mode,target,...extra,'--config',path.join(root,'.gitleaks.toml'),'--redact=100','--no-banner','--report-format','json','--report-path',path.join(reportDirectory,`${label}.json`)],{encoding:'utf8'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`Secret scan ${label} failed (exit ${result.status}); inspect the redacted report in dist/security.`);
};
try {
  for(const file of sourcePaths(root)) {
    if(fs.lstatSync(file).isSymbolicLink())throw Error('Secret scan source contains a symlink');
    const target=path.join(temporary,path.relative(root,file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);
  }
  run('dir',temporary,'source');
  if(process.argv.includes('--history'))run('git',root,'history',['--log-opts=--all']);
  const index=process.argv.indexOf('--packages');
  if(index!==-1) {
    if(!process.argv[index+1])throw Error('--packages needs a directory');
    run('dir',path.resolve(process.argv[index+1]),'packages');
  }
  console.log(JSON.stringify({scanner:'gitleaks',version,source:'passed',history:process.argv.includes('--history')?'passed':'not requested',packages:index!==-1?'passed':'not requested'}));
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
