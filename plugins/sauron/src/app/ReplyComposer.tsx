import { Button } from '@ai-tools/ui';
import { Textarea } from '@ai-tools/ui';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { Task,Result } from '../shared/contracts.js';
import type { ReplyDraft } from '../shared/replies.js';
import type { Client } from './client.js';
import { Icon } from './icons.js';
import { operationId } from './operation.js';

function cached(reply:ReplyDraft){
  try{const value=JSON.parse(sessionStorage.getItem('sauron:reply:'+reply.id)??'null');
    return reply.status==='ready'&&value?.revision===reply.revision&&typeof value.text==='string'?value.text:reply.text;
  }catch{return reply.text;}
}
function cache(id:string,text:string,revision:number){try{sessionStorage.setItem('sauron:reply:'+id,JSON.stringify({text,revision}));}catch{/* The editable draft remains available in this view. */}}

export function ReplyComposer({task,client,disabled}:{task:Task;client:Client|null;disabled:boolean}){
  const [expanded,setExpanded]=useState(false);
  const [reply,setReply]=useState<ReplyDraft|null>(null);
  const [text,setText]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const lock=useRef(false),editor=useRef<HTMLTextAreaElement>(null),button=useRef<HTMLButtonElement>(null);
  const current=useRef<ReplyDraft|null>(null),latestText=useRef(''),saveQueue=useRef<Promise<void>|null>(null);
  const running=reply?.status==='preparing'||reply?.status==='sending';
  function accept(result:Result){const draft=result.reply??null;current.current=draft;setReply(draft);if(draft){latestText.current=cached(draft);setText(latestText.current);}return draft;}
  async function run(work:()=>Promise<void>){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
    try{await work();}catch(error){setError(error instanceof Error?error.message:'The reply could not be updated. Reopen it to check its saved status.');}
    finally{lock.current=false;setBusy(false);}
  }
  function open(){if(!client)return;setExpanded(true);void run(async()=>{
    const draft=accept(await client.call('get_slack_reply',{taskId:task.id}));
    if(!draft)accept(await client.call('prepare_slack_reply',{taskId:task.id,operationId:operationId()}));
  });}
  function prepare(){if(client)void run(async()=>{accept(await client.call('prepare_slack_reply',{taskId:task.id,operationId:operationId()}));});}
  useEffect(()=>{
    if(!expanded||!running||!client)return;
    let active=true,loading=false;
    const timer=window.setInterval(async()=>{
      if(loading)return;loading=true;
      try{const result=await client.call('get_slack_reply',{taskId:task.id});if(active)accept(result);}
      catch{if(active)setError('Status could not be loaded. Reopen the reply to reconnect.');}
      finally{loading=false;}
    },1500);
    return()=>{active=false;clearInterval(timer);};
  },[expanded,running,client,task.id]);
  useEffect(()=>{if(expanded&&reply?.status==='ready')editor.current?.focus();},[expanded,reply?.status]);
  const save=useCallback(async(value=latestText.current)=>{
    const work=(saveQueue.current??Promise.resolve()).catch(()=>{}).then(async()=>{
      const draft=current.current;
      if(!client||draft?.status!=='ready'||!value.trim()||value===draft.text)return;
      const result=await client.call('save_slack_reply',{draftId:draft.id,expectedRevision:draft.revision,text:value});
      if(result.reply){current.current=result.reply;setReply(result.reply);cache(result.reply.id,latestText.current,result.reply.revision);}
    });
    saveQueue.current=work;await work;
  },[client]);
  useEffect(()=>{
    if(!expanded||busy||reply?.status!=='ready'||text===reply.text||!text.trim())return;
    let active=true;
    const timer=window.setTimeout(()=>{void save(text).catch(()=>{if(active)setError('The edited draft could not be saved. Copy it before leaving.');});},600);
    return()=>{active=false;clearTimeout(timer);};
  },[expanded,busy,reply?.status,reply?.revision,reply?.text,text,save]);
  useEffect(()=>()=>{void save().catch(()=>{});},[save]);
  function close(){void run(async()=>{await save();setExpanded(false);requestAnimationFrame(()=>button.current?.focus());});}
  function copy(){
    void run(save);
    // Keep clipboard access in the user's gesture; opaque host frames may deny it.
    if(navigator.clipboard?.writeText){void navigator.clipboard.writeText(text).then(()=>setNotice('Copied reply.')).catch(selectForCopy);}
    else selectForCopy();
  }
  function selectForCopy(){editor.current?.focus();editor.current?.select();setNotice('Reply selected. Press ⌘C or Ctrl+C to copy.');}
  function send(){
    if(!client||!reply||reply.status!=='ready')return;
    void run(async()=>{
      await save(text);const draft=current.current!;
      const args={draftId:draft.id,expectedRevision:draft.revision,text,operationId:operationId()};
      current.current={...draft,text,status:'sending'};setReply(current.current);
      accept(await client.call('send_slack_reply',args));
    });
  }
  if(!expanded)return <Button size="sm" pill={false} color="secondary" variant="ghost" ref={button} className="prepare-reply" disabled={disabled||!client} onClick={open}>Prepare reply</Button>;
  return <section className="reply-composer" aria-label={`Reply to ${task.title}`}>
    <div className="reply-heading"><h3>Reply in Slack</h3><Button size="sm" pill={false} color="secondary" variant="ghost" uniform aria-label="Close reply" disabled={busy} onClick={close}><Icon name="close"/></Button></div>
    <p className="reply-destination">{reply?.destination?<>To <strong>{reply.destination}</strong> · original thread</>:'Reading the original discussion…'}</p>
    {reply?.status==='preparing'&&<p role="status" className="reply-progress">Preparing a reply from the latest discussion…</p>}
    {!!reply?.text&&<><Textarea aria-label="Reply draft" ref={editor} rows={5} maxLength={4000} value={text} readOnly={reply.status!=='ready'||busy}
        onChange={event=>{latestText.current=event.target.value;setText(event.target.value);cache(reply.id,event.target.value,reply.revision);setNotice('');}}/>
      <div className="reply-actions"><Button size="sm" pill={false} color="secondary" variant="outline" disabled={busy||!text.trim()} onClick={copy}>Copy reply</Button>
        {reply.status==='ready'&&<Button size="sm" pill={false} color="primary" disabled={disabled||busy||!text.trim()} onClick={send}>Send to Slack</Button>}
        {reply.status==='sending'&&<Button size="sm" pill={false} color="primary" disabled aria-busy="true">Sending…</Button>}
        {reply.status==='sent'&&<span className="reply-sent" role="status"><Icon name="check" width="14"/> Sent to Slack</span>}
      </div></>}
    {reply?.status==='sent'&&<Button size="sm" pill={false} color="secondary" variant="ghost" onClick={()=>void client?.open(reply.messageUrl!)}>Open sent reply <Icon name="arrow" width="12"/></Button>}
    {reply?.status==='sent'&&<Button size="sm" pill={false} color="secondary" variant="ghost" className="another-reply" disabled={busy} onClick={prepare}>Prepare another reply</Button>}
    {(error||reply?.error)&&<p className="reply-error" role="alert">{error||reply?.error}</p>}
    {(reply?.status==='uncertain'||error)&&<Button size="sm" pill={false} color="secondary" variant="ghost" onClick={()=>void client?.open(task.sourceUrl!)}>Check Slack discussion <Icon name="arrow" width="12"/></Button>}
    {reply?.status==='failed'&&<Button size="sm" pill={false} color="secondary" variant="outline" disabled={busy} onClick={prepare}>Try preparing again</Button>}
    {notice&&<p className="reply-notice" role="status">{notice}</p>}
  </section>;
}
