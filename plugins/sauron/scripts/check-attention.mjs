import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve, dirname, basename } from 'node:path';
import { dataPath } from '../src/server/data-path.mjs';
import { fileURLToPath } from 'node:url';

// A supported stdio caller for local scheduled checks when native tools are absent.
// This does not establish compatibility with an unrelated cloud Dot.
const manual=process.argv.slice(2).includes('--manual-scan');
if(process.argv.slice(2).some(arg=>arg!=='--manual-scan'))throw Error('Use no arguments for a mode-aware scheduled check, or --manual-scan for an explicit source scan.');
const location=dirname(fileURLToPath(import.meta.url));
const root=resolve(location,basename(location)==='server'?'../..':'..');
const client=new Client({name:'sauron-background-check',version:'0.6.6'});
const transport=new StdioClientTransport({command:process.execPath,
  args:[resolve(root,'dist/server/index.js')],cwd:root,
  env:{...process.env,ATTENTION_DB:dataPath()},stderr:'pipe'});
async function call(name){
  const response=await client.callTool({name,arguments:{}});
  if(response.isError)throw Error(response.content?.find(item=>item.type==='text')?.text??'Sauron check failed');
  if(!response.structuredContent?.items)throw Error('Invalid Sauron response');
  return response.structuredContent;
}
try {
  await client.connect(transport);
  const before=await call('list_attention');
  let view=await call(manual?'refresh_attention':'check_scheduled_attention');
  if(!manual&&view.coordination?.mode!=='independent') {
    const freshness=view.coordination.freshness;
    const failed=freshness.businessHoursActive&&['never','stale','partial','failed'].includes(freshness.status);
    console.log(JSON.stringify({storeId:view.storeId,mode:view.coordination.mode,automaticWriter:view.coordination.mode==='local_managed'?'local':'dot',checkKind:'sync_freshness',
      sourceScanStarted:false,sourcesChecked:false,coordination:view.coordination,sync:view.sync,scan:view.scan,
      needsYou:view.items.filter(task=>task.state==='needs_you').length,changes:[],notifyFailure:failed,
      message:'Read saved managed sync freshness only. No independent source scan was started; source coverage is available in sync.sources.'},null,2));
  } else {
  const id=view.scan.id,deadline=Date.now()+13*60_000;
  while(view.scan?.id===id&&view.scan.status==='running') {
    if(Date.now()>deadline)throw Error('Sauron did not finish before the caller deadline');
    await new Promise(resolve=>setTimeout(resolve,2000));
    view=await call('list_attention');
  }
  if(view.scan?.id!==id)throw Error('A later scan replaced this check; read Sauron for its current status');
  const prior=new Map(before.items.map(task=>[task.id,task]));
  const changes=view.items.filter(task=>{
    const old=prior.get(task.id);
    return task.state==='needs_you'&&(!old||old.state!=='needs_you'||old.title!==task.title||old.nextAction!==task.nextAction);
  }).map(({id,title,nextAction,sourceUrl})=>({id,title,nextAction,sourceUrl}));
  const failed=view.scan.status==='partial'||view.scan.status==='failed';
  console.log(JSON.stringify({storeId:view.storeId,mode:view.coordination?.mode??'independent',automaticWriter:view.coordination?.mode!=='independent'?'dot':'legacy_scanner',checkKind:'source_scan',sourceScanStarted:before.scan?.id!==view.scan?.id,scan:view.scan,needsYou:view.items.filter(task=>task.state==='needs_you').length,
    changes,notifyFailure:failed&&(before.scan?.status!==view.scan.status||before.scan?.error!==view.scan.error)},null,2));
  }
}finally{await client.close();}
