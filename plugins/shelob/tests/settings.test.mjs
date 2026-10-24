import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ReviewSettings } from '../server/settings.mjs';
import { ReviewStore } from '../server/store.mjs';
import { NativeReviewer } from '../server/native-review.mjs';
import { fixture } from './fixtures.mjs';

test('review-model settings survive restart, reject stale edits, and never change CLI configuration', t => {
  const sample = fixture(); t.after(sample.cleanup);
  const root = path.join(sample.root, 'settings'), settings = new ReviewSettings(root);
  const initial = settings.get(); assert.equal(initial.model, null);
  assert.throws(() => settings.save({ revision: initial.revision, model: '--bad model' }), /valid Codex/);
  const saved = settings.save({ revision: initial.revision, model: 'chosen-model' });
  assert.equal(new ReviewSettings(root).get().model, 'chosen-model');
  assert.throws(() => settings.save({ revision: initial.revision, model: null }), /changed in another window/);
  assert.equal(settings.save({ revision: saved.revision, model: null }).model, null);
});

test('new reviews pin the chosen model; a repeated unsupported setup stops before another native invocation across server restarts', async t => {
  const sample = fixture({ 'value.js': 'export const value = 1;\n' }); t.after(sample.cleanup);
  sample.write('value.js', 'export const value = 2;\n');
  const root = path.join(sample.root, 'reviews'); let calls = 0;
  const reviewer = new NativeReviewer(async args => {
    if (args.includes('list')) return { code: 0, stdout: '[]' };
    calls++; assert.equal(args[args.indexOf('--model') + 1], 'chosen-model');
    return { code: 1, stdout: JSON.stringify({ type: 'turn.failed', error: { message: "The 'chosen-model' model is not supported when using Codex with a ChatGPT account." } }) };
  });
  let store = new ReviewStore({ root, nativeReviewer: reviewer });
  store.settings.save({ revision: store.settings.get().revision, model: 'chosen-model' });
  const first = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  store.settings.save({ revision: store.settings.get().revision, model: 'next-model' });
  assert.equal((await store.codeReview(first.run.id)).nativeReview.status, 'failed');
  assert.equal(calls, 1, 'changing settings does not retarget an existing run');
  store = new ReviewStore({ root, nativeReviewer: reviewer });
  store.settings.save({ revision: store.settings.get().revision, model: 'chosen-model' });
  const second = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  await assert.rejects(store.codeReview(second.run.id), /stopped this repeat attempt/);
  assert.equal(calls, 1);
  assert.equal(store.get(second.run.id).nativeReview, null);
  assert.equal(store.settings.rejected(store.settings.signature('next-model')), null);
  store.settings.save({ revision: store.settings.get().revision, model: 'chosen-model', retryRejectedSetup: true });
  assert.equal(store.settings.rejected(store.settings.signature('chosen-model')), null, 'an explicit retry unlocks the setup after account access changes');
  assert.equal(calls, 1, 'unlocking the setup does not run a review');
});
