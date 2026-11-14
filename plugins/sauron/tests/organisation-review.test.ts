import {organisationTaskEvidence} from '../src/server/review-store.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SauronStore} from '../src/server/store.js';
import {runOrganisationReview} from '../src/server/organisation-review.js';
import type {ChatReader} from '../src/server/chat-reader.js';
import {dailyReviewDue,defaultReviewState,proposalOutputJsonSchema,type ChatEvidence,type ProposalChange} from '../src/shared/review-contracts.js';

function fixture(t:import('node:test').TestContext){
  const dir=mkdtempSync(join(tmpdir(),'sauron-review-'));let now=new Date('2026-11-14T08:00:00Z');const store=new SauronStore(join(dir,'state.sqlite'),()=>now);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const add=(title:string)=>{const id=randomUUID();store.createPersonal({operationId:id,title});return 'personal:'+id;};
  const evidence=(id:string=randomUUID(),message='evidence-one'):ChatEvidence=>({threadId:id,title:'Observed chat',fingerprint:message,messages:[{id:message,text:'Review the next step.',role:'assistant'}],latestAssistant:message});
  const propose=(changes:ProposalChange[],chats:ChatEvidence[]=[])=>{const {run}=store.beginReview('bootstrap');store.appendReviewChanges(run.id,run.leaseId,changes,chats);store.finishReview(run.id,run.leaseId);return store.view().organisationReview!.proposal!;};
  const accept=(changes=store.reviews.state().proposal!.changes)=>{const proposal=store.reviews.state().proposal!;return {operationId:randomUUID(),expectedStoreId:store.storeId,expectedRevision:store.view().taskViewRevision,proposalId:proposal.id,expectedProposalRevision:proposal.revision,changes};};
  return {store,add,evidence,propose,accept,advance(){now=new Date(now.getTime()+16*60_000);}};
}
test('O-01 O-02 O-03: discovery covers resumed and archived chats and every existing task without creating tasks',async t=>{
  const f=fixture(t),irrelevant=f.add('Review relevance'),tracked=randomUUID();f.store.trackCodexThreads({expectedStoreId:f.store.storeId,threads:[{threadId:tracked,title:'Already tracked'}]});
  const resumed=f.evidence(),archived=f.evidence(),read:string[]=[],generated:string[]=[],froms:string[]=[];
  const header=(id:string)=>({id,title:'Observed chat',createdAt:1,updatedAt:Date.parse('2026-11-14T07:00:00Z')/1000});
  const reader:ChatReader={runtime:'fake',async probe(){},async list(archive,cursor){return archive?{chats:[header(archived.threadId),header(tracked)],nextCursor:null}:cursor?{chats:[{...header(randomUUID()),updatedAt:1}],nextCursor:null}:{chats:[header(resumed.threadId),header(tracked)],nextCursor:'page-two'};},async read(chat,from){read.push(chat.id);froms.push(from);return chat.id===resumed.threadId?resumed:chat.id===archived.threadId?archived:f.evidence(tracked);},close(){}};
  const {run}=f.store.beginReview('bootstrap');await runOrganisationReview(f.store,run.id,run.leaseId,{reader,generate:async(chats,store)=>{
    assert.ok(store.view().items.some(task=>task.id===irrelevant));generated.push(...chats.map(chat=>chat.threadId));
    return chats.length?[{kind:'create',key:'parent',title:'Shared work',reason:'Related work.',evidenceIds:[]},{kind:'track',key:'resumed',threadId:resumed.threadId,title:resumed.title,parentRef:'parent',reason:'Resumed older work.',evidenceIds:[resumed.messages[0].id]}]:[{kind:'close',key:'close',taskRef:irrelevant,reason:'Review whether still relevant.',evidenceIds:[]}];
  }});
  assert.deepEqual(new Set(read),new Set([resumed.threadId,archived.threadId,tracked]));assert.equal(read.length,3);assert.equal(generated.length,3);assert.equal(froms[0],'2026-10-31T08:00:00.000Z');assert.equal(f.store.view().items.length,2);
  const proposal=f.store.reviews.state().proposal!;const accepted=f.accept(proposal.changes.filter(change=>change.kind!=='close'));f.store.acceptProposal(accepted);
  assert.equal(f.store.view().items.find(task=>task.id===irrelevant)?.state,'ready');assert.equal(f.store.view().items.filter(task=>task.title==='Shared work').length,1);assert.equal(f.store.view().items.find(task=>task.id==='personal:'+resumed.threadId)?.parentId,f.store.view().items.find(task=>task.title==='Shared work')?.id);
  const count=f.store.view().items.length;assert.equal(f.store.acceptProposal(accepted).receipt?.duplicate,true);assert.equal(f.store.view().items.length,count);
});
test('O-03: excluded dependencies and cyclic edits roll back all selected changes',t=>{
  const f=fixture(t),id=f.add('Existing');const proposal=f.propose([{kind:'create',key:'parent',title:'New parent',reason:'Group work.',evidenceIds:[]},{kind:'move',key:'move',taskRef:id,parentRef:'parent',reason:'Related.',evidenceIds:[]}]);
  const count=f.store.view().items.length;assert.throws(()=>f.store.acceptProposal(f.accept(proposal.changes.filter(change=>change.kind!=='create'))),/excluded parent/);assert.equal(f.store.view().items.length,count);
  const edits=proposal.changes.map(change=>change.kind==='move'?{...change,parentRef:id}:change);assert.throws(()=>f.store.acceptProposal(f.accept(edits)),/own branch/);assert.equal(f.store.view().items.length,count);
});
test('O-03 H-05: selected closures cannot silently close tasks moved into the branch by the same proposal',t=>{
  const f=fixture(t),root=f.add('Root'),child=f.add('Child');const proposal=f.propose([{kind:'move',key:'move',taskRef:child,parentRef:root,reason:'Group.',evidenceIds:[]},{kind:'close',key:'close',taskRef:root,reason:'Close.',evidenceIds:[]}]);
  assert.throws(()=>f.store.acceptProposal(f.accept(proposal.changes)),/Selected moves change/);assert.equal(f.store.view().items.find(task=>task.id===child)?.parentId,null);assert.ok(f.store.view().items.every(task=>task.state==='ready'));
});
test('O-03: stale proposal acceptance requires a fresh explicit review and rebase retries are idempotent',t=>{
  const f=fixture(t),id=f.add('Existing');let proposal=f.propose([{kind:'topics',key:'topic',taskRef:id,topics:['routines'],reason:'Classify.',evidenceIds:[]}]);f.add('Concurrent work');
  assert.throws(()=>f.store.acceptProposal(f.accept()),/changed/);
  const request={operationId:randomUUID(),expectedStoreId:f.store.storeId,proposalId:proposal.id,expectedProposalRevision:proposal.revision};f.store.rebaseProposal(request);assert.equal(f.store.rebaseProposal(request).receipt?.duplicate,true);
  proposal=f.store.reviews.state().proposal!;f.store.acceptProposal(f.accept());assert.equal(f.store.view().items.find(task=>task.id===id)?.directTopicIds?.length,1);
});
test('O-06: unchanged dismissals stay hidden; relevant new evidence permits a changed recommendation',t=>{
  const f=fixture(t),id=f.add('Existing'),first=f.evidence();const change:ProposalChange={kind:'topics',key:'topic',taskRef:id,topics:['routines'],reason:'Related evidence.',evidenceIds:[first.messages[0].id]};
  f.propose([change],[first]);f.store.acceptProposal(f.accept([]));const {run}=f.store.beginReview('bootstrap');f.store.appendReviewChanges(run.id,run.leaseId,[change],[first]);assert.equal(f.store.reviews.state().run?.changes.length,0);
  const next=f.evidence(first.threadId,'relevant-new-message');f.store.appendReviewChanges(run.id,run.leaseId,[{...change,evidenceIds:[next.messages[0].id]}],[next]);assert.equal(f.store.reviews.state().run?.changes.length,1);
});
test('O-04 I-02: incomplete reads retain watermarks and resume saved coverage without duplicate tracking',async t=>{
  const f=fixture(t),chat=f.evidence();let fails=true,reads=0;const reader:ChatReader={runtime:'fake',async probe(){},async list(archived){return {chats:archived?[]:[{id:chat.threadId,title:chat.title,createdAt:1,updatedAt:Date.parse('2026-11-14T07:00:00Z')/1000}],nextCursor:null};},async read(){reads++;if(fails){fails=false;throw Error('Missing access.');}return chat;},close(){}};
  let {run}=f.store.beginReview('daily');await runOrganisationReview(f.store,run.id,run.leaseId,{reader,generate:async()=>[]});assert.equal(f.store.reviews.state().run?.status,'partial');assert.equal(f.store.reviews.state().lastCompleteThrough,null);
  run=f.store.beginReview('daily').run;await runOrganisationReview(f.store,run.id,run.leaseId,{reader,generate:async()=>[]});assert.equal(f.store.reviews.state().run?.status,'completed');assert.equal(reads,2);assert.equal(f.store.reviews.state().lastCompleteThrough,'2026-11-14T08:00:00.000Z');
});
test('O-04: review leases coalesce and expired workers cannot overwrite resumed progress',t=>{
  const f=fixture(t),first=f.store.beginReview('bootstrap');assert.equal(f.store.beginReview('bootstrap').started,false);f.advance();const second=f.store.beginReview('bootstrap');assert.equal(second.run.id,first.run.id);assert.notEqual(second.run.leaseId,first.run.leaseId);assert.throws(()=>f.store.checkpointReview(first.run.id,first.run.leaseId,{cursor:'old'}),/lease expired/);
});
test('O-04 O-07: enablement needs verified capabilities, schedule failures do not enable, and retries never reinstall',t=>{
  const f=fixture(t),config=()=>({operationId:randomUUID(),expectedStoreId:f.store.storeId,expectedReviewRevision:f.store.reviews.state().revision,enabled:true});assert.throws(()=>f.store.configureReview(config()),/Verify local/);
  const {run}=f.store.beginReview('probe');f.store.reviewCapability(run.id,run.leaseId,{status:'verified',checkedAt:new Date().toISOString(),runtime:'fake',detail:'Fixture only.'});f.store.finishReview(run.id,run.leaseId);
  assert.throws(()=>f.store.configureReview(config(),()=>{throw Error('Schedule unavailable.');}),/Schedule unavailable/);assert.equal(f.store.reviews.state().enabled,false);
  let installs=0;const request=config();f.store.configureReview(request,()=>installs++);f.store.configureReview(request,()=>installs++);assert.equal(installs,1);assert.equal(f.store.view().items.length,0);
});
test('P-05: 07:00 Berlin remains correct across daylight-saving transitions and catches up once',()=>{
  const state={...defaultReviewState(),enabled:true};assert.equal(dailyReviewDue(state,new Date('2026-03-29T04:59:00Z')),false);assert.equal(dailyReviewDue(state,new Date('2026-03-29T05:00:00Z')),true);assert.equal(dailyReviewDue(state,new Date('2026-10-25T05:59:00Z')),false);assert.equal(dailyReviewDue(state,new Date('2026-10-25T06:00:00Z')),true);assert.equal(dailyReviewDue({...state,lastDailyDate:'2026-10-25'},new Date('2026-10-25T15:00:00Z')),false);
});

