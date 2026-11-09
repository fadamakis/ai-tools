import {existsSync,openSync,closeSync} from 'node:fs';
import {SauronStore} from './store.js';
import {syntheticObservation} from '../shared/contracts.js';
import {invoke} from './service.js';
import {slackSource} from '../shared/replies.js';

const sample={provider:'slack' as const,sourceUrl:'https://example.slack.com/archives/C123/p1792313076000000',
  actionKey:'Fixture review request',title:'Fixture: review a Slack reply',nextAction:'Prepare and send a simulated reply.',sourceState:'needs_you' as const,resolved:false};

function refreshFixtures(store:SauronStore){
  const scan=store.beginScan();
  if(scan.started)store.finishScan(scan.run.id,{sources:{slack:{status:'checked',detail:'Simulated fixtures only; no source read.'},granola:{status:'checked',detail:'Simulated fixtures only; no source read.'}},items:[sample]});
  return store.view();
}

export function seedDevStore(path:string){
  if(existsSync(path))throw Error('Dev database already exists; setup and rebuild preserve it.');
  closeSync(openSync(path,'wx',0o600));
  const store=new SauronStore(path);
  try{
    store.upsert({batchId:'sauron-dev-fixture-v1',items:[syntheticObservation()]});
    refreshFixtures(store);
    store.createPersonal({operationId:'9c21488a-e52b-4b60-aae7-3d10691fb2dd',title:'Fixture: try a personal task',nextAction:'Complete, snooze, or dismiss this task.',sourceState:'needs_you'});
    const result=store.createPersonal({operationId:'5216c96b-c501-4b3a-b767-132a8cb979e7',title:'Fixture: a completed task',nextAction:'Find this in History.',sourceState:'waiting'});
    const completed=result.items.find(item=>item.id==='personal:5216c96b-c501-4b3a-b767-132a8cb979e7')!;
    store.decide({id:completed.id,expectedVersion:completed.version,action:'complete',operationId:'fixture-complete-v1'});
    return store.storeId;
  }finally{store.close();}
}

export const invokeFixture:typeof invoke=(store,name,args,context)=>{
  switch(name){
    case 'refresh_attention': return refreshFixtures(store);
    case 'check_scheduled_attention':
    case 'check_local_attention':
    case 'configure_attention_sync':
    case 'sync_attention': throw Error('Sauron Dev uses fixtures. Source sync and scheduling are disabled.');
    case 'prepare_slack_reply': {
      const request=args as {taskId:string};
      const task=store.view().items.find(item=>item.id===request?.taskId);
      if(!task||task.sourceUrl!==sample.sourceUrl)throw Error('Select the fixture Slack task to simulate a reply.');
      const {reply,started}=store.replies.beginPrepare(args,task);
      if(started){const source=slackSource(sample.sourceUrl);store.replies.finishPrepare(reply.id,{channelId:source.channelId,threadTs:source.messageTs,destination:'Fixture discussion (no Slack connection)',text:'Simulated reply: I will review the sample.'});}
      return {...store.view(),reply:store.replies.byId(reply.id)};
    }
    case 'send_slack_reply': {
      const request=args as {draftId:string};
      if(store.replies.byId(request?.draftId)?.sourceUrl!==sample.sourceUrl)throw Error('Only fixture replies can be simulated.');
      const {reply,started}=store.replies.beginSend(args);
      if(started)store.replies.finishSend(reply.id,{status:'sent',channelId:reply.channelId,threadTs:reply.threadTs,text:reply.text,messageUrl:sample.sourceUrl,detail:'Simulated receipt; no Slack message sent.',verified:true});
      return {...store.view(),reply:store.replies.byId(reply.id)};
    }
    default: {
      if(!['open_attention','list_attention','link_attention_discussion','save_attention_discussion_link','get_attention_sync_receipt','upsert_attention_items','create_personal_task','track_codex_threads','decide_attention_item','get_slack_reply','save_slack_reply'].includes(name))throw Error('This tool is not available in fixture mode.');
      return invoke(store,name,args,context);
    }
  }
};
