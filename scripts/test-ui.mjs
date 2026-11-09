import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

execFileSync(process.execPath,['scripts/preview.mjs'],{stdio:'inherit'});
for(const config of ['playwright.config.mjs','workbench.playwright.config.mjs']) execFileSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config',config],{stdio:'inherit'});

const sauronRoot=resolve('plugins/sauron');
const buildId='ui-test-'+randomUUID();
const devBuild=join(sauronRoot,'.data/sauron-dev/builds',buildId);
try{
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:sauronRoot,stdio:'inherit',env:{...process.env,SAURON_DEV_BUILD_ID:buildId,SAURON_BUILD_DIR:devBuild}});
  execFileSync(process.execPath,['../../node_modules/@playwright/test/cli.js','test'],{cwd:sauronRoot,stdio:'inherit',env:{...process.env,SAURON_DEV_UI_BUILD:devBuild}});
}finally{rmSync(devBuild,{recursive:true,force:true});}
