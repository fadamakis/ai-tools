import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reviewTriggerSchema,dailyReviewDue} from '../shared/review-contracts.js';
import type {SauronStore} from './store.js';

export function triggerOrganisationReview(store:SauronStore,input:unknown){
  const request=reviewTriggerSchema.parse(input);
  if(request.expectedStoreId!==store.storeId)throw Error('Store ID does not match.');
  const state=store.reviews.state();
  if(request.reason==='timer'&&state.nextAttemptAt&&Date.parse(state.nextAttemptAt)>Date.now())return store.view();
  if(request.reason==='timer'&&(!dailyReviewDue(store.reviews.state(),new Date())||request.kind!=='daily'))return store.view();
  const result=store.beginReview(request.kind);if(!result.started)return store.view();
  const child=spawn(process.execPath,[fileURLToPath(new URL('./organisation-worker.js',import.meta.url)),store.path,store.storeId,result.run.id,result.run.leaseId],{stdio:'ignore',detached:true});
  child.once('error',()=>store.failReview(result.run.id,result.run.leaseId,'The organisation worker could not start. Recheck the local runtime.'));child.unref();return store.view();
}
