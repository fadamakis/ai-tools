import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Button,Menu} from '@ai-tools/ui';
import {defaultSourcePreferences,enabledSources,type LiveProvider} from '../shared/contracts.js';
import type {SauronController} from './controller.js';
import {Icon} from './icons.js';

const sources:{provider:LiveProvider;label:string;hint:string}[]=[
  {provider:'slack',label:'Slack',hint:'Finds requests to you, unanswered DMs, and commitments you made in Slack.'},
  {provider:'jira',label:'Jira',hint:'Finds issues with a current action personally assigned to you. Checked by automatic or chat updates.'},
  {provider:'github',label:'GitHub',hint:'Finds issues and pull requests where you owe a review or action. Checked by automatic or chat updates.'},
  {provider:'calendar',label:'Calendar',hint:'Finds explicit preparation or follow-up for upcoming events. Checked by automatic or chat updates.'},
  {provider:'granola',label:'Meetings (Granola)',hint:'Finds actions assigned to you or commitments you made in recent work meeting notes.'},
];
function SourceHint({hint,children}:{hint:string;children:ReactNode}) {
  const wrapper=useRef<HTMLDivElement>(null);
  const [hovered,setHovered]=useState(false);
  const [focused,setFocused]=useState(false);
  const [position,setPosition]=useState<{left:number;top:number;width:number}|null>(null);
  const open=hovered||focused;
  useEffect(()=>{
    const item=wrapper.current?.querySelector('[role^="menuitem"]');
    item?.setAttribute('aria-description',hint);
    return()=>item?.removeAttribute('aria-description');
  },[hint]);
  useEffect(()=>{
    if(!open)return;
    const place=()=>{
      const item=wrapper.current;
      if(!item)return;
      const row=item.getBoundingClientRect(),width=Math.min(260,window.innerWidth-24);
      const menu=item.closest('[role="menu"]')?.getBoundingClientRect();
      const left=row.left-width-8>=12?row.left-width-8:Math.max(12,Math.min(row.right-width,window.innerWidth-width-12));
      const below=window.innerWidth<600&&menu?menu.bottom+8:row.bottom+8;
      const top=below+110<=window.innerHeight?below:Math.max(12,(window.innerWidth<600&&menu?menu.top:row.top)-118);
      setPosition({left,top,width});
    };
    place();window.addEventListener('resize',place);
    return()=>window.removeEventListener('resize',place);
  },[open]);
  return <div ref={wrapper} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={()=>setFocused(false)}>
    {children}
    {open&&position&&createPortal(<div role="tooltip" className="inbox-source-tooltip" style={position}>{hint}</div>,document.body)}
  </div>;
}
export function SourceControls({vm}:{vm:SauronController}) {
  const preferences=vm.view?.sourcePreferences??defaultSourcePreferences();
  const paused=!enabledSources(preferences).length;
  const locked=!vm.client||vm.busy||!!vm.pending||!!vm.view?.pendingSourceSync||vm.scanning;
  const canRefresh=!locked&&(preferences.enabled.slack||preferences.enabled.granola);
  return <Menu><Menu.Trigger><Button variant="outline" color="secondary" size="md" disabled={!vm.client} aria-busy={vm.scanning}>
    <Icon name="refresh" className={vm.scanning?'spinning':undefined}/>{vm.scanning?'Refreshing…':'Refresh'}<Icon name="chevron"/>
  </Button></Menu.Trigger><Menu.Content align="end" width={280} minWidth={280}>
    <SourceHint hint="Checks enabled Slack and Meetings sources now. New actions appear in Inbox for review.">
      <Menu.Item disabled={!canRefresh} onSelect={vm.refresh}>Refresh now</Menu.Item>
    </SourceHint>
    <p className="inbox-source-help">Checks enabled Slack and Meetings sources.</p>
    <Menu.Separator/>
    <p className="inbox-source-heading" id="input-sources-label">Input sources</p>
    <div role="group" aria-labelledby="input-sources-label">
      {sources.map(({provider,label,hint})=><SourceHint key={provider} hint={hint}><Menu.CheckboxItem checked={preferences.enabled[provider]} disabled={locked} indicatorPosition="end" onSelect={event=>event.preventDefault()} onCheckedChange={enabled=>vm.saveSource(provider,enabled)}>{label}</Menu.CheckboxItem></SourceHint>)}
    </div>
    <p className="inbox-source-help">Controls manual and automatic pulls. Existing tasks stay saved.</p>
    {(vm.sourceSaving||vm.scanning||paused||vm.view?.pendingSourceSync)&&<p className="inbox-source-help" role="status">{vm.sourceSaving?'Saving source settings…':vm.scanning?'Available when this update finishes.':vm.view?.pendingSourceSync?'Waiting for pending update reconciliation.':'Source updates paused'}</p>}
    {vm.sourceError&&<div className="inbox-source-error" role="alert"><p>{vm.sourceError}</p><Button size="sm" variant="ghost" color="secondary" disabled={locked} onClick={vm.retrySource}>Retry source setting</Button></div>}
  </Menu.Content></Menu>;
}