test('I-02: structured-output schema uses supported variants while runtime parsing remains strict',()=>{
  const schema=JSON.stringify(proposalOutputJsonSchema());assert.ok(schema.includes('"anyOf"'));assert.ok(!schema.includes('"oneOf"'));
});
test('O-03: task changes during model execution fail the batch instead of adopting an unreviewed baseline',async t=>{
  const f=fixture(t);const reader:ChatReader={runtime:'fake',async probe(){},async list(){return {chats:[],nextCursor:null};},async read(){throw Error('No chat reads expected.');},close(){}};
  const {run}=f.store.beginReview('bootstrap');await runOrganisationReview(f.store,run.id,run.leaseId,{reader,generate:async()=>{f.add('Changed during composition');return [{kind:'create',key:'parent',title:'Stale suggestion',reason:'Old context.',evidenceIds:[]}];}});
  assert.equal(f.store.reviews.state().run?.status,'failed');assert.equal(f.store.reviews.state().proposal,null);assert.equal(f.store.reviews.state().lastCompleteThrough,null);
});
test('H-06 A-02: chat responses before handling do not resurface; later responses suggest reopening',t=>{
  const f=fixture(t),threadId=randomUUID();f.store.trackCodexThreads({expectedStoreId:f.store.storeId,threads:[{threadId,title:'Tracked work'}]});const id='personal:'+threadId,task=f.store.view().items.find(task=>task.id===id)!;
  f.store.decide({operationId:randomUUID(),id,expectedVersion:task.version,action:'complete'});const {run}=f.store.beginReview('bootstrap');
  f.store.recordChatEvidence(run.id,run.leaseId,{...f.evidence(threadId,'old-final'),latestAssistantAt:Date.parse('2026-11-14T07:59:00Z')});assert.deepEqual(f.store.view().items.find(task=>task.id===id)?.reopenSuggestion,[]);
  f.store.recordChatEvidence(run.id,run.leaseId,{...f.evidence(threadId,'new-final'),latestAssistantAt:Date.parse('2026-11-14T08:01:00Z')});assert.equal(f.store.view().items.find(task=>task.id===id)?.state,'done');assert.deepEqual(f.store.view().items.find(task=>task.id===id)?.reopenSuggestion,[id]);
});

