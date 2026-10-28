import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fixture, registered, checkpoint, threadId } from './fixtures.mjs';
import { Publication, remoteIdentity } from '../server/publication.mjs';
import { evidenceFreshness } from '../shared/evidence.mjs';

async function setup(t, { existing = false } = {}) {
  const s = fixture({ legacy: false }); t.after(s.cleanup);
  s.git('config', 'commit.gpgsign', 'false'); s.git('config', 'user.name', 'Fixture'); s.git('config', 'user.email', 'fixture@example.invalid');
  const remote = path.join(s.directory, 'remote.git'); execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
  s.git('remote', 'add', 'origin', remote); s.git('push', 'origin', 'main'); s.git('switch', '-c', 'task');
  const state = { prs: existing ? [{ url: 'https://github.com/example/repository/pull/123', state: 'OPEN', isDraft: false, headRefName: 'task', baseRefName: 'main', headRefOid: s.git('rev-parse', 'HEAD'), author: { login: 'owner' }, body: 'Human notes and existing https://github.com/user-attachments/assets/example', title: 'Human title', isCrossRepository: false }] : [], mutations: [], failCreate: false };
  const github = async (args, options) => {
    if (args[0] === 'api') return JSON.stringify(args[1] === 'user' ? { login: 'owner' } : { full_name: 'example/repository', permissions: { push: true } });
    if (args[1] === 'list') return JSON.stringify(state.prs.map(pr => ({ ...pr, headRefOid: s.git('rev-parse', 'HEAD') })));
    if (args.includes('--help')) return state.attachmentSupport === false ? 'Usage: gh pr' : '--attach';
    state.mutations.push(args[1]);
    if (args[1] === 'create') {
      state.prs = [{ url: 'https://github.com/example/repository/pull/123', state: 'OPEN', isDraft: true, headRefName: 'task', baseRefName: 'main', headRefOid: s.git('rev-parse', 'HEAD'), author: { login: 'owner' }, body: options.input + (state.attachedAssets || ''), title: 'Task implementation', isCrossRepository: false }];
      if (state.failCreate) throw new Error('Response lost after creation');
    } else if (args[1] === 'edit') state.prs[0].body = options.input + (state.attachedAssets || '');
    return state.prs[0].url;
  };
  s.store.publication = new Publication(s.store, { ghRunner: github, identity: async () => 'example/repository' });
  let task = await registered(s); task = await checkpoint(s.store, task, { branch: 'task' });
  task = await s.store.taskEvidence.requirements({ taskId: task.id, expectedRevision: task.revision, threadId, content: 'The fixture greeting changes.', baseRef: 'main' });
  fs.writeFileSync(path.join(s.repo, 'readme.txt'), 'implementation\n'); s.git('add', 'readme.txt');
  for (const kind of ['verify', 'review']) {
    const capture = await s.store.taskEvidence.capture({ taskId: task.id, expectedRevision: task.revision, threadId, kind });
    task = await checkpoint(s.store, capture.task, { stage: kind, evidence: { [kind]: 'passed', snapshotId: capture.snapshot.id, checkedAt: new Date().toISOString() } });
  }
  const args = () => ({ taskId: task.id, expectedRevision: s.store.get(task.id).task.revision, threadId });
  const prepare = (values = {}) => s.store.publication.prepare({ ...args(), actions: ['commit', 'push', 'pr'], files: ['readme.txt'], baseBranch: 'main', message: 'Implement the fixture', title: 'Task implementation', body: 'Verified behavior. [Storybook](https://example.com/story)', ...values });
  const step = attempt => s.store.publication.execute({ ...args(), attemptId: attempt.id });
  return { ...s, task, state, args, prepare, step };
}

