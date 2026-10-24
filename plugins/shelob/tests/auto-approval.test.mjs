import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AutoApproval, ApprovalPolicy, cleanApprovalEligible } from '../server/auto-approval.mjs';
import { ReviewPublisher } from '../server/reviews.mjs';
import { createServer } from '../server/index.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const version=JSON.parse(fs.readFileSync(new URL('../plugin.json',import.meta.url),'utf8')).version;

function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shelob-auto-approval-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source={kind:'github_pr',reviewMode:'pr_only',url:'https://github.com/example/repo/pull/1',headSha:'a'.repeat(40),baseSha:'b'.repeat(40)};
  const run={id:'12345678-1234-4123-8123-123456789abc',state:'complete',source};
  const report={pluginVersion:version,source,status:'no_findings',snapshot:{id:'c'.repeat(64)},freshness:{status:'current'},description:{text:'Reviewed description'},repository:{untracked:[]},files:[{path:'src/value.ts'}],analysis:{codeReview:{required:true,status:'completed'},execution:{state:'completed',label:'Completed',reason:'Finished the required steps.'}},results:[{ruleId:'CODEX-REVIEW',mode:'codex',status:'assessed',findings:[]},{ruleId:'RULE-001',mode:'contextual',status:'assessed',findings:[]}]};
  const latest={source:{...source},description:'Reviewed description'},writes=[];
  const store={root,directory:id=>{assert.equal(id,run.id);return root;},get:()=>({run,report}),github:{metadata:async()=>latest,postReview:async(url,payload)=>{writes.push({url,payload});return {id:1,url:url+'#approval',state:'APPROVED'};}}};
  const publisher=new ReviewPublisher(store),automatic=new AutoApproval(store,publisher);
  const enable=()=>automatic.policy.save({enabled:true,revision:automatic.policy.get().revision});
  return {root,source,run,report,value:{run,report},store,publisher,automatic,enable,latest,writes};
}
test('automatic approval defaults off, requires an explicit setting and records one approval for a clean finalized PR',async t=>{
 const s=setup(t),before=JSON.stringify(s.report);assert.equal(s.automatic.policy.get().enabled,false);await s.automatic.afterFinalize(s.value);assert.equal(s.writes.length,0);
 s.enable();await s.automatic.afterFinalize(s.value);assert.equal(s.writes.length,1);assert.equal(s.writes[0].payload.event,'APPROVE');assert.equal(s.writes[0].payload.commit_id,s.source.headSha);assert.equal(s.publisher.status(s.run.id).approval.state,'posted');assert.equal(s.automatic.status(s.run.id).state,'posted');assert.equal(JSON.stringify(s.report),before);
 await new AutoApproval(s.store,new ReviewPublisher(s.store)).afterFinalize(s.value);assert.equal(s.writes.length,1);
});
test('failures, partial coverage, missing native output, any finding, stale source and local reviews never auto-approve',async t=>{
 const cases={failed:s=>s.run.state='failed',interrupted:s=>s.run.state='interrupted',pending:s=>s.run.state='awaiting_review',unchecked:s=>s.report.results[1].status='not_assessed',error:s=>s.report.results[1].status='error',native:s=>s.report.analysis.codeReview.status='failed',missingNative:s=>delete s.report.analysis.codeReview,partial:s=>s.report.analysis.execution.state='incomplete',gap:s=>s.report.files[0].limitation='Source unavailable',binary:s=>s.report.files[0].binary=true,untracked:s=>s.report.repository.untracked=['extra.ts'],stale:s=>s.report.freshness.status='outdated',unknown:s=>delete s.report.freshness,local:s=>s.run.source.kind='local',noApplicable:s=>s.report.results.forEach(r=>r.status='not_applicable'),reference:s=>s.report.results[0].findingRefs=['unknown'],note:s=>s.report.results[0].findings=[{id:'note',severity:'info'}],blocking:s=>s.report.results[0].findings=[{id:'block',severity:'error'}]};
 for(const [name,change]of Object.entries(cases)){const s=setup(t);change(s);s.enable();assert.equal(cleanApprovalEligible(s.value),false,name);await s.automatic.afterFinalize(s.value);assert.equal(s.writes.length,0,name);}
});
test('head, base and description are rechecked immediately before automatic delivery',async t=>{
 for(const changed of ['headSha','baseSha','description']){const s=setup(t);s.enable();let reads=0;s.store.github.metadata=async()=>{reads++;if(reads===2){if(changed==='description')s.latest.description='Changed';else s.latest.source[changed]='d'.repeat(40);}return s.latest;};await s.automatic.afterFinalize(s.value);assert.equal(s.writes.length,0,changed);assert.equal(s.automatic.status(s.run.id).state,'stopped');}
});
test('uncertain automatic delivery is receipted and never retried on another finalize or after restart',async t=>{
 const s=setup(t);s.enable();s.store.github.postReview=async()=>{s.writes.push('attempt');throw Error('Uncertain network response');};await s.automatic.afterFinalize(s.value);assert.equal(s.writes.length,1);assert.equal(s.publisher.status(s.run.id).approval.state,'unknown');await new AutoApproval(s.store,new ReviewPublisher(s.store)).afterFinalize(s.value);assert.equal(s.writes.length,1);
});
test('concurrent finalizations cannot send duplicate approvals and disabling during preview stops delivery',async t=>{
 const s=setup(t);s.enable();await Promise.all([s.automatic.afterFinalize(s.value),s.automatic.afterFinalize(s.value)]);assert.equal(s.writes.length,1);
 const stopped=setup(t);stopped.enable();stopped.store.github.metadata=async()=>{stopped.automatic.policy.save({enabled:false,revision:stopped.automatic.policy.get().revision});return stopped.latest;};await stopped.automatic.afterFinalize(stopped.value);assert.equal(stopped.writes.length,0);assert.equal(stopped.automatic.status(stopped.run.id).state,'skipped');
});
test('approval policy preserves revision conflicts and invalid data fails closed',t=>{
 const s=setup(t),policy=new ApprovalPolicy(s.root),initial=policy.get();policy.save({enabled:true,revision:initial.revision});assert.throws(()=>policy.save({enabled:false,revision:initial.revision}),/changed in another window/);assert.equal(policy.get().enabled,true);fs.writeFileSync(policy.file,'{"enabled":"yes"}');assert.throws(()=>policy.get(),/invalid/);
});

