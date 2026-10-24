import React, { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Button, Secondary, Quiet, Menu, Icon } from './ui.jsx';
import { RulesView, RuleEditor } from './Rules.jsx';
import { NewReview, ReviewSettings, PostReview, RerunReview } from './Modals.jsx';
import { ReportView } from './Report.jsx';
import { groupReviews, stateLabels, recoveryMessage } from './model.mjs';
import logo from '../assets/logo.png';

function HistoryRow({run,vm}){
  const decision=run.decision,selected=vm.selected?.run.id===run.id;
  return <button className="review-queue-row" data-run={run.id} aria-current={selected?'true':undefined} onClick={()=>vm.action(()=>vm.loadRun(run.id))} disabled={vm.busy}>
    <span className={`history-state ${decision?.state||run.verdict?.state||run.state}`} aria-hidden="true"/>
    <span className="queue-main"><strong>{run.source?.title||run.title}</strong><span className="queue-title">{run.title}</span>{run.source?.requester?.name&&<span className="queue-title">Requested by {run.source.requester.name}</span>}<span className="queue-outcome">{run.source?.kind==='local'&&decision?.state==='ready'?'Review complete':decision?.label||run.execution?.label||stateLabels[run.state]}</span>{decision?.comments.required>0&&<small>{decision.comments.required} blocking</small>}</span>
    <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</time>
  </button>;
}
function ReviewRail({vm}){
  const ref=useRef(null);
  useLayoutEffect(()=>{ref.current.scrollTop=vm.historyScroll;},[vm]);
  useLayoutEffect(()=>{
    if(!vm.readingReview&&window.matchMedia('(max-width: 959px)').matches&&vm.selected){
      ref.current.querySelector(`[data-run="${vm.selected.run.id}"]`)?.focus({preventScroll:true});
    }
  },[vm,vm.readingReview,vm.selected?.run.id,vm.busy]);
  return <aside className="review-rail" aria-label="Saved reviews"><div className="rail-heading"><h1>Your reviews</h1><span className="muted">{groupReviews(vm.reviews).length}</span></div><div className="history" ref={ref} onScroll={event=>{vm.historyScroll=event.currentTarget.scrollTop;}}>
    {vm.reviews.length?<ul>{groupReviews(vm.reviews).map(([latest,...previous])=><li key={latest.reviewKey||latest.source?.url||latest.id}><HistoryRow run={latest} vm={vm}/>{previous.length>0&&<details className="previous-reviews" open={previous.some(run=>run.id===vm.selected?.run.id)||undefined}><summary>{previous.length} previous attempt{previous.length===1?'':'s'}</summary>{previous.map(run=><HistoryRow key={run.id} run={run} vm={vm}/>)}</details>}</li>)}</ul>:<div className="history-empty"><Icon name="check"/><h2>{vm.connected?'No reviews yet':'Loading reviews…'}</h2><p>Start a review to see it here.</p></div>}
    {vm.entrypoint==='thread'&&<p className="local-context">New review also supports this conversation’s local changes.</p>}</div></aside>;
}
function SelectedReview({vm}){
  const {run,report,publishing={}}=vm.selected,failed=['failed','interrupted'].includes(run.state);
  const canPost=run.state==='complete'&&run.source.kind==='github_pr'&&report?.freshness?.status==='current';
  if(report)return <ReportView key={`${run.id}:${report.snapshot.id}`} run={run} autoApproval={vm.selected.autoApproval} report={report} runState={run.state} embedded canPostComments={canPost} publishing={publishing} busy={vm.busy} session={vm.session()} canRewrite={Boolean(vm.extensions.message)} canContinue={Boolean(vm.extensions.message)} onContinue={()=>vm.action(()=>vm.launch())} onBack={()=>vm.action(()=>vm.home())} onPostReview={(event,comments)=>vm.action(()=>vm.prepareReview(event,comments))} onDiscussed={(id,value)=>vm.action(()=>vm.discuss(id,value))} onRewrite={value=>vm.action(()=>vm.rewrite(value))} onSettings={()=>vm.action(()=>vm.settings())}/>;
  return <main className="review-placeholder"><Quiet id="back-reviews" className="back-reviews" onClick={()=>vm.action(()=>vm.home())}><Icon name="back"/>Back to reviews</Quiet><div><h1>{stateLabels[run.state]}</h1><p role={failed?'alert':undefined}>{failed?recoveryMessage(run):'Reading the selected changes. Your review list stays available.'}</p>{failed&&vm.extensions.message&&<Button id="retry-review" disabled={vm.busy} onClick={()=>vm.rerun()}>Retry review…</Button>}{failed&&<details><summary>Technical details</summary><pre>{run.error||'Preparation interrupted.'}</pre></details>}</div></main>;
}
function HeaderActions({vm}){
  const isReport=vm.page!=='rules'&&!!vm.selected;
  return <div className="header-actions"><Secondary id="new-review" disabled={!vm.connected||vm.busy} onClick={()=>vm.newReview()}><Icon name="plus"/>New review</Secondary><Quiet uniform id={isReport?'refresh':'refresh-history'} aria-label={vm.busy?'Refreshing':'Refresh'} disabled={vm.busy||!vm.connected} onClick={()=>vm.action(()=>vm.page==='rules'?vm.rules():vm.selected?vm.loadRun(vm.selected.run.id,{open:false}):vm.home())}><Icon name="refresh" className={vm.busy?'spinning':undefined}/></Quiet><Menu><Menu.Trigger><Quiet uniform aria-label="More options" disabled={vm.busy||!vm.connected}><span aria-hidden="true">⋯</span></Quiet></Menu.Trigger><Menu.Content align="end" minWidth={180}><Menu.Item id="settings-nav" onSelect={()=>vm.action(()=>vm.settings())}>Settings</Menu.Item><Menu.Item id="rules-nav" onSelect={()=>vm.action(()=>vm.rules())}>Rules</Menu.Item>{isReport&&vm.extensions.message&&<Menu.Item id="continue" onSelect={()=>vm.rerun()}>Rerun review…</Menu.Item>}{isReport&&vm.selected.outputs&&vm.extensions.files&&<Menu.Item id="open-report" onSelect={()=>vm.action(()=>vm.extensions.files.open(vm.selected.outputs.html))}>Open HTML</Menu.Item>}</Menu.Content></Menu></div>;
}
export function AppView({vm}){
  useSyncExternalStore(vm.subscribe,vm.snapshot,vm.snapshot);
  return <div className="shelob-app"><header className="product-bar"><div className="product-bar-inner"><button id="home" className="product-brand" aria-label="Shelob home" onClick={()=>vm.action(()=>vm.home())}><img src={logo} alt=""/><span>Shelob</span></button><HeaderActions vm={vm}/></div></header>
    {vm.error&&!vm.modal&&<div className="app-status" id="app-status" role="alert"><strong>{vm.connected?'Action could not finish':'Shelob could not connect'}</strong><span>{vm.error}</span>{!vm.connected&&<Secondary onClick={()=>location.reload()}>Try again</Secondary>}</div>}
    {vm.page==='rules'?<div className="rules-scroll"><Quiet className="rules-back" onClick={()=>vm.action(()=>vm.home())}><Icon name="back"/>Back to reviews</Quiet><RulesView vm={vm}/></div>:<div className="inbox-workspace" data-reading={vm.readingReview}><ReviewRail vm={vm}/>{vm.selected?<SelectedReview vm={vm}/>:<main className="review-placeholder"><div><Icon name="check"/><h2>Choose a review</h2><p>Select a saved review to see its findings and next action.</p>{vm.connected&&!vm.extensions.message&&<p>App launch buttons need a newer Codex messaging extension. You can use Shelob from a conversation.</p>}</div></main>}</div>}
    {vm.modal?.kind==='new'&&<NewReview vm={vm}/>} {vm.modal?.kind==='rerun'&&<RerunReview vm={vm}/>} {vm.modal?.kind==='settings'&&<ReviewSettings vm={vm} modal={vm.modal}/>} {vm.modal?.kind==='post'&&<PostReview vm={vm} modal={vm.modal}/>} {vm.modal?.kind==='rule'&&<RuleEditor key={vm.modal.originalId||'new'} vm={vm} modal={vm.modal}/>} </div>;
}
