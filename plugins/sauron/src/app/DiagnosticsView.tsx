import {useEffect,useState} from 'react';
import {Button} from '@ai-tools/ui';
import {diagnostics,diagnosticReport} from './diagnostics.js';
import {devBuildId} from '../shared/build-info.js';
export function DiagnosticsView(){
  const [snapshot,setSnapshot]=useState(diagnostics.snapshot);
  const [notice,setNotice]=useState('');
  const [copyFailed,setCopyFailed]=useState(false);
  useEffect(()=>{const update=()=>setSnapshot(diagnostics.snapshot());window.addEventListener('sauron:diagnostics',update);return()=>window.removeEventListener('sauron:diagnostics',update);},[]);
  async function copy(){try{await navigator.clipboard.writeText(diagnosticReport(__SAURON_VERSION__,devBuildId??null));setCopyFailed(false);setNotice('Error details copied.');}catch{setCopyFailed(true);setNotice('Couldn’t copy error details. Select the diagnostic report below and copy it manually.');}}
  return <section aria-label="Error diagnostics"><h3>Error details</h3><p>Local to this panel session. History may disappear when the panel closes or Codex restarts. Task text and reply drafts are excluded.</p>
    <Button size="sm" color="secondary" variant="outline" onClick={()=>void copy()}>Copy error details</Button>
    {notice&&<p role={copyFailed?'alert':'status'}>{notice}</p>}
    {copyFailed&&<textarea aria-label="Diagnostic report" readOnly value={diagnosticReport(__SAURON_VERSION__,devBuildId??null)} onFocus={event=>event.currentTarget.select()}/>}
    <h4>Active failures</h4>{snapshot.active.length?<ul>{snapshot.active.map(event=><li key={event.action}>{event.action}: {event.category} ({event.outcome})</li>)}</ul>:<p>No active failures recorded.</p>}
    <details><summary>Recent events ({snapshot.history.length})</summary><ol>{snapshot.history.slice().reverse().map((event,index)=><li key={index}>{event.lastAt}: {event.action}, {event.event}, {event.category}, {event.outcome}{event.reason!=='none'?`, ${event.reason}`:''}{event.count>1?` (${event.count} times)`:''}</li>)}</ol></details>
  </section>;
}
