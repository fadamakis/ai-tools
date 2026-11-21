import {Dialog} from './Dialog.js';
import {automaticCheckWarning,UpdateDetails} from './UpdateStatus.js';
import {RecoveryNotice} from './RecoveryNotice.js';
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
  const automaticWarning=automaticCheckWarning(vm.view);
  const locked=!vm.client||vm.actionLocked||!!vm.view?.pendingSourceSync||vm.scanning;
  const canRefresh=!locked&&(preferences.enabled.slack||preferences.enabled.granola);
  const [showDetails,setShowDetails]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null);
  return <><Menu onOpen={()=>vm.setSourceMenuOpen(true)} onClose={()=>vm.setSourceMenuOpen(false)}><Menu.Trigger><Button ref={trigger} variant="outline" color="secondary" size="md" disabled={!vm.client} aria-busy={vm.scanning}>
    <Icon name="refresh" className={vm.scanning?'spinning':undefined}/>{vm.scanning?'Refreshing…':'Refresh'}<Icon name="chevron"/>
  </Button></Menu.Trigger><Menu.Content align="end" width={280} minWidth={280}>
    <SourceHint hint="Checks enabled Slack and Meetings sources now. New actions appear in Inbox for review.">
      <Menu.Item disabled={!canRefresh} onSelect={vm.refresh}>Refresh now</Menu.Item>
    </SourceHint>
    <Menu.Item disabled={!vm.view} onSelect={()=>setShowDetails(true)}>Update details</Menu.Item>
    {automaticWarning&&<p className="inbox-source-help">{automaticWarning}</p>}
    <Menu.Separator/>
    <p className="inbox-source-heading" id="input-sources-label">Input sources</p>
    <div role="group" aria-labelledby="input-sources-label">
      {sources.map(({provider,label,hint})=><SourceHint key={provider} hint={hint}><Menu.CheckboxItem checked={preferences.enabled[provider]} disabled={locked} indicatorPosition="end" onSelect={event=>event.preventDefault()} onCheckedChange={enabled=>vm.saveSource(provider,enabled)}>{label}</Menu.CheckboxItem></SourceHint>)}
    </div>
    {(vm.sourceSaving||vm.scanning||paused||vm.view?.pendingSourceSync)&&<p className="inbox-source-help" role="status">{vm.sourceSaving?'Saving source settings…':vm.scanning?'Available when this update finishes.':vm.view?.pendingSourceSync?'Finishing the previous update.':'Source updates paused'}</p>}
    <RecoveryNotice recovery={vm.sourceRecovery} busy={vm.busy} connected={!!vm.client}/>

  </Menu.Content></Menu>
    {showDetails&&vm.view&&<Dialog title="Update details" close={()=>{setShowDetails(false);requestAnimationFrame(()=>trigger.current?.focus());}}>
      <UpdateDetails view={vm.view}/>
    </Dialog>}
  </>;
}
