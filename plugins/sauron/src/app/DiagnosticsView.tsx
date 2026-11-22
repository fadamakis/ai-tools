import {useEffect,useState} from 'react';
import {Button} from '@ai-tools/ui';
import {diagnostics,diagnosticReport} from './diagnostics.js';
import type {SauronController} from './controller.js';
import {devBuildId} from '../shared/build-info.js';

const syncStatus={
  never:'No update recorded',running:'Checking sources',fresh:'Sources up to date',
  stale:'Update overdue',partial:'Update incomplete',failed:'Update failed',
};
const syncMode={independent:'Manual checks',dot_managed:'Managed by Dot',local_managed:'Managed by this Mac'};

export function DiagnosticsView({vm}:{vm:SauronController}){
  const [snapshot,setSnapshot]=useState(diagnostics.snapshot);
  const [notice,setNotice]=useState('');
  const [copyFailed,setCopyFailed]=useState(false);
  const coordination=vm.view?.coordination;
  const mode=coordination?.mode??'independent';
  const freshness=coordination?.freshness.status??'never';
  useEffect(()=>{
    const update=()=>setSnapshot(diagnostics.snapshot());
    window.addEventListener('sauron:diagnostics',update);
    return()=>window.removeEventListener('sauron:diagnostics',update);
  },[]);
  async function copy(){
    try{
      await navigator.clipboard.writeText(diagnosticReport(__SAURON_VERSION__,devBuildId??null));
      setCopyFailed(false);
      setNotice('Error details copied.');
    }catch{
      setCopyFailed(true);
      setNotice('Couldn’t copy error details. Select the diagnostic report below and copy it manually.');
    }
  }
  return <div className="inbox-diagnostics">
    <section className="inbox-diagnostics-overview" aria-labelledby="diagnostics-sync-heading">
      <div>
        <h3 id="diagnostics-sync-heading">Source updates</h3>
        <strong>{syncStatus[freshness]}</strong>
        <p>{syncMode[mode]}</p>
      </div>
      <Button size="sm" color="primary" onClick={()=>void copy()}>Copy error details</Button>
    </section>
    {notice&&<p role={copyFailed?'alert':'status'}>{notice}</p>}
    {copyFailed&&<textarea aria-label="Diagnostic report" readOnly value={diagnosticReport(__SAURON_VERSION__,devBuildId??null)} onFocus={event=>event.currentTarget.select()}/>}
    <section className="inbox-diagnostics-failures" aria-labelledby="diagnostics-failures-heading">
      <h3 id="diagnostics-failures-heading">Active failures</h3>
      {snapshot.active.length?<ul>{snapshot.active.map(event=><li key={event.action}>
        <strong>{event.action==='source_sync'?'Automatic source check':event.action==='source_check'?'Manual source check':event.action.replaceAll('_',' ')}</strong>
        <code>{event.category} · {event.outcome}</code>
      </li>)}</ul>:<p>No active failures recorded.</p>}
    </section>
    <div className="inbox-diagnostics-details">
      <details>
        <summary>Recent events ({snapshot.history.length})</summary>
        <p>History is kept for this panel session. Reports exclude task text and reply drafts.</p>
        <ol>{snapshot.history.slice().reverse().map((event,index)=><li key={index}>
          {event.lastAt}: {event.action}, {event.event}, {event.category}, {event.outcome}{event.reason!=='none'?`, ${event.reason}`:''}{event.count>1?` (${event.count} times)`:''}
        </li>)}</ol>
      </details>
      <details>
        <summary>Technical details</summary>
        <p>{vm.client?.mode??'Connecting'} · Local store</p>
        <dl>
          <dt>Version</dt><dd>{__SAURON_VERSION__}</dd>
          {devBuildId&&<><dt>Fixture build</dt><dd>{devBuildId}</dd></>}
          <dt>Update mode</dt><dd>{mode}</dd>
          <dt>Sync status</dt><dd>{freshness}</dd>
          <dt>Store ID</dt><dd>{vm.view?.storeId}</dd>
        </dl>
      </details>
      <details>
        <summary>Sample tasks</summary>
        <p>{devBuildId?'Refresh and replies use sample data.':'These controls create separate test records.'}</p>
        <div className="inbox-detail-actions">
          <Button size="sm" variant="outline" color="secondary" disabled={!vm.client||vm.actionLocked} onClick={vm.seed}>Create synthetic task</Button>
          <Button size="sm" variant="outline" color="secondary" disabled={!vm.client||vm.actionLocked} onClick={vm.replay}>Replay incoming update</Button>
        </div>
      </details>
    </div>
  </div>;
}
