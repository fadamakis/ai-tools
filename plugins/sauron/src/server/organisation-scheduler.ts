import {mkdirSync,readFileSync,writeFileSync,chmodSync,existsSync,unlinkSync,renameSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const xml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function setOrganisationSchedule(path:string,storeId:string,enabled:boolean,options:{platform?:string;uid?:number;sourceDirectory?:string;run?:(args:string[])=>number|null}={}){
  const uid=options.uid??process.getuid?.(),run=options.run??((args:string[])=>spawnSync('/bin/launchctl',args,{stdio:'ignore'}).status);
  if((options.platform??process.platform)!=='darwin'||uid===undefined)throw Error('Daily organisation scheduling currently requires macOS. Manual review remains available.');
  const root=join(dirname(path),'organisation-runtime'),label='com.sauron.organisation.'+storeId,target=`gui/${uid}`,plist=join(root,'review.plist');
  if(!enabled){
    const loaded={status:run(['print',target+'/'+label])};
    if(loaded.status===0&&run(['bootout',target+'/'+label])!==0)throw Error('Could not stop the organisation schedule. It remains enabled.');
    if(existsSync(plist))unlinkSync(plist);return;
  }
  mkdirSync(root,{recursive:true,mode:0o700});
  for(const name of ['check-organisation.js','organisation-worker.js']){const temporary=join(root,name+'.'+randomUUID()+'.tmp');writeFileSync(temporary,readFileSync(join(options.sourceDirectory??dirname(fileURLToPath(import.meta.url)),name)),{mode:0o700});renameSync(temporary,join(root,name));chmodSync(join(root,name),0o700);}
  const args=[process.execPath,join(root,'check-organisation.js'),'--database',path,'--expected-store-id',storeId];
  const content=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${args.map(arg=>`<string>${xml(arg)}</string>`).join('')}</array><key>StartInterval</key><integer>60</integer><key>RunAtLoad</key><true/></dict></plist>`;
  writeFileSync(plist,content,{mode:0o600});
  if(run(['print',target+'/'+label])===0&&run(['bootout',target+'/'+label])!==0)throw Error('Could not replace the existing organisation schedule.');
  if(run(['bootstrap',target,plist])!==0)throw Error('Could not enable the daily organisation schedule. No review was enabled.');
}
