import {defaultSourcePreferences,enabledSources,selectionMatches} from '../shared/contracts.js';
import React,{useEffect} from 'react';
import {diagnostics,correlation} from './diagnostics.js';
import type { Result } from '../shared/contracts.js';
import { UpdatedTime } from './UpdatedTime.js';

const sourceNames: Record<string,string>={slack:'Slack',granola:'Meetings',jira:'Jira',github:'GitHub',calendar:'Calendar'};

function failedSources(sources:Record<string,{status:string}>|null|undefined) {
  return sources ? Object.entries(sources)
    .filter(([,source])=>source.status==='failed')
    .map(([provider])=>sourceNames[provider]??provider)
    .join(', ') : '';
}

export function automaticCheckWarning(view:Result|null|undefined) {
  const sync=view?.sync;
  if(!sync||(sync.status!=='failed'&&sync.status!=='partial'))return null;
  const preferences=view?.sourcePreferences??defaultSourcePreferences();
  if(!enabledSources(preferences).length||!selectionMatches(sync,preferences))return null;
  const failed=failedSources(sync.sources);
  return `Automatic check: ${failed?`Couldn’t check ${failed}.`:sync.status==='partial'?'Some sources were not checked.':'Check failed.'}`;
}

export function UpdateStatus({view}:{view:Result}) {
  const {sync,scan,coordination}=view;
  const preferences=view.sourcePreferences??defaultSourcePreferences();
  const paused=!enabledSources(preferences).length;
  const syncMatches=selectionMatches(sync,preferences),scanMatches=selectionMatches(scan,preferences);
  const selectedRun=coordination?.mode==='independent'?scan:sync;
  const selectionChanged=preferences.revision>0&&(!selectionMatches(selectedRun,preferences)||selectedRun?.status!=='completed');
  const automatic=coordination?.mode==='dot_managed'||coordination?.mode==='local_managed';
  const local=coordination?.mode==='local_managed';
  const superseded=manualCheckSuperseded(view);
  const manualWarning=!paused&&scanMatches&&scan&&!superseded&&(scan.status==='failed'||scan.status==='partial');
  const failedManualSources=manualWarning?failedSources(scan.sources):'';
  const lastUpdate=automatic?syncMatches?sync?.lastSuccessAt:null:scanMatches&&scan?.status==='completed'?scan.finishedAt:syncMatches?sync?.lastSuccessAt:null;
  const running=scan?.status==='running'||sync?.status==='running';
  const stale=!paused&&!selectionChanged&&!running&&!automaticCheckWarning(view)&&automatic&&coordination.freshness.status==='stale';
  const summary=paused?'Source updates paused':running?scan?.status==='running'?preferences.enabled.slack&&preferences.enabled.granola?'Checking Slack and Granola…':'Checking enabled manual sources…':'Checking your sources…'
    :selectionChanged?'Source selection changed; awaiting next update':lastUpdate?<>{automatic?'Last full update':'Last check'} <UpdatedTime value={lastUpdate}/></>
    :scan?.status==='completed'&&scan.finishedAt?<>Slack and Granola checked <UpdatedTime value={scan.finishedAt}/></>
    :null;
  useEffect(()=>{for(const [kind,run] of [['manual',scan],['automatic',sync]] as const){if(!run)continue;const action=kind==='manual'?'source_check':'source_sync';if(run.status==='failed'||run.status==='partial')diagnostics.record(action,'failed',correlation(kind+':'+run.id),'unknown','unconfirmed');else if(run.status==='completed')diagnostics.record(action,'saved',correlation(kind+':'+run.id),'unknown','saved');}},[scan?.id,scan?.status,sync?.id,sync?.status]);
  if(!summary&&!stale&&!manualWarning&&!(local&&view.local?.blocked&&!paused&&!selectionChanged))return null;
  return <aside className="inbox-update" aria-label="Updates">
    {summary&&<span role="status">{summary}</span>}
    {!paused&&!selectionChanged&&local&&view.local?.blocked&&<p role="status" className="inbox-update-warning">{view.local.reason||'Local update is waiting. Saved tasks are still available.'}</p>}
    {stale&&<p className="inbox-update-warning">Some updates may be missing. {coordination.freshness.businessHoursActive?'Your automatic update is overdue.':'Outside automatic update hours.'}</p>}
    {manualWarning&&<p role="alert" className="inbox-update-warning">Manual check: {failedManualSources?`Couldn’t check ${failedManualSources}.`:scan.status==='partial'?'Some sources were not checked.':'Sources could not be checked.'} Use Refresh to try again.</p>}
  </aside>;
}


