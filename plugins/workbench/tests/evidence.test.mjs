import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, registered, checkpoint } from './fixtures.mjs';
import { evidenceLabel, attentionReason } from '../app/presentation.mjs';

test('verification and review retain independent timestamps and revisions through resume', async t => {
  const sample = fixture(); t.after(sample.cleanup);
  const note = fs.readFileSync(sample.legacyNote);
  let task = await registered(sample);
  const verified = { result: 'passed', checkedAt: '2026-10-20T10:00:00.000Z', head: 'a'.repeat(40) };
  task = await checkpoint(sample.store, task, { head: verified.head, evidence: { verify: verified.result, checkedAt: verified.checkedAt, head: verified.head } });
  task = await checkpoint(sample.store, task, { stage: 'review', head: 'b'.repeat(40), evidence: { review: 'passed', checkedAt: '2026-10-20T11:00:00.000Z', head: 'b'.repeat(40) } });
  assert.deepEqual(task.evidenceChecks.verify, verified);
  assert.equal(task.evidenceChecks.review.checkedAt, '2026-10-20T11:00:00.000Z');
  assert.equal(task.evidence.head, undefined, 'legacy projection must not give different checks one shared HEAD');
  assert.match(evidenceLabel(task, 'verify'), /earlier revision/);
  assert.match(evidenceLabel(task, 'review'), /recorded commit/);
  assert.match(attentionReason(task), /earlier revision/);
  const resumed = sample.store.get(task.id).task;
  assert.deepEqual(resumed.evidenceChecks, task.evidenceChecks);
  assert.deepEqual(fs.readFileSync(sample.legacyNote), note);
  task = await checkpoint(sample.store, task, { evidence: { verify: 'passed', checkedAt: '2026-10-20T12:00:00.000Z' } });
  assert.match(evidenceLabel(task, 'verify'), /revision not recorded/);
  assert.equal(task.evidenceChecks.review.head, 'b'.repeat(40));
});

test('legacy flat evidence is normalized in memory without rewriting saved data', async t => {
  const sample = fixture(); t.after(sample.cleanup);
  const task = await registered(sample);
  await sample.store.mutate(data => {
    data.tasks[0].evidence = { verify: 'passed', review: 'findings', checkedAt: '2026-10-20T10:00:00.000Z', head: 'a'.repeat(40) };
  });
  const before = fs.readFileSync(sample.store.filename);
  const loaded = sample.store.get(task.id).task;
  assert.equal(loaded.evidenceChecks.verify.result, 'passed');
  assert.equal(loaded.evidenceChecks.review.result, 'findings');
  assert.equal(loaded.evidenceChecks.review.head, loaded.evidence.head);
  sample.store.list();
  assert.deepEqual(fs.readFileSync(sample.store.filename), before);
  assert.equal(loaded.id, task.id);
});
