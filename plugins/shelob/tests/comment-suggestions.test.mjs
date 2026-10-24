import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommentSuggestions } from '../server/comment-suggestions.mjs';
import { reviewAction } from '../app/review-action.mjs';
const runId='12345678-1234-4123-8123-123456789abc',requestId='22345678-1234-4123-8123-123456789abc';
test('rewrite proposals survive restart, are snapshot-bound, idempotent and never mutate findings or drafts',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shelob-comment-suggestion-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const report={snapshot:{id:'a'.repeat(64)},results:[{findings:[{id:'finding-1',message:'Original evidence'}]}]};const original=JSON.stringify(report);
 const store={directory:id=>{assert.equal(id,runId);return root;},get:()=>({report})},suggestions=new CommentSuggestions(store);
 const args={requestId,runId,snapshotId:report.snapshot.id,findingId:'finding-1',originalDraft:'My draft',draft:'Proposed replacement'};
 const saved=suggestions.save(args);assert.deepEqual(suggestions.save(args),saved);assert.deepEqual(new CommentSuggestions(store).list(runId,report.snapshot.id),[saved]);assert.deepEqual(suggestions.list(runId,'b'.repeat(64)),[]);assert.equal(JSON.stringify(report),original);
 assert.throws(()=>suggestions.save({...args,draft:'A different response'}),/already exists/);assert.throws(()=>suggestions.save({...args,snapshotId:'b'.repeat(64)}),/snapshot changed/);assert.throws(()=>suggestions.save({...args,findingId:'../../other'}),/not in the saved review/);assert.throws(()=>suggestions.save({...args,draft:'x'.repeat(601)}),/600/);
});
test('each report state has one explicit next action, keeping rerun and setup recovery ahead of approval',()=>{
 const base={setupFailed:false,state:'ready',execution:{state:'completed'}},run={state:'complete'};
 for(const [state,kind] of [['ready','approve'],['changes','issues'],['incomplete','continue'],['progress','continue'],['stale','continue'],['approved','receipt'],['uncertain','github']])assert.equal(reviewAction({decision:{...base,state},run,isPr:true}).kind,kind);
 assert.equal(reviewAction({decision:base,run:{...run,requiresRerun:true},isPr:true}).label,'Start fresh review');assert.equal(reviewAction({decision:{...base,setupFailed:true},run,isPr:true}).kind,'settings');assert.equal(reviewAction({decision:base,run,isPr:false}).kind,'issues');
});