function manualCheckSuperseded({sync,scan,sourcePreferences}:Result) {
  // A later full update supersedes an old manual failure, never a partial update.
  return !!(sync?.lastSuccessAt&&scan?.finishedAt&&selectionMatches(sync,sourcePreferences??defaultSourcePreferences())&&sync.lastSuccessAt>=scan.finishedAt);
}

export function UpdateDetails({view}:{view:Result}) {
  const {sync,scan,coordination}=view;
  const preferences=view.sourcePreferences??defaultSourcePreferences();
  const local=coordination?.mode==='local_managed';
  const automatic=local||coordination?.mode==='dot_managed';
  const superseded=manualCheckSuperseded(view);
  const off=(provider:string,source:{status:string},run:{enabledProviders?:string[]})=>source.status==='skipped'&&!(run.enabledProviders??enabledSources(preferences)).includes(provider);
  return <div className="inbox-update-details">
        <h2>{automatic?'Automatic updates':'Source checks'}</h2>
        <p>{preferences.revision>0?'Only enabled sources are pulled.':automatic?local?'This Mac checks Slack, meetings, Jira, GitHub and Calendar while available.':'Your dot checks Slack, meetings, Jira, GitHub and Calendar.':'Refresh checks Slack and Granola.'}</p>
        {automatic&&<p>Refresh now checks Slack and Meetings (Granola).</p>}
        {local&&view.local&&<>
          {view.local.reason&&<p>{view.local.reason}</p>}
          {view.local.lastTickAt&&<p>Local coordinator last seen <UpdatedTime value={view.local.lastTickAt}/></p>}
          {view.local.nextAttemptAt&&<p>Next eligible check <UpdatedTime value={view.local.nextAttemptAt}/></p>}
          {view.local.checkpoints&&Object.entries(view.local.checkpoints).map(([provider,progress])=>progress&&<p key={provider}>{provider}: checked through <UpdatedTime value={progress.through}/>{progress.complete?'':' · Catch-up pending'}</p>)}
        </>}
        {sync&&<><h2>Latest automatic update</h2>
          <p>{sync.status==='completed'?'All enabled sources checked.':sync.status==='running'?'Update in progress.':sync.error||'Some sources were not checked.'}</p>
          {sync.finishedAt&&<p>Finished <UpdatedTime value={sync.finishedAt}/></p>}
          {sync.sources&&Object.entries(sync.sources).map(([provider,source])=><p key={provider}><strong>{sourceNames[provider]} ({off(provider,source,sync)?'Off':source.status}):</strong> {off(provider,source,sync)?'Off':source.detail}</p>)}
        </>}
        {scan&&<><h2>Latest manual check</h2>
          <p>{scan.status==='completed'?'Enabled manual sources checked.':scan.status==='running'?'Check in progress.':scan.error||'Some sources were not checked.'}</p>
          {scan.finishedAt&&<p>Finished <UpdatedTime value={scan.finishedAt}/></p>}
          {superseded&&<p>A full automatic update completed after this check.</p>}
          {scan.sources&&Object.entries(scan.sources).map(([provider,source])=><p key={provider}><strong>{sourceNames[provider]} ({off(provider,source,scan)?'Off':source.status}):</strong> {off(provider,source,scan)?'Off':source.detail}</p>)}
        </>}
      </div>;
}
