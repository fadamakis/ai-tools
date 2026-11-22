import {diagnostics,correlation} from './diagnostics.js';
import {useRecovery,type Run} from './useRecovery.js';
import {reviewTriggerSchema,configureReviewSchema,acceptProposalSchema} from '../shared/review-contracts.js';
import {z} from 'zod';
import {useEffect,useState} from 'react';
import {Button,Checkbox} from '@ai-tools/ui';
import type {Client} from './client.js';
import type {Result} from '../shared/contracts.js';
import type {ProposalChange,ReviewProposal} from '../shared/review-contracts.js';
import type {SauronController} from './controller.js';
import {operationId} from './operation.js';
import {devBuildId} from '../shared/build-info.js';

type Pending={tool:string;args:Record<string,unknown>;storeId:string};
const pendingKey='sauron:review-pending:v1';
const rebaseSchema=z.strictObject({operationId:z.string().uuid(),expectedStoreId:z.string().uuid(),proposalId:z.string().uuid(),expectedProposalRevision:z.number().int().nonnegative()});
const reviewSchemas={review_organisation:reviewTriggerSchema,configure_organisation_review:configureReviewSchema,accept_organisation_proposal:acceptProposalSchema,rebase_organisation_proposal:rebaseSchema};
export function useOrganisationReview(view:Result|null,client:Client|null,run:Run,apply:(view:Result)=>void){
  const recovery=useRecovery<Pending>({key:pendingKey,action:'review',view,client,run,
    parse:value=>{const saved=value as Pending;const schema=reviewSchemas[saved.tool as keyof typeof reviewSchemas];if(!schema)throw Error('invalid');return {tool:saved.tool,storeId:z.string().uuid().parse(saved.storeId),args:schema.parse(saved.args)};},
    store:value=>value.storeId,label:value=>value.tool==='configure_organisation_review'?'the daily review setting':value.tool==='accept_organisation_proposal'?'the selected task suggestions':value.tool==='rebase_organisation_proposal'?'the refreshed task suggestions':'the chat review',execute:(client,value)=>client.call(value.tool,value.args),
    prepare:(value,latest)=>{
      const state=latest.organisationReview;if(!state)return null;
      if(value.tool==='accept_organisation_proposal'&&(!state.proposal||state.proposal.id!==value.args.proposalId||state.proposal.revision!==value.args.expectedProposalRevision||state.proposal.taskViewRevision!==latest.taskViewRevision))return null;
      return {...value,args:{...value.args,...('operationId' in value.args?{operationId:operationId()}:{}),...('expectedRevision' in value.args?{expectedRevision:latest.taskViewRevision}:{}),...('expectedReviewRevision' in value.args?{expectedReviewRevision:state.revision}:{})}};
    },
    summary:value=>value.tool==='configure_organisation_review'?`Intended change: turn daily task review ${value.args.enabled?'on':'off'}.`:value.tool==='accept_organisation_proposal'?`Apply the selected suggestions: ${(value.args.changes as ProposalChange[]).map(change=>change.kind+': '+('title' in change?change.title:change.taskRef)).join('; ')}.`:'Run the previously requested task review action.'});
  const pending=recovery.pending;
  const call=(tool:string,args:Record<string,unknown>)=>view?recovery.submit({tool,args,storeId:view.storeId}):Promise.resolve(undefined);
  const savedRun=view?.organisationReview?.run;
  useEffect(()=>{if(!savedRun)return;const id=correlation('review-run:'+savedRun.id);if(savedRun.status==='failed'||savedRun.status==='partial')diagnostics.record('review_run','failed',id,'unknown','unconfirmed');else if(savedRun.status==='completed')diagnostics.record('review_run','saved',id,'unknown','saved');},[savedRun?.id,savedRun?.status]);
  const busy=savedRun?.status==='running';
  useEffect(()=>{
    if(!busy||!client)return;let active=true,loading=false;
    const timer=window.setInterval(async()=>{if(loading)return;loading=true;try{const saved=await client.call('list_attention');if(active)apply(saved);}catch{}finally{loading=false;}},1500);
    return()=>{active=false;window.clearInterval(timer);};
  },[busy,client]);
  return {pending,busy,call,recovery,cancel:recovery.dismiss,retry:recovery.retry};
}
export function OrganisationReview({vm}:{vm:SauronController}){
  const state=vm.view?.organisationReview,review=vm.review;
  if(!state)return null;
  const disabled=vm.actionLocked||!!vm.organisation.pending||!!review.pending||review.busy;
  const origin=state.proposal?.status==='pending'?(state.proposal.origin??state.run?.origin):state.run?.origin;
  const liveDev=!!devBuildId&&origin==='local_history'&&(state.run?.status!=='completed'||state.proposal?.status==='pending');
  const reviewDisabled=disabled||liveDev;
  const start=(kind:'probe'|'bootstrap'|'daily')=>void review.call('review_organisation',{expectedStoreId:vm.view!.storeId,kind});
  return <div className="inbox-organisation-review">
    {state.capability.status!=='unknown'&&<p className="inbox-muted">{state.capability.detail}</p>}
    {(origin||devBuildId)&&<p>{origin==='local_history'?'Real local-history review.':'Simulated chat review.'}</p>}
    {devBuildId&&<p>Panel reviews use simulated chats. For real local history, run <code>pnpm sauron:dev:bootstrap</code>.{liveDev?' Resume that command or review its saved proposal before starting a simulated review.':''}</p>}
    <div className="inbox-review-actions">
      <Button color="secondary" size="sm" variant="ghost" disabled={reviewDisabled} onClick={()=>start('probe')}>Check chat access</Button>
      <Button color="secondary" size="sm" variant="ghost" disabled={reviewDisabled} onClick={()=>start('bootstrap')}>Review last 14 days</Button>
      <Button color="secondary" size="sm" variant="ghost" disabled={reviewDisabled} onClick={()=>start('daily')}>Review changed chats</Button>
    </div>
    <div className="inbox-review-schedule">
      <span className="inbox-muted">{devBuildId?'Daily review unavailable in Sauron Dev':state.enabled?'Daily review runs at 07:00 Europe/Berlin':'Daily review off'} · Local Codex chats only</span>
      <Button color="secondary" size="sm" variant="ghost" disabled={!!devBuildId||disabled||(!state.enabled&&state.capability.status!=='verified')} onClick={()=>void review.call('configure_organisation_review',{operationId:operationId(),expectedStoreId:vm.view!.storeId,expectedReviewRevision:state.revision,enabled:!state.enabled})}>{state.enabled?'Disable daily review':'Enable daily review at 07:00'}</Button>
    </div>
    {state.run&&<p role="status">{review.busy?'Review running. Progress is saved.':state.run.status==='partial'?'Review has incomplete coverage. Resume to retry missing reads.':state.run.status==='failed'?'Review interrupted. Resume from saved progress.':'Review complete.'}</p>}
    {!!state.run?.errors.length&&<><p role="alert">Some chats could not be reviewed. Existing tasks are unchanged by these suggestions. Run the review again to continue.</p><details><summary>Review details</summary><ul>{state.run.errors.map((error,i)=><li key={i}>{error}</li>)}</ul></details></>}
    {state.proposal?.status==='pending'&&!review.busy&&<ProposalEditor key={state.proposal.id} proposal={state.proposal} vm={vm}/>}

  </div>;
}
function ProposalEditor({proposal,vm}:{proposal:ReviewProposal;vm:SauronController}){
  const draftKey='sauron:proposal-draft:'+proposal.id;
  const load=()=>{try{const saved=JSON.parse(sessionStorage.getItem(draftKey)??'null');if(saved?.revision===proposal.revision)return saved as {revision:number;changes:ProposalChange[];selected:string[]};}catch{}return {revision:proposal.revision,changes:proposal.changes,selected:proposal.changes.map(change=>change.key)};};
  const [draft,setDraft]=useState(load);
  useEffect(()=>{try{sessionStorage.setItem(draftKey,JSON.stringify(draft));}catch{}},[draft]);
  const selected=new Set(draft.selected),stale=draft.revision!==proposal.revision||proposal.taskViewRevision!==vm.view?.taskViewRevision;
  const references=new Set([...(vm.view?.items??[]).map(task=>task.id),...draft.changes.filter(change=>selected.has(change.key)&&(change.kind==='create'||change.kind==='track')).map(change=>change.key)]);
  const dependency=draft.changes.filter(change=>selected.has(change.key)).some(change=>('parentRef' in change&&change.parentRef&&!references.has(change.parentRef))||('taskRef' in change&&!references.has(change.taskRef)));
  const disabled=vm.actionLocked;
  const edit=(key:string,patch:Record<string,unknown>)=>setDraft(old=>({...old,changes:old.changes.map(change=>change.key===key?{...change,...patch} as ProposalChange:change)}));
  const name=(ref:string)=>{const change=draft.changes.find(change=>change.key===ref);return (vm.view?.items??[]).find(task=>task.id===ref)?.title??(change&&'title' in change?change.title:ref);};
  const accept=()=>void vm.review.call('accept_organisation_proposal',{operationId:operationId(),expectedStoreId:vm.view!.storeId,expectedRevision:vm.view!.taskViewRevision,proposalId:proposal.id,expectedProposalRevision:proposal.revision,changes:draft.changes.filter(change=>selected.has(change.key))});
  return <section className="inbox-proposal" aria-label="Organisation proposal"><h3>Review proposed changes</h3><p>Selected changes apply together. Closing work is an explicit decision here.</p>
    {proposal.coverage.map((detail,i)=><p key={i} className="inbox-muted">{detail}</p>)}
    {stale&&<div role="alert"><p>Tasks or this proposal changed. Review the latest state before accepting.</p><Button color="secondary" size="sm" disabled={disabled} onClick={()=>void vm.review.call('rebase_organisation_proposal',{operationId:operationId(),expectedStoreId:vm.view!.storeId,proposalId:proposal.id,expectedProposalRevision:proposal.revision}).then(saved=>{const latest=saved?.organisationReview?.proposal;if(latest)setDraft(old=>({revision:latest.revision,changes:latest.changes.map(change=>old.changes.find(previous=>previous.key===change.key)??change),selected:old.selected.filter(key=>latest.changes.some(change=>change.key===key))}));})}>Load latest proposal</Button></div>}
    {draft.changes.map(change=><fieldset key={change.key} disabled={disabled}><legend><Checkbox disabled={disabled} checked={selected.has(change.key)} onCheckedChange={checked=>setDraft(old=>({...old,selected:checked?[...old.selected,change.key]:old.selected.filter(key=>key!==change.key)}))} label={<>{change.kind==='create'?'Create parent':change.kind==='track'?'Track chat':change.kind==='move'?'Move task':change.kind==='topics'?'Assign topics':'Close branch'}: {'title' in change?change.title:name(change.taskRef)}</>}/></legend><p>{change.reason}</p>{'taskRef' in change&&vm.organisation.tree.byId.has(change.taskRef)&&<p>Current: {vm.organisation.tree.byId.get(change.taskRef)?.state} · {vm.organisation.tree.byId.get(change.taskRef)?.nextAction}</p>}{change.kind==='move'&&change.parentRef&&vm.organisation.tree.byId.get(change.taskRef)?.focusOrder&&<p>This removes its Top 3 slot. The destination’s priority stays unchanged.</p>}
      {change.kind==='create'&&<label>Parent name<input value={change.title} maxLength={160} onChange={event=>edit(change.key,{title:event.target.value})}/></label>}
      {(change.kind==='move'||change.kind==='track')&&<label>Destination for {'title' in change?change.title:name(change.taskRef)}<select value={change.parentRef??''} onChange={event=>edit(change.key,{parentRef:event.target.value||null})}><option value="">Top level</option>{(vm.view?.items??[]).filter(task=>task.state!=='done'&&task.state!=='dismissed').map(task=><option key={task.id} value={task.id}>{task.title}</option>)}{draft.changes.filter(item=>item.key!==change.key&&(item.kind==='create'||item.kind==='track')).map(item=><option key={item.key} value={item.key} disabled={!selected.has(item.key)}>{'title' in item?item.title:item.key}</option>)}</select></label>}
      {change.kind==='topics'&&<label>Topics for {name(change.taskRef)}<input value={change.topics.join(', ')} onChange={event=>edit(change.key,{topics:event.target.value.split(',').map(name=>name.trim()).filter(Boolean)})}/></label>}
      {change.kind==='close'&&<details><summary>{proposal.closureScopes[change.key]?.length??1} {(proposal.closureScopes[change.key]?.length??1)===1?'task':'tasks'} will close</summary><ul>{(proposal.closureScopes[change.key]??[change.taskRef]).map(id=><li key={id}>{name(id)}</li>)}</ul></details>}
    </fieldset>)}
    {dependency&&<p role="alert">A selected change needs an excluded parent or task. Include it or choose another destination.</p>}
    <Button color="primary" size="sm" disabled={disabled||stale||dependency} onClick={accept}>{selected.size?`Accept ${selected.size} selected ${selected.size===1?'change':'changes'}`:'Dismiss all suggestions'}</Button>
  </section>;
}