test('MCP finalize applies standing approval permission, while reading saved history never triggers it',async t=>{
 const s=setup(t);s.run.state='awaiting_review';s.store.finalize=async()=>{s.run.state='complete';return s.value;};
 const server=createServer({store:s.store,appHtml:'<p>Fixture</p>'}),client=new Client({name:'auto-approval-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);t.after(async()=>{await client.close();await server.close();});
 const policy=(await client.callTool({name:'shelob.approval_policy',arguments:{}})).structuredContent;
 await client.callTool({name:'shelob.approval_policy_save',arguments:{enabled:true,revision:policy.revision}});
 await client.callTool({name:'shelob.get',arguments:{runId:s.run.id}});assert.equal(s.writes.length,0);
 const result=await client.callTool({name:'shelob.finalize',arguments:{runId:s.run.id,assessments:{schemaVersion:'1.0.0',snapshotId:s.report.snapshot.id,assessments:[]}}});assert.equal(result.isError,undefined);assert.equal(s.writes.length,1);assert.equal(result._meta.publishing.approval.state,'posted');
});
test('re-finalizing a saved completed report after enabling the policy never approves history',async t=>{
 const s=setup(t);s.enable();s.store.finalize=async()=>s.value;const server=createServer({store:s.store,appHtml:'<p>Fixture</p>'}),client=new Client({name:'saved-clean-review-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);t.after(async()=>{await client.close();await server.close();});
 const result=await client.callTool({name:'shelob.finalize',arguments:{runId:s.run.id,assessments:{schemaVersion:'1.0.0',snapshotId:s.report.snapshot.id,assessments:[]}}});assert.equal(result.isError,undefined);assert.equal(s.writes.length,0);assert.equal(s.automatic.status(s.run.id),null);
});
