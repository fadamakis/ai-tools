import type { DatabaseSync } from 'node:sqlite';
import type { Task } from '../shared/contracts.js';
import { prepareReplySchema,saveReplySchema,sendReplySchema,draftOutputSchema,sentOutputSchema,slackSource,type ReplyDraft } from '../shared/replies.js';

export class ReplyStore {
  constructor(private db:DatabaseSync,private now:()=>Date){
    db.exec(`CREATE TABLE IF NOT EXISTS reply_drafts (seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, task_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reply_task ON reply_drafts(task_id,seq);
      CREATE TABLE IF NOT EXISTS reply_sends (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, text TEXT NOT NULL);`);
  }
  private transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private write(reply:ReplyDraft){this.db.prepare('INSERT INTO reply_drafts(id,task_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(reply.id,reply.taskId,JSON.stringify(reply));}
  byId(id:string):ReplyDraft|null{
    const row=this.db.prepare('SELECT data FROM reply_drafts WHERE id=?').get(id);
    if(!row)return null;
    const reply=JSON.parse(row.data as string) as ReplyDraft;
    if(['preparing','sending'].includes(reply.status)&&this.now().getTime()-Date.parse(reply.updatedAt)>12*60_000){
      const next={...reply,status:reply.status==='sending'?'uncertain' as const:'failed' as const,
        error:reply.status==='sending'?'Delivery could not be confirmed. Check the Slack thread before sending again.':'Preparing the reply was interrupted. Try preparing it again.',updatedAt:this.now().toISOString()};
      // A late reader must not overwrite a worker that has just completed.
      const result=this.db.prepare('UPDATE reply_drafts SET data=? WHERE id=? AND data=?').run(JSON.stringify(next),id,row.data as string);
      return result.changes?next:this.byId(id);
    }
    return reply;
  }
  latest(taskId:string):ReplyDraft|null{
    const row=this.db.prepare('SELECT id FROM reply_drafts WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(taskId);
    return row?this.byId(row.id as string):null;
  }
  beginPrepare(input:unknown,task:Task):{reply:ReplyDraft;started:boolean}{
    const args=prepareReplySchema.parse(input);
    if(task.id!==args.taskId||task.provider!=='slack'||!task.sourceUrl)throw Error('Replies are available for connected Slack tasks.');
    slackSource(task.sourceUrl);
    return this.transaction(()=>{
      const duplicate=this.byId(args.operationId);
      if(duplicate){if(duplicate.taskId!==task.id)throw Error('This operation belongs to another task.');return {reply:duplicate,started:false};}
      const current=this.latest(task.id);
      if(current&&['preparing','ready','sending','uncertain'].includes(current.status))return {reply:current,started:false};
      const time=this.now().toISOString();
      const reply:ReplyDraft={id:args.operationId,taskId:task.id,sourceUrl:task.sourceUrl,status:'preparing',text:'',revision:1,
        channelId:null,threadTs:null,destination:null,startedAt:time,updatedAt:time,sendOperationId:null,messageUrl:null,error:null};
      this.write(reply);return {reply,started:true};
    });
  }
  finishPrepare(id:string,input:unknown){
    const draft=draftOutputSchema.parse(input);
    return this.transaction(()=>{
      const reply=this.byId(id);if(!reply||reply.status!=='preparing')return;
      const source=slackSource(reply.sourceUrl);
      if(draft.channelId!==source.channelId||draft.threadTs>source.messageTs)throw Error('The reply destination did not match this discussion.');
      this.write({...reply,...draft,status:'ready',revision:reply.revision+1,updatedAt:this.now().toISOString()});
    });
  }
  save(input:unknown):ReplyDraft{
    const args=saveReplySchema.parse(input);
    return this.transaction(()=>{
      const reply=this.byId(args.draftId);if(!reply||reply.status!=='ready')throw Error('This draft cannot be edited now.');
      if(reply.text===args.text)return reply;
      if(reply.revision!==args.expectedRevision)throw Error('The draft changed in another view. Reopen it before editing.');
      const updated={...reply,text:args.text,revision:reply.revision+1,updatedAt:this.now().toISOString()};this.write(updated);return updated;
    });
  }
  beginSend(input:unknown):{reply:ReplyDraft;started:boolean}{
    const args=sendReplySchema.parse(input);
    return this.transaction(()=>{
      const receipt=this.db.prepare('SELECT draft_id,text FROM reply_sends WHERE id=?').get(args.operationId);
      if(receipt){
        if(receipt.draft_id!==args.draftId||receipt.text!==args.text)throw Error('This send operation was already used for different text.');
        return {reply:this.byId(args.draftId)!,started:false};
      }
      const reply=this.byId(args.draftId);
      if(!reply||reply.status!=='ready'||!reply.channelId||!reply.threadTs)throw Error('This draft is not ready to send.');
      if(reply.revision!==args.expectedRevision)throw Error('The draft changed in another view. Reopen it before sending.');
      const updated:ReplyDraft={...reply,text:args.text,status:'sending',revision:reply.revision+1,
        sendOperationId:args.operationId,updatedAt:this.now().toISOString(),error:null};
      this.db.prepare('INSERT INTO reply_sends VALUES (?,?,?)').run(args.operationId,args.draftId,args.text);
      this.write(updated);return {reply:updated,started:true};
    });
  }
  finishSend(id:string,input:unknown){
    const output=sentOutputSchema.parse(input);
    this.transaction(()=>{
      const reply=this.byId(id);if(!reply||reply.status!=='sending')return;
      const exact=output.channelId===reply.channelId&&output.threadTs===reply.threadTs&&output.text===reply.text;
      let validLink=false;
      try{const message=slackSource(output.messageUrl!);validLink=message.host===slackSource(reply.sourceUrl).host&&message.channelId===reply.channelId;}catch{/* An unverifiable receipt is never success. */}
      const sent=exact&&output.status==='sent'&&output.verified&&validLink;
      this.write({...reply,status:sent?'sent':'uncertain',messageUrl:sent?output.messageUrl:null,updatedAt:this.now().toISOString(),
        error:sent?null:output.status==='not_sent'?'Slack did not confirm delivery. Check the thread; the draft is still available to copy.':'Delivery could not be confirmed. Check the Slack thread before sending again.'});
    });
  }
  fail(id:string){
    this.transaction(()=>{
      const reply=this.byId(id);if(!reply||!['preparing','sending'].includes(reply.status))return;
      this.write({...reply,status:reply.status==='sending'?'uncertain':'failed',updatedAt:this.now().toISOString(),
        error:reply.status==='sending'?'Delivery could not be confirmed. Check the Slack thread before sending again.':'The discussion could not be read. Try preparing the reply again.'});
    });
  }
}
