import {Button,Menu} from '@ai-tools/ui';
import {defaultSourcePreferences,enabledSources,type LiveProvider} from '../shared/contracts.js';
import type {SauronController} from './controller.js';
import {Icon} from './icons.js';

const sources:{provider:LiveProvider;label:string}[]=[{provider:'slack',label:'Slack'},{provider:'jira',label:'Jira'},{provider:'github',label:'GitHub'},{provider:'calendar',label:'Calendar'},{provider:'granola',label:'Meetings (Granola)'}];
export function SourceControls({vm}:{vm:SauronController}) {
  const preferences=vm.view?.sourcePreferences??defaultSourcePreferences();
  const paused=!enabledSources(preferences).length;
  const locked=!vm.client||vm.busy||!!vm.pending||!!vm.view?.pendingSourceSync||vm.scanning;
  const canRefresh=!locked&&(preferences.enabled.slack||preferences.enabled.granola);
  return <Menu><Menu.Trigger><Button variant="outline" color="secondary" size="md" disabled={!vm.client} aria-busy={vm.scanning}>
    <Icon name="refresh" className={vm.scanning?'spinning':undefined}/>{vm.scanning?'Refreshing…':'Refresh'}<Icon name="chevron"/>
  </Button></Menu.Trigger><Menu.Content align="end" width={280} minWidth={280}>
    <Menu.Item disabled={!canRefresh} onSelect={vm.refresh}>Refresh now</Menu.Item>
    <p className="inbox-source-help">Checks enabled Slack and Meetings sources.</p>
    <Menu.Separator/>
    <p className="inbox-source-heading" id="input-sources-label">Input sources</p>
    <div role="group" aria-labelledby="input-sources-label">
      {sources.map(({provider,label})=><Menu.CheckboxItem key={provider} checked={preferences.enabled[provider]} disabled={locked} indicatorPosition="end" onSelect={event=>event.preventDefault()} onCheckedChange={enabled=>vm.saveSource(provider,enabled)}>{label}</Menu.CheckboxItem>)}
    </div>
    <p className="inbox-source-help">Controls manual and automatic pulls. Existing tasks stay saved.</p>
    {(vm.sourceSaving||vm.scanning||paused||vm.view?.pendingSourceSync)&&<p className="inbox-source-help" role="status">{vm.sourceSaving?'Saving source settings…':vm.scanning?'Available when this update finishes.':vm.view?.pendingSourceSync?'Waiting for pending update reconciliation.':'Source updates paused'}</p>}
    {vm.sourceError&&<div className="inbox-source-error" role="alert"><p>{vm.sourceError}</p><Button size="sm" variant="ghost" color="secondary" disabled={locked} onClick={vm.retrySource}>Retry source setting</Button></div>}
  </Menu.Content></Menu>;
}
