import React, { useId, useRef, useState } from 'react';
import { Button,Input } from '@ai-tools/ui';
import type { Task,DiscussionLink,Result } from '../shared/contracts.js';
import type { Client } from './client.js';

function ChatLinkForm({taskId,storeId,client,disabled,onSaved}:{taskId:string;storeId:string;client:Client;disabled:boolean;onSaved:(view:Result)=>void}){
  const linkId=useId();
  const gate=useRef(false);
  const [url,setUrl]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  async function saveLink(){
    if(gate.current||disabled||!url.trim())return;
    gate.current=true;setSaving(true);setError('');
    try{onSaved(await client.call('save_attention_discussion_link',{expectedStoreId:storeId,taskId,url}));}
    catch(e){setError(e instanceof Error?e.message:'The chat link could not be saved.');}
    finally{gate.current=false;setSaving(false);}
  }
  // Native form submission is disabled by the app sandbox. Explicit click and
  // Enter handlers use the same local tool call without requesting allow-forms.
  return <section aria-label="Link a chat" className="inbox-discussion-form">
    <label htmlFor={linkId}>Chat link</label>
    <Input id={linkId} value={url} onChange={event=>setUrl(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void saveLink();}}} placeholder="https://chatgpt.com/c/…" autoComplete="off" maxLength={500} disabled={saving}/>
    <Button variant="outline" color="secondary" size="sm" onClick={()=>void saveLink()} disabled={!url.trim()||saving||disabled}>{saving?'Saving…':'Save link'}</Button>
    {error&&<p role="alert">{error}</p>}
  </section>;
}

const discussionLabels={ready:'Discuss in new chat',opening:'Opening chat…',opened:'Chat opened',uncertain:'Try opening chat again'};
export function DiscussTask({task,storeId,client,disabled,links,onSaved}:{task:Task;storeId:string;client:Client|null;disabled:boolean;links:DiscussionLink[];onSaved:(view:Result)=>void}) {
  const gate=useRef(false);
  const [openingLinks,setOpeningLinks]=useState<Set<string>>(()=>new Set());
  const [state,setState]=useState<'ready'|'opening'|'opened'|'uncertain'>('ready');
  const [editing,setEditing]=useState(false),[error,setError]=useState('');
  async function discuss() {
    if(gate.current||!client?.discuss)return;
    gate.current=true;setOpeningLinks(new Set(links.map(link=>link.url)));setState('opening');
    try {await client.discuss(task,storeId);setState('opened');}
    catch {setState('uncertain');gate.current=false;}
  }
  async function resume(link:DiscussionLink){
    try{await client?.open(link.url);setError('');}
    catch{setError('The linked chat could not be opened. Try again.');}
  }
  return <div className="inbox-discuss">
    {links.length>0&&<div aria-label="Linked conversations" className="inbox-discussion-links">
      <Button variant="outline" color="secondary" size="sm" disabled={disabled||!client} onClick={()=>void resume(links[0])}>Continue discussion</Button>
      {links.slice(1).map((link,index)=><Button key={link.url} color="secondary" variant="ghost" size="sm" disabled={disabled||!client} onClick={()=>void resume(link)}>Earlier discussion {index+1}</Button>)}
      <p className="inbox-muted">Saved with this item.</p>
    </div>}
    <div className="inbox-discussion-actions">
    <Button variant="outline" color="secondary" size="sm" disabled={disabled||!client?.discuss||state==='opening'||state==='opened'} onClick={()=>void discuss()}>
      {discussionLabels[state]}
    </Button>
    <Button variant="ghost" color="secondary" size="sm" disabled={disabled||!client} onClick={()=>setEditing(!editing)}>Link a chat</Button>
    </div>
    {editing&&client&&<ChatLinkForm taskId={task.id} storeId={storeId} client={client} disabled={disabled} onSaved={view=>{onSaved(view);setEditing(false);}}/>}
    {!client?.discuss&&<p className="inbox-muted">{client?.mode==='Local preview'?'Open Sauron in Codex to discuss this item.':'Update Codex to open discussions from Sauron.'}</p>}
    {state==='uncertain'&&<p role="alert">Sauron could not confirm whether the chat opened. Check your chats before trying again.</p>}
    {state==='opened'&&<p role="status">{links.some(link=>!openingLinks.has(link.url))?'This conversation is linked to the item.':'Opened in a new chat. Waiting for its saved link.'}</p>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