test('publication commits with hooks, pushes ordinarily and creates exactly one draft PR', async t => {
  const s = await setup(t), first = await s.prepare();
  let result = await s.step(first.attempt); assert.equal(result.attempt.state, 'prepared');
  assert.equal(evidenceFreshness(result.task, 'verify').status, 'current');
  result = await s.step(first.attempt); assert.equal(result.attempt.completed.join(','), 'commit,push');
  result = await s.step(first.attempt); assert.equal(result.attempt.state, 'complete');
  assert.equal(s.state.prs[0].isDraft, true); assert.equal(s.state.mutations.join(','), 'create');
  assert.equal(result.task.stage === 'done', false);
  await assert.rejects(s.step(first.attempt), /Reconcile/);
});
test('lost PR response is adopted by reconciliation without a second create', async t => {
  const s = await setup(t), first = await s.prepare();
  await s.step(first.attempt); await s.step(first.attempt); s.state.failCreate = true;
  const unknown = await s.step(first.attempt); assert.equal(unknown.attempt.state, 'uncertain');
  const result = await s.store.publication.reconcile({ ...s.args(), attemptId: first.attempt.id });
  assert.equal(result.attempt.state, 'complete'); assert.deepEqual(s.state.mutations, ['create']);
});
test('human body, attachments, Storybook links and existing readiness survive managed updates', async t => {
  const s = await setup(t, { existing: true }), first = await s.prepare();
  await s.step(first.attempt); await s.step(first.attempt); const result = await s.step(first.attempt);
  assert.equal(result.attempt.state, 'complete'); assert.equal(s.state.prs[0].isDraft, false);
  assert.match(s.state.prs[0].body, /Human notes/); assert.match(s.state.prs[0].body, /user-attachments/); assert.match(s.state.prs[0].body, /Storybook/);
  assert.deepEqual(s.state.mutations, ['edit']);
});
test('hook modifications withhold the push and preserve uncertain evidence', async t => {
  const s = await setup(t), first = await s.prepare();
  const hooks = s.git('rev-parse', '--git-path', 'hooks'), hook = path.resolve(s.repo, hooks, 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nprintf "hook change\\n" > readme.txt\ngit add readme.txt\n', { mode: 0o755 });
  const result = await s.step(first.attempt);
  assert.equal(result.attempt.state, 'uncertain'); assert.equal(s.git('ls-remote', '--heads', 'origin', 'refs/heads/task'), '');
  await assert.rejects(s.step(first.attempt), /Reconcile/);
});
test('unrelated staged changes and changed remote heads never publish', async t => {
  const s = await setup(t);
  await assert.rejects(s.prepare({ files: [] }), /staged changes/);
  const first = await s.prepare();
  s.git('push', 'origin', 'HEAD:refs/heads/task');
  await assert.rejects(s.step(first.attempt), /remote head advanced/);
  assert.equal(s.state.mutations.length, 0);
});
test('commit-only stops at its authorized boundary and simultaneous execution has one owner', async t => {
  const s = await setup(t), first = await s.prepare({ actions: ['commit'] });
  const results = await Promise.allSettled([s.step(first.attempt), s.step(first.attempt)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const attempt = s.store.get(s.task.id).task.publications[0];
  assert.equal(attempt.state, 'complete'); assert.deepEqual(attempt.completed, ['commit']);
  assert.equal(s.state.mutations.length, 0);
});

test('split fetch and push destinations cannot validate another repository', async t => {
  const s = fixture({ legacy: false }); t.after(s.cleanup);
  s.git('remote', 'add', 'origin', 'https://github.com/example/fetch.git');
  s.git('remote', 'set-url', '--push', 'origin', 'https://github.com/example/push.git');
  await assert.rejects(remoteIdentity(s.repo, 'origin'), /fetch and push destinations differ/);
  s.git('remote', 'set-url', '--push', 'origin', 'https://github.com/example/fetch.git');
  assert.equal(await remoteIdentity(s.repo, 'origin'), 'example/fetch');
});

test('interruption after a commit or push adopts the observed result without repeating hooks', async t => {
  const s = await setup(t), first = await s.prepare();
  const hooks = s.git('rev-parse', '--git-path', 'hooks'), marker = path.join(s.directory, 'hook-runs');
  fs.writeFileSync(path.resolve(s.repo, hooks, 'pre-commit'), `#!/bin/sh\nprintf x >> '${marker}'\n`, { mode: 0o755 });
  const reconcile = s.store.publication.reconcile.bind(s.store.publication);
  s.store.publication.reconcile = async () => { throw new Error('Process interrupted before receipt'); };
  let result = await s.step(first.attempt); assert.equal(result.attempt.state, 'uncertain');
  s.store.publication.reconcile = reconcile;
  result = await reconcile({ ...s.args(), attemptId: first.attempt.id });
  assert.deepEqual(result.attempt.completed, ['commit']); assert.equal(fs.readFileSync(marker, 'utf8'), 'x');
  s.store.publication.reconcile = async () => { throw new Error('Process interrupted before receipt'); };
  result = await s.step(first.attempt); assert.equal(result.attempt.state, 'uncertain');
  s.store.publication.reconcile = reconcile;
  result = await reconcile({ ...s.args(), attemptId: first.attempt.id });
  assert.deepEqual(result.attempt.completed, ['commit', 'push']); assert.equal(fs.readFileSync(marker, 'utf8'), 'x');
});

test('a proven unperformed commit can retry while changed human PR text cannot be overwritten', async t => {
  const s = await setup(t, { existing: true }), first = await s.prepare();
  const hooks = s.git('rev-parse', '--git-path', 'hooks'), hook = path.resolve(s.repo, hooks, 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.equal((await s.step(first.attempt)).attempt.state, 'uncertain');
  let result = await s.store.publication.reconcile({ ...s.args(), attemptId: first.attempt.id });
  assert.equal(result.attempt.state, 'prepared'); assert.deepEqual(result.attempt.completed, []);
  fs.unlinkSync(hook); await s.step(first.attempt); await s.step(first.attempt);
  s.state.prs[0].body += '\nNew human instructions.';
  await assert.rejects(s.step(first.attempt), /PR changed since preparation/);
  assert.match(s.state.prs[0].body, /New human instructions/); assert.deepEqual(s.state.mutations, []);
});

test('attachment receipts require new distinct asset links and unsupported uploads stop before mutation', async t => {
  const s = await setup(t, { existing: true });
  const filename = path.join(s.directory, 'capture.png'); fs.writeFileSync(filename, 'fixture-image');
  const attachment = { path: filename, sha256: createHash('sha256').update('fixture-image').digest('hex') };
  s.state.attachmentSupport = false;
  await assert.rejects(s.prepare({ attachments: [attachment] }), /cannot attach images/);
  assert.equal(s.state.mutations.length, 0);
  s.state.attachmentSupport = true;
  const first = await s.prepare({ attachments: [attachment] });
  await s.step(first.attempt); await s.step(first.attempt);
  assert.equal((await s.step(first.attempt)).attempt.state, 'uncertain');
  assert.equal(s.store.get(s.task.id).task.publications[0].receipts.pr, undefined);
  s.state.prs[0].body += '\n![Capture](https://github.com/user-attachments/assets/new-upload)';
  const result = await s.store.publication.reconcile({ ...s.args(), attemptId: first.attempt.id });
  assert.equal(result.attempt.state, 'complete'); assert.equal(result.attempt.receipts.pr.result.assets.length, 2);
});
