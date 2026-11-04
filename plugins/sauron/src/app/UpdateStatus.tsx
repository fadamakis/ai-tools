import {defaultSourcePreferences,enabledSources,selectionMatches} from '../shared/contracts.js';
import React from 'react';
import type { Result } from '../shared/contracts.js';
import { UpdatedTime } from './UpdatedTime.js';

export function UpdateStatus({view}:{view:Result}) {
  const {sync,scan,coordination}=view;
  const preferences=view.sourcePreferences??defaultSourcePreferences();
  const off=(provider:string,source:{status:string},run:{enabledProviders?:string[]})=>source.status==='skipped'&&!(run.enabledProviders??enabledSources(preferences)).includes(provider);
  const paused=!enabledSources(preferences).length;
  const syncMatches=selectionMatches(sync,preferences),scanMatches=selectionMatches(scan,preferences);
  const selectedRun=coordination?.mode==='independent'?scan:sync;
  const selectionChanged=preferences.revision>0&&(!selectionMatches(selectedRun,preferences)||selectedRun?.status!=='completed');
  const automatic=coordination?.mode==='dot_managed'||coordination?.mode==='local_managed';
  const local=coordination?.mode==='local_managed';
  // A later full update supersedes an old manual failure, never a partial update.
  const superseded=!!(sync?.lastSuccessAt&&scan?.finishedAt
    &&syncMatches&&sync.lastSuccessAt>=scan.finishedAt);
  const manualWarning=!paused&&scanMatches&&scan&&!superseded&&(scan.status==='failed'||scan.status==='partial');
  const syncWarning=!paused&&syncMatches&&sync&&(sync.status==='failed'||sync.status==='partial');
  const lastUpdate=automatic?syncMatches?sync?.lastSuccessAt:null:scanMatches&&scan?.status==='completed'?scan.finishedAt:syncMatches?sync?.lastSuccessAt:null;
  const running=scan?.status==='running'||sync?.status==='running';
  const stale=!paused&&!selectionChanged&&automatic&&coordination.freshness.status==='stale';
  return <aside className="inbox-update" aria-label="Updates">
    <div className="inbox-update-summary">
      <span role="status">{paused?'Source updates paused':running?scan?.status==='running'?preferences.enabled.slack&&preferences.enabled.granola?'Checking Slack and Granola…':'Checking enabled manual sources…':'Checking your sources…'
        :selectionChanged?'Source selection changed; awaiting next update':lastUpdate?<>{automatic?'Last full update':'Last check'} <UpdatedTime value={lastUpdate}/></>
        :scan?.status==='completed'&&scan.finishedAt?<>Slack and Granola checked <UpdatedTime value={scan.finishedAt}/></>
        :automatic?'Waiting for the first automatic update.':'Refresh to check Slack and Granola.'}</span>
      <details><summary>Update details</summary><div className="inbox-update-details">
        <h2>{automatic?'Automatic updates':'Source checks'}</h2>
        <p>{preferences.revision>0?'Only enabled sources are pulled.':automatic?local?'This Mac checks Slack, meetings, Jira, GitHub and Calendar while available.':'Your dot checks Slack, meetings, Jira, GitHub and Calendar.':'Refresh checks Slack and Granola.'}</p>
        {automatic&&<p>Refresh checks Slack and Granola only.</p>}
        {local&&view.local&&<>
          {view.local.reason&&<p>{view.local.reason}</p>}
          {view.local.lastTickAt&&<p>Local coordinator last seen <UpdatedTime value={view.local.lastTickAt}/></p>}
          {view.local.nextAttemptAt&&<p>Next eligible check <UpdatedTime value={view.local.nextAttemptAt}/></p>}
          {view.local.checkpoints&&Object.entries(view.local.checkpoints).map(([provider,progress])=>progress&&<p key={provider}>{provider}: checked through <UpdatedTime value={progress.through}/>{progress.complete?'':' · Catch-up pending'}</p>)}
        </>}
        {sync&&<><h2>Latest automatic update</h2>
          <p>{sync.status==='completed'?'All enabled sources checked.':sync.status==='running'?'Update in progress.':sync.error||'Some sources were not checked.'}</p>
          {sync.finishedAt&&<p>Finished <UpdatedTime value={sync.finishedAt}/></p>}
          {sync.sources&&Object.entries(sync.sources).map(([provider,source])=><p key={provider}><strong>{({slack:'Slack',granola:'Meetings',jira:'Jira',github:'GitHub',calendar:'Calendar'} as Record<string,string>)[provider]} ({off(provider,source,sync)?'Off':source.status}):</strong> {off(provider,source,sync)?'Off':source.detail}</p>)}
        </>}
        {scan&&<><h2>Latest manual check</h2>
          <p>{scan.status==='completed'?'Enabled manual sources checked.':scan.status==='running'?'Check in progress.':scan.error||'Some sources were not checked.'}</p>
          {scan.finishedAt&&<p>Finished <UpdatedTime value={scan.finishedAt}/></p>}
          {superseded&&<p>A full automatic update completed after this check.</p>}
          {scan.sources&&Object.entries(scan.sources).map(([provider,source])=><p key={provider}><strong>{provider==='slack'?'Slack':'Meetings'} ({off(provider,source,scan)?'Off':source.status}):</strong> {off(provider,source,scan)?'Off':source.detail}</p>)}
        </>}
      </div></details>
    </div>
    {!paused&&!selectionChanged&&local&&view.local?.blocked&&<p role="status" className="inbox-update-warning">{view.local.reason||'Local update is waiting. Saved tasks are still available.'}</p>}
    {stale&&!running&&!syncWarning&&<p className="inbox-update-warning">Some updates may be missing. {coordination.freshness.businessHoursActive?'Your automatic update is overdue.':'Outside automatic update hours.'}</p>}
    {syncWarning&&<p role="alert" className="inbox-update-warning">{sync.status==='partial'?'Automatic update incomplete.':'Automatic update failed.'} {sync.error} Your saved tasks are still available. Check Update details for source coverage.</p>}
    {manualWarning&&<p role="alert" className="inbox-update-warning">Manual check: {scan.error||'Some sources were not checked.'} Use Refresh to try again.</p>}
  </aside>;
}
