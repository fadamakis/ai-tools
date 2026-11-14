import {spawn,execFileSync,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash} from 'node:crypto';
import {statSync,realpathSync} from 'node:fs';
import {z} from 'zod';
import {resolveCodexCli} from './codex-cli.mjs';
import {minimalAgentEnv,localPolicyArgs,inertServerArgs} from './local-policy.js';
import type {ChatEvidence,ChatHeader} from '../shared/review-contracts.js';

const header=z.object({id:z.string().uuid(),name:z.string().nullable().optional(),preview:z.string().optional(),updatedAt:z.number(),createdAt:z.number()});
const page=z.object({data:z.array(z.unknown()),nextCursor:z.string().nullable()});
export interface ChatReader{runtime:string;probe():Promise<void>;list(archived:boolean,cursor:string|null):Promise<{chats:ChatHeader[];nextCursor:string|null}>;read(chat:ChatHeader,from:string,through:string):Promise<ChatEvidence>;close():void;}
export const runtimeFingerprint=(cli=resolveCodexCli())=>{const path=realpathSync(cli),stat=statSync(path);return createHash('sha256').update(JSON.stringify([path,stat.size,stat.mtimeMs])).digest('hex');};
export class CodexChatReader implements ChatReader{
  readonly runtime:string;
  private child:ChildProcessWithoutNullStreams;
  private nextId=0;
  private buffer='';
  private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  private ready:Promise<unknown>;
  constructor(cli=resolveCodexCli()){
    this.runtime=runtimeFingerprint(cli);
    const policy=localPolicyArgs([]);
    try{
      const inventory=()=>JSON.parse(execFileSync(cli,['mcp','list','--json',...policy],{encoding:'utf8',env:minimalAgentEnv(),stdio:['ignore','pipe','ignore'],timeout:20000,maxBuffer:1_000_000}));
      policy.push(...inertServerArgs(inventory()));
      const checked=inventory();if(!Array.isArray(checked)||checked.some(server=>server.enabled!==false))throw Error('Unsafe server inventory.');
    }catch{throw Error('The read-only chat policy could not be established.');}
    this.child=spawn(cli,['app-server','--stdio',...policy,'-c','features.plugins=false','-c','features.apps=false'],{env:minimalAgentEnv(),stdio:['pipe','pipe','pipe']});
    this.child.stdout.on('data',data=>{
      this.buffer+=data.toString();if(this.buffer.length>4_000_000){this.fail();return;}
      for(;;){const index=this.buffer.indexOf('\n');if(index<0)break;const line=this.buffer.slice(0,index);this.buffer=this.buffer.slice(index+1);
        try{const message=JSON.parse(line),pending=this.pending.get(message.id);if(pending){if(message.error)pending.reject(Error('The chat runtime rejected a required read.'));else pending.resolve(message.result);}}catch{}
      }
    });
    this.child.stderr.on('data',()=>{});this.child.on('error',()=>this.fail());this.child.on('exit',()=>this.fail());
    this.child.stdin.on('error',()=>this.fail());
    this.ready=this.request('initialize',{clientInfo:{name:'sauron-organisation-reader',version:'1'}}).then(()=>this.child.stdin.write(JSON.stringify({method:'initialized'})+'\n'));
  }
  private fail(){for(const pending of this.pending.values())pending.reject(Error('Local chat access is unavailable. Recheck the Codex runtime.'));this.pending.clear();}
  private async request(method:string,params:unknown):Promise<unknown>{
    if(!['initialize','thread/list','thread/read','thread/turns/list','thread/items/list'].includes(method))throw Error('Only chat reads are permitted.');
    const id=++this.nextId;let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});timer=setTimeout(()=>reject(Error('Local chat read timed out.')),30_000);this.child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
    finally{clearTimeout(timer);this.pending.delete(id);}
  }
  async list(archived:boolean,cursor:string|null){
    await this.ready;const result=page.parse(await this.request('thread/list',{limit:25,sortKey:'updated_at',sortDirection:'desc',archived,cursor,modelProviders:[],sourceKinds:['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'],useStateDbOnly:false}));
    return {chats:result.data.map(value=>{const item=header.parse(value);return {id:item.id,title:(item.name||item.preview||'Untitled chat').slice(0,160),updatedAt:item.updatedAt,createdAt:item.createdAt};}),nextCursor:result.nextCursor};
  }
  async probe(){
    const active=await this.list(false,null),archived=await this.list(true,null),chat=active.chats[0]??archived.chats[0];
    if(!chat)throw Error('Create a durable local Codex chat before checking read capabilities.');
    await this.request('thread/read',{threadId:chat.id,includeTurns:false});
    page.parse(await this.request('thread/turns/list',{threadId:chat.id,limit:1,itemsView:'notLoaded'}));
    page.parse(await this.request('thread/items/list',{threadId:chat.id,limit:1}));
  }
  async read(chat:ChatHeader,from:string,through:string):Promise<ChatEvidence>{
    await this.ready;const metadata=z.object({thread:header}).parse(await this.request('thread/read',{threadId:chat.id,includeTurns:false}));
    const messages:ChatEvidence['messages']=[];let cursor:string|null=null,pages=0,bytes=0,latestAssistant:string|null=null,latestAssistantAt:number|null=null;
    do{
      const turns=page.parse(await this.request('thread/turns/list',{threadId:chat.id,cursor,limit:50,itemsView:'notLoaded',sortDirection:'desc'}));cursor=turns.nextCursor;
      for(const value of turns.data){
        const turn=z.object({id:z.string(),startedAt:z.number().nullable(),completedAt:z.number().nullable()}).parse(value);
        if((turn.startedAt??0)*1000>=Date.parse(through))continue;
        if(turn.completedAt===null)throw Error('A chat has unfinished work. Coverage will resume after its turn completes.');
        const activity=(turn.completedAt??turn.startedAt??0)*1000;
        if(activity<Date.parse(from))continue;if(activity>=Date.parse(through))continue;
        let itemCursor:string|null=null,turnAssistant:string|null=null,turnAssistantAt:number|null=null;
        do{
          if(turns.data.length&&turns.data.every(value=>{const turn=value as {completedAt:number|null};return turn.completedAt!==null&&turn.completedAt*1000<Date.parse(from);}))cursor=null;
      if(++pages>100)throw Error('A chat exceeded the read-page budget. Coverage is incomplete.');
          const items=page.parse(await this.request('thread/items/list',{threadId:chat.id,turnId:turn.id,cursor:itemCursor,limit:100,sortDirection:'asc'}));itemCursor=items.nextCursor;
          for(const entry of items.data){
            const parsed=z.object({item:z.record(z.string(),z.unknown()),startedAtMs:z.number().nullable().optional(),completedAtMs:z.number().nullable().optional()}).parse(entry),item=parsed.item;
            const itemAt=parsed.completedAtMs??parsed.startedAtMs??activity;if(itemAt>=Date.parse(through))continue;
            if(item.type!=='userMessage'&&!(item.type==='agentMessage'&&(item.phase===null||item.phase==='final'||item.phase===undefined)))continue;
            const text=item.type==='agentMessage'?z.string().parse(item.text):z.array(z.object({type:z.string(),text:z.string().optional()})).parse(item.content).filter(part=>part.type==='text').map(part=>part.text??'').join('\n');
            const id=turn.id+':'+z.string().parse(item.id)+':'+createHash('sha256').update(text).digest('hex');
            bytes+=text.length;if(bytes>60_000)throw Error('A chat exceeded the evidence budget. Coverage is incomplete.');
            messages.push({id,text,role:item.type==='userMessage'?'user':'assistant'});if(item.type==='agentMessage'){turnAssistant=id;turnAssistantAt=itemAt;}
          }
        }while(itemCursor);
        if(!latestAssistant&&turnAssistant){latestAssistant=turnAssistant;latestAssistantAt=turnAssistantAt;}
      }
      if(turns.data.length&&turns.data.every(value=>{const turn=value as {completedAt:number|null};return turn.completedAt!==null&&turn.completedAt*1000<Date.parse(from);}))cursor=null;
      if(++pages>100)throw Error('A chat exceeded the read-page budget. Coverage is incomplete.');
    }while(cursor);
    const fingerprint=createHash('sha256').update(JSON.stringify(messages.map(message=>message.id))).digest('hex');
    return {threadId:chat.id,title:(metadata.thread.name||chat.title).slice(0,160),fingerprint,messages,latestAssistant,latestAssistantAt,observedUpdatedAt:metadata.thread.updatedAt};
  }
  close(){this.fail();this.child.stdin.end();this.child.kill();}
}
