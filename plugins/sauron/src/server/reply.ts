import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SauronStore } from './store.js';
import { prepareReplySchema,replyTaskSchema } from '../shared/replies.js';

function startWorker(store:SauronStore,id:string,kind:'prepare'|'send'){
  try{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./reply-worker.js',import.meta.url)),store.path,id,kind],
      {stdio:'ignore',detached:true,env:process.env});
    child.on('error',()=>store.replies.fail(id));child.unref();
  }catch{store.replies.fail(id);}
}
export function getReply(store:SauronStore,input:unknown){
  const {taskId}=replyTaskSchema.parse(input);return {...store.view(),reply:store.replies.latest(taskId)};
}
export function prepareReply(store:SauronStore,input:unknown){
  const {taskId}=prepareReplySchema.parse(input);
  const task=store.view().items.find(item=>item.id===taskId);if(!task)throw Error('This Slack task is no longer available.');
  const {reply,started}=store.replies.beginPrepare(input,task);if(started)startWorker(store,reply.id,'prepare');
  return {...store.view(),reply:store.replies.byId(reply.id)};
}
export function sendReply(store:SauronStore,input:unknown){
  const {reply,started}=store.replies.beginSend(input);if(started)startWorker(store,reply.id,'send');
  return {...store.view(),reply:store.replies.byId(reply.id)};
}