test('O-06: task evidence ignores title and polling changes but recognises substantive user corrections',t=>{
  const f=fixture(t),id=f.add('Existing'),task=f.store.view().items.find(task=>task.id===id)!,before=organisationTaskEvidence(task);
  const renamed=f.store.planTask({operationId:randomUUID(),id,expectedVersion:task.version,title:'Renamed only'}).items.find(task=>task.id===id)!;assert.equal(organisationTaskEvidence(renamed),before);
  const corrected=f.store.planTask({operationId:randomUUID(),id,expectedVersion:renamed.version,nextAction:'The work now belongs to a different subject.'}).items.find(task=>task.id===id)!;assert.notEqual(organisationTaskEvidence(corrected),before);
});
test('O-03 O-04: accepting a partial proposal preserves the missing-chat checkpoint for the next review',t=>{
  const f=fixture(t),chat={id:randomUUID(),title:'Unavailable chat',createdAt:1,updatedAt:2};const {run}=f.store.beginReview('bootstrap');
  f.store.appendReviewChanges(run.id,run.leaseId,[{kind:'create',key:'parent',title:'Reviewed parent',reason:'Confirmed useful work.',evidenceIds:[]}],[]);f.store.checkpointReview(run.id,run.leaseId,{stage:'propose',errors:['Missing chat.'],retryChats:[chat]});f.store.finishReview(run.id,run.leaseId);f.store.acceptProposal(f.accept());
  const resumed=f.store.beginReview('bootstrap').run;assert.equal(resumed.id,run.id);assert.equal(resumed.pending[0].id,chat.id);assert.equal(resumed.changes.length,0);assert.equal(f.store.reviews.state().lastCompleteThrough,null);
});
test('O-04 I-02: permanently missing chat coverage does not block discovering newly active chats',async t=>{
  const f=fixture(t),missing=f.evidence(),fresh=f.evidence();let includeNew=false;const read:string[]=[];
  const header=(evidence:ChatEvidence)=>({id:evidence.threadId,title:evidence.title,createdAt:1,updatedAt:Date.parse('2026-11-14T08:10:00Z')/1000});
  const reader:ChatReader={runtime:'fake',async probe(){},async list(archived){return {chats:archived?[]:[header(missing),...(includeNew?[header(fresh)]:[])],nextCursor:null};},async read(chat){read.push(chat.id);if(chat.id===missing.threadId)throw Error('Missing chat.');return fresh;},close(){}};
  let run=f.store.beginReview('daily').run;await runOrganisationReview(f.store,run.id,run.leaseId,{reader,generate:async()=>[]});assert.equal(f.store.reviews.state().run?.status,'partial');f.advance();includeNew=true;
  run=f.store.beginReview('daily').run;await runOrganisationReview(f.store,run.id,run.leaseId,{reader,generate:async()=>[]});assert.ok(read.includes(fresh.threadId));assert.equal(read.filter(id=>id===missing.threadId).length,2);assert.equal(f.store.reviews.state().lastCompleteThrough,null);
});

test('O-03: proposals keep one placement per task and combine overlapping branch closures',t=>{
  const f=fixture(t),root=f.add('Root'),child=f.add('Child'),other=f.add('Other');
  f.store.organiseTask({operationId:randomUUID(),expectedStoreId:f.store.storeId,expectedRevision:f.store.view().taskViewRevision,action:'move',id:child,parentId:root});const {run}=f.store.beginReview('bootstrap');
  f.store.appendReviewChanges(run.id,run.leaseId,[{kind:'move',key:'first',taskRef:other,parentRef:root,reason:'First placement.',evidenceIds:[]}],[]);f.store.appendReviewChanges(run.id,run.leaseId,[{kind:'move',key:'second',taskRef:other,parentRef:child,reason:'Refined placement.',evidenceIds:[]},{kind:'close',key:'root-close',taskRef:root,reason:'Close branch.',evidenceIds:[]},{kind:'close',key:'child-close',taskRef:child,reason:'Close child.',evidenceIds:[]}],[]);f.store.finishReview(run.id,run.leaseId);
  const changes=f.store.reviews.state().proposal!.changes;assert.equal(changes.filter(change=>change.kind==='move').length,1);assert.equal(changes.filter(change=>change.kind==='close').length,1);
});
