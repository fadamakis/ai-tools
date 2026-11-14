import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';

export const products=['shelob','workbench','sauron'];
const run=(args,options={})=>execFileSync(process.execPath,args,{stdio:'inherit',...options});
const tests=directory=>readdirSync(directory).filter(name=>name.endsWith('.test.mjs')).map(name=>`${directory}/${name}`);

export function buildProduct(product){
  if(product==='shelob')run(['scripts/build.mjs']);
  else if(product==='workbench')run(['scripts/workbench-build.mjs']);
  else if(product==='sauron'){
    run(['../../node_modules/typescript/bin/tsc','--noEmit'],{cwd:'plugins/sauron'});
    run(['scripts/build.mjs'],{cwd:'plugins/sauron'});
  }else throw Error(`Unknown product: ${product}`);
}

export function testProduct(product){
  if(product==='shelob'||product==='workbench')run(['--test',...tests(`plugins/${product}/tests`)]);
  else if(product==='sauron'){
    const files=readdirSync('plugins/sauron/tests').filter(name=>/\.test\.(?:ts|mjs)$/.test(name)).map(name=>`tests/${name}`);
    run(['--import','tsx','--test',...files],{cwd:'plugins/sauron'});
  }else throw Error(`Unknown product: ${product}`);
}

export function testRelease(){run(['--test',...tests('tests/release')]);}

export function testUiProduct(product,args=[]){
  if(product==='shelob'){
    run(['scripts/preview.mjs']);
    run(['node_modules/@playwright/test/cli.js','test','--config','playwright.config.mjs',...args]);
  }else if(product==='workbench')run(['node_modules/@playwright/test/cli.js','test','--config','workbench.playwright.config.mjs',...args]);
  else if(product==='sauron'){
    const root=resolve('plugins/sauron');
    const buildId=`ui-test-${randomUUID()}`;
    const output=join(root,'.data/sauron-dev/builds',buildId);
    try{
      run(['scripts/build.mjs'],{cwd:root,env:{...process.env,SAURON_DEV_BUILD_ID:buildId,SAURON_BUILD_DIR:output}});
      run(['../../node_modules/@playwright/test/cli.js','test',...args],{cwd:root,env:{...process.env,SAURON_DEV_UI_BUILD:output}});
    }finally{rmSync(output,{recursive:true,force:true});}
  }else throw Error(`Unknown product: ${product}`);
}
