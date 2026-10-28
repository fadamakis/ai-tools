import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, registered, checkpoint, threadId } from './fixtures.mjs';
import { workspaceSnapshot, sameContent } from '../server/workspace.mjs';
import { evidenceFreshness } from '../shared/evidence.mjs';

async function setup(t) {
  const sample = fixture(); t.after(sample.cleanup);
  let task = await registered(sample);
  task = await sample.store.taskEvidence.requirements({ taskId: task.id, expectedRevision: task.revision, threadId, content: 'The greeting is visible. No new routes.', baseRef: 'main' });
  return { ...sample, task, repository: sample.store.get(task.id).repository };
}
const capture = (s, kind = 'verify') => s.store.taskEvidence.capture({ taskId: s.task.id, expectedRevision: s.store.get(s.task.id).task.revision, threadId, kind });

test('a result cannot pass against changed dirty content at the same HEAD', async t => {
  const s = await setup(t), first = await capture(s);
  fs.writeFileSync(path.join(s.repo, 'readme.txt'), 'changed\n');
  await assert.rejects(checkpoint(s.store, first.task, { evidence: { verify: 'passed', snapshotId: first.snapshot.id, checkedAt: new Date().toISOString() } }), /stale/);
  const refreshed = await s.store.taskEvidence.capture({ taskId: s.task.id, expectedRevision: first.task.revision, threadId });
  assert.equal(refreshed.snapshot.head, first.snapshot.head);
  assert.notEqual(refreshed.snapshot.tree, first.snapshot.tree);
});

test('contents, missing files, executable modes and symlink targets change the fingerprint without following links', async t => {
  const s = await setup(t), snap = () => workspaceSnapshot(s.store.get(s.task.id).task, s.repository);
  const original = await snap();
  fs.writeFileSync(path.join(s.repo, 'new.txt'), 'new'); const untracked = await snap(); assert.notEqual(original.tree, untracked.tree);
  fs.chmodSync(path.join(s.repo, 'new.txt'), 0o755); const executable = await snap(); assert.notEqual(untracked.tree, executable.tree);
  fs.symlinkSync('/missing/first', path.join(s.repo, 'link')); const link = await snap();
  fs.unlinkSync(path.join(s.repo, 'link')); fs.symlinkSync('/missing/second', path.join(s.repo, 'link')); assert.notEqual(link.tree, (await snap()).tree);
  fs.unlinkSync(path.join(s.repo, 'readme.txt')); assert.notEqual(executable.tree, (await snap()).tree);
  assert.equal(JSON.stringify(await snap()).includes('new\n'), false);
});

test('requirements are stable across progress and independent evidence remains bound to its own capture', async t => {
  const s = await setup(t), first = await capture(s);
  let task = await checkpoint(s.store, first.task, { stage: 'verify', evidence: { verify: 'passed', snapshotId: first.snapshot.id, checkedAt: new Date().toISOString() } });
  const digest = task.requirements.digest;
  assert.equal(evidenceFreshness(task, 'verify').status, 'current');
  const review = await capture(s, 'review');
  task = await checkpoint(s.store, review.task, { stage: 'review', evidence: { review: 'passed', snapshotId: review.snapshot.id, checkedAt: new Date().toISOString() } });
  assert.equal(task.evidenceChecks.verify.snapshot.id, first.snapshot.id);
  assert.equal(task.requirements.digest, digest);
  task = await s.store.taskEvidence.requirements({ taskId: task.id, expectedRevision: task.revision, threadId, content: 'A different accepted requirement.', baseRef: 'main' });
  assert.equal(evidenceFreshness(task, 'verify').status, 'stale');
  assert.equal(evidenceFreshness(task, 'review').status, 'stale');
  assert.equal(task.requirements.revision, 2);
});

test('file boundaries cannot alias contents containing fingerprint separators', async t => {
  const s = await setup(t), snap = () => workspaceSnapshot(s.store.get(s.task.id).task, s.repository);
  const separator = '\0["z.txt","0"]\0';
  fs.writeFileSync(path.join(s.repo, 'readme.txt'), `a${separator}b`);
  fs.writeFileSync(path.join(s.repo, 'z.txt'), 'c');
  const first = await snap();
  fs.writeFileSync(path.join(s.repo, 'readme.txt'), 'a');
  fs.writeFileSync(path.join(s.repo, 'z.txt'), `b${separator}c`);
  assert.notEqual(first.tree, (await snap()).tree);
});

test('base movement invalidates evidence and commit rebinding requires identical content', async t => {
  const s = await setup(t); s.git('switch', '-c', 'task');
  fs.writeFileSync(path.join(s.repo, 'readme.txt'), 'implementation\n');
  const first = await capture(s);
  s.git('add', 'readme.txt'); s.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Implementation');
  const after = await workspaceSnapshot(s.store.get(s.task.id).task, s.repository);
  assert.equal(sameContent(first.snapshot, after), false);
  assert.equal(sameContent(first.snapshot, after, { allowCommit: true }), true);
  s.git('branch', '-f', 'main', 'HEAD');
  assert.equal(sameContent(first.snapshot, await workspaceSnapshot(s.store.get(s.task.id).task, s.repository), { allowCommit: true }), false);
});

test('unavailable checkout and unbound legacy evidence never become current proof', async t => {
  const s = await setup(t), task = await checkpoint(s.store, s.task, { evidence: { verify: 'passed', head: s.git('rev-parse', 'HEAD'), checkedAt: new Date().toISOString() } });
  assert.equal(evidenceFreshness(task, 'verify').status, 'unbound');
  s.git('update-ref', '-d', 'refs/heads/main');
  const result = await capture(s);
  assert.equal(result.task.workspace.status, 'unavailable');
  assert.equal(result.snapshot, undefined);
});
