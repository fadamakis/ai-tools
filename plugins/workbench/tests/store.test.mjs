import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BoardStore } from '../server/store.mjs';
import { fixture, registered, checkpoint, threadId, otherThread } from './fixtures.mjs';

function setup(t, options) { const sample = fixture(options); t.after(sample.cleanup); return sample; }
const pr = values => ({ url: 'https://github.com/example/repository/pull/123', title: 'EX-123: Imported task', headRefName: 'ex-123', state: 'OPEN', mergedAt: null, headRefOid: 'a'.repeat(40), reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', statusCheckRollup: [], ...values });

test('imports old notes idempotently, keeps them unverified and never writes to them', async t => {
  const sample = setup(t), original = fs.readFileSync(sample.legacyNote);
  const result = (await sample.store.addRepository(sample.repo));
  assert.equal(result.imported, 1); assert.equal((await sample.store.addRepository(sample.repo)).imported, 0);
  const card = sample.store.list().tasks[0]; assert.equal(card.status, 'unverified'); assert.equal(card.stage, 'pr');
  const detail = sample.store.get(card.id); assert.equal(detail.noteIsLegacy, true); assert.match(detail.note, /Old evidence/);
  assert.match(card.notePath, /workbench-preview\/EX-123\.md$/);
  const task = (await registered(sample)); (await checkpoint(sample.store, task));
  assert.deepEqual(fs.readFileSync(sample.legacyNote), original); assert.equal(fs.existsSync(card.notePath), false);
  assert.equal(new BoardStore({ root: sample.root }).get(card.id).task.stage, 'build');
});

test('import reconciliation recovers merged tasks, titles and branches without changing original notes or IDs', async t => {
  const sample = setup(t, { prReader: async () => pr({ state: 'MERGED', mergedAt: '2026-10-19T12:00:00Z' }) });
  const original = fs.readFileSync(sample.legacyNote), { repository } = (await sample.store.addRepository(sample.repo));
  const imported = sample.store.list().tasks[0];
  assert.deepEqual(await sample.store.reconcileImported(repository.id), { checked: 1, unverified: 0 });
  const task = sample.store.get(imported.id).task;
  assert.equal(task.stage, 'done'); assert.equal(task.status, 'complete'); assert.equal(task.title, 'EX-123: Imported task');
  assert.equal(task.branch, 'ex-123'); assert.match(task.nextAction, /No further action/);
  assert.deepEqual(await sample.store.reconcileImported(repository.id), { checked: 0, unverified: 0 });
  assert.equal(sample.store.list().tasks.length, 1); assert.deepEqual(fs.readFileSync(sample.legacyNote), original);
});

test('import reconciliation puts open and closed PRs in PR and never invents a merge', async t => {
  let remote = pr({ statusCheckRollup: [{ conclusion: 'SUCCESS' }] });
  const sample = setup(t, { prReader: () => remote }), { repository } = (await sample.store.addRepository(sample.repo));
  await sample.store.reconcileImported(repository.id);
  const task = sample.store.list().tasks[0]; assert.equal(task.stage, 'pr'); assert.equal(task.status, 'waiting');
  remote = pr({ state: 'CLOSED' });
  assert.equal((await sample.store.refreshPr(task.id)).status, 'paused'); assert.equal(sample.store.get(task.id).task.stage, 'pr');
  remote = pr({ state: 'MERGED', mergedAt: null });
  assert.equal((await sample.store.refreshPr(task.id)).stage, 'pr');
});

test('unavailable GitHub and dependency PRs stay unverified and can be retried', async t => {
  let remote;
  const sample = setup(t, { prReader: () => { if (!remote) throw new Error('offline'); return remote; } });
  const { repository } = (await sample.store.addRepository(sample.repo));
  assert.deepEqual(await sample.store.reconcileImported(repository.id), { checked: 0, unverified: 1 });
  let task = sample.store.list().tasks[0]; assert.equal(task.status, 'unverified'); assert.match(task.importCheck.error, /could not be verified/);
  remote = pr({ title: 'EX-999: A dependency', state: 'MERGED', mergedAt: '2026-10-19T12:00:00Z' });
  assert.deepEqual(await sample.store.reconcileImported(repository.id), { checked: 0, unverified: 1 });
  (await assert.rejects(async () => (await sample.store.refreshPr(task.id)), /does not identify/));
  remote = pr({ state: 'MERGED', mergedAt: '2026-10-19T12:00:00Z' });
  await sample.store.reconcileImported(repository.id); task = sample.store.get(task.id).task;
  assert.equal(task.stage, 'done'); assert.equal(task.importCheck, undefined);
});

test('reconciliation preserves a worker checkpoint that arrives during the PR read', async t => {
  let release;
  const sample = setup(t, { prReader: () => new Promise(resolve => { release = resolve; }) });
  const { repository } = (await sample.store.addRepository(sample.repo)), imported = sample.store.list().tasks[0];
  const pending = sample.store.reconcileImported(repository.id);
  (await checkpoint(sample.store, imported, { stage: 'verify', status: 'blocked', summary: 'Current worker evidence.' }));
  release(pr({ state: 'MERGED', mergedAt: '2026-10-19T12:00:00Z' }));
  await pending;
  const task = sample.store.get(imported.id).task;
  assert.equal(task.stage, 'verify'); assert.equal(task.summary, 'Current worker evidence.'); assert.equal(task.importCheck, undefined);
});

test('imports only direct regular task notes and never follows a symlink', async t => {
  const sample = setup(t); fs.symlinkSync(sample.legacyNote, path.join(path.dirname(sample.legacyNote), 'LINK.md'));
  fs.mkdirSync(path.join(path.dirname(sample.legacyNote), 'verification')); fs.writeFileSync(path.join(path.dirname(sample.legacyNote), 'verification/EX-999.md'), 'nested');
  assert.equal((await sample.store.addRepository(sample.repo)).imported, 1);
});

test('native Git worktrees share one repository identity', async t => {
  const sample = setup(t), worktree = path.join(sample.directory, 'native-worktree');
  const original = (await sample.store.addRepository(sample.repo, false)).repository;
  sample.git('worktree', 'add', '-b', 'isolated', worktree);
  assert.equal((await sample.store.addRepository(worktree, false)).repository.id, original.id);
  const task = (await sample.store.register({ repositoryId: original.id, key: 'EX-1', title: 'Worktree task', checkout: worktree, threadId }));
  assert.equal(task.checkout, worktree); assert.equal(sample.store.list().repositories.length, 1);
});

test('rejects stale writes and another chat cannot take over a task', async t => {
  const sample = setup(t), task = (await registered(sample));
  const changed = (await checkpoint(sample.store, task)); assert.equal(changed.stage, 'build');
  (await assert.rejects(async () => (await checkpoint(sample.store, task)), /another chat/));
  (await assert.rejects(async () => (await checkpoint(sample.store, changed, { threadId: otherThread })), /another chat/));
  (await assert.rejects(async () => (await registered(sample, 'EX-123', otherThread)), /Another chat owns/));
});

test('Done cannot be fabricated by a stage update or an open PR with green checks', async t => {
  const sample = setup(t, { prReader: () => pr({ statusCheckRollup: [{ conclusion: 'SUCCESS' }] }) });
  const task = (await registered(sample));
  (await assert.rejects(async () => (await checkpoint(sample.store, task, { stage: 'done' })), /verified merge/));
  assert.equal((await sample.store.refreshPr(task.id)).stage, 'pr');
  assert.equal(sample.store.get(task.id).task.pr.checks, 'passed');
});

test('only matching, complete GitHub merge evidence reaches Done', async t => {
  const sample = setup(t, { prReader: () => pr({ state: 'MERGED', mergedAt: '2026-10-19T12:00:00Z' }) });
  const task = (await registered(sample)), merged = (await sample.store.refreshPr(task.id));
  assert.equal(merged.stage, 'done'); assert.equal(merged.status, 'complete');
  (await assert.rejects(async () => (await checkpoint(sample.store, merged)), /merged/));
  (await assert.rejects(async () => (await sample.store.prepareLaunch({ taskId: task.id })), /merged/));
});

test('missing, pending, failed and all-skipped checks remain distinct', async t => {
  let checks = []; const sample = setup(t, { prReader: () => pr({ statusCheckRollup: checks }) });
  const task = (await registered(sample));
  assert.equal((await sample.store.refreshPr(task.id)).pr.checks, 'unverified');
  checks = [{ status: 'IN_PROGRESS', conclusion: null }]; assert.equal((await sample.store.refreshPr(task.id)).pr.checks, 'pending');
  checks = [{ conclusion: 'SKIPPED' }]; assert.equal((await sample.store.refreshPr(task.id)).pr.checks, 'unverified');
  checks = [{ conclusion: 'FAILURE' }]; assert.equal((await sample.store.refreshPr(task.id)).status, 'blocked');
});

test('failed or mismatched PR reads preserve earlier evidence', async t => {
  const sample = setup(t, { prReader: () => pr({ url: 'https://github.com/example/other/pull/123' }) });
  const task = (await registered(sample)), before = fs.readFileSync(sample.store.filename);
  (await assert.rejects(async () => (await sample.store.refreshPr(task.id)), /mismatched/));
  assert.deepEqual(fs.readFileSync(sample.store.filename), before);
});

test('Autopilot defaults off and duplicate launches cannot dispatch twice', async t => {
  const sample = setup(t), task = (await registered(sample));
  const first = (await sample.store.prepareLaunch({ taskId: task.id }));
  assert.equal(first.launch.autopilot, false); assert.equal(first.launch.target, 'existing');
  assert.equal(first.launch.threadId, threadId); assert.equal(first.dispatch, true);
  const second = (await sample.store.prepareLaunch({ taskId: task.id, autopilot: true }));
  assert.equal(second.dispatch, false); assert.equal(second.launch.id, first.launch.id); assert.equal(second.launch.autopilot, false);
  (await sample.store.claimLaunch(first.launch.id));
  (await assert.rejects(async () => (await sample.store.claimLaunch(first.launch.id)), /already been claimed/));
});

test('uncertain delivery survives restart and is never automatically resent', async t => {
  const sample = setup(t), task = (await registered(sample)), first = (await sample.store.prepareLaunch({ taskId: task.id }));
  (await sample.store.deliveryUncertain(first.launch.id));
  const reloaded = new BoardStore({ root: sample.root });
  assert.equal(reloaded.launchGet(first.launch.id).launch.state, 'uncertain');
  assert.equal((await reloaded.prepareLaunch({ taskId: task.id })).dispatch, false);
});

test('a confirmed failed launch permits an explicit later attempt with its own checkbox choice', async t => {
  const sample = setup(t), task = (await registered(sample)), first = (await sample.store.prepareLaunch({ taskId: task.id, autopilot: true }));
  (await sample.store.claimLaunch(first.launch.id)); (await sample.store.finishLaunch({ requestId: first.launch.id, state: 'failed', error: 'Chat unavailable.' }));
  const retry = (await sample.store.prepareLaunch({ taskId: task.id }));
  assert.equal(retry.dispatch, true); assert.equal(retry.launch.autopilot, false);
});

test('queued native worktree launches bind the real worker chat without confusing clientThreadId', async t => {
  const sample = setup(t), task = (await registered(sample)), request = (await sample.store.prepareLaunch({ taskId: task.id, continuation: true, environment: 'worktree' }));
  assert.equal(request.launch.target, 'new'); (await sample.store.claimLaunch(request.launch.id));
  (await assert.rejects(async () => (await sample.store.finishLaunch({ requestId: request.launch.id, state: 'sent', clientThreadId: 'pending-id' })), /verified Codex chat ID/));
  (await sample.store.finishLaunch({ requestId: request.launch.id, state: 'queued', clientThreadId: 'pending-id' }));
  const worker = (await registered(sample, task.key, otherThread));
  (await checkpoint(sample.store, worker, { threadId: otherThread }));
  assert.equal(sample.store.launchGet(request.launch.id).launch.state, 'accepted');
  assert.equal(sample.store.get(task.id).task.threadId, otherThread);
});

test('an original-chat checkpoint cannot consume a pending new continuation', async t => {
  const sample = setup(t), task = (await registered(sample)), request = (await sample.store.prepareLaunch({ taskId: task.id, continuation: true, environment: 'worktree' }));
  (await sample.store.claimLaunch(request.launch.id));
  (await sample.store.finishLaunch({ requestId: request.launch.id, state: 'queued', clientThreadId: 'pending-continuation' }));
  (await checkpoint(sample.store, task));
  assert.equal(sample.store.launchGet(request.launch.id).launch.state, 'queued');
  const worker = (await registered(sample, task.key, otherThread));
  (await checkpoint(sample.store, worker, { threadId: otherThread }));
  assert.equal(sample.store.launchGet(request.launch.id).launch.state, 'accepted');
  assert.equal(sample.store.get(task.id).task.threadId, otherThread);
});

test('new-worker registration binds delivery before its first checkpoint and survives a late native acknowledgement', async t => {
  const sample = setup(t), task = (await registered(sample)), request = (await sample.store.prepareLaunch({ taskId: task.id, continuation: true }));
  (await sample.store.claimLaunch(request.launch.id));
  (await registered(sample, task.key, otherThread));
  assert.equal(sample.store.launchGet(request.launch.id).launch.state, 'accepted');
  assert.equal((await sample.store.prepareLaunch({ taskId: task.id })).dispatch, true);
  assert.equal((await sample.store.finishLaunch({ requestId: request.launch.id, state: 'sent', threadId: otherThread })).state, 'accepted');
  (await assert.rejects(async () => (await registered(sample, task.key, '32345678-1234-4123-8123-123456789abc')), /Another chat owns/));
});

test('a resume acknowledgement cannot replace the original task owner with another chat', async t => {
  const sample = setup(t), task = (await registered(sample)), request = (await sample.store.prepareLaunch({ taskId: task.id }));
  (await sample.store.claimLaunch(request.launch.id));
  const before = fs.readFileSync(sample.store.filename);
  (await assert.rejects(async () => (await sample.store.finishLaunch({ requestId: request.launch.id, state: 'sent', threadId: otherThread })), /different chat/));
  assert.deepEqual(fs.readFileSync(sample.store.filename), before);
});

test('worker startup racing a creation acknowledgement preserves accepted delivery', async t => {
  const sample = setup(t), task = (await registered(sample)), request = (await sample.store.prepareLaunch({ taskId: task.id }));
  (await sample.store.claimLaunch(request.launch.id)); (await checkpoint(sample.store, task));
  assert.equal((await sample.store.finishLaunch({ requestId: request.launch.id, state: 'sent', threadId })).state, 'accepted');
});

test('unknown saved schemas are rejected without replacing the data', async t => {
  const sample = setup(t); fs.writeFileSync(sample.store.filename, JSON.stringify({ schemaVersion: 99, secretToPreserve: 'retained' }));
  const before = fs.readFileSync(sample.store.filename);
  assert.throws(() => sample.store.list(), /compatible/); (await assert.rejects(async () => (await sample.store.addRepository(sample.repo)), /compatible/));
  assert.deepEqual(fs.readFileSync(sample.store.filename), before);
});

test('concurrent worker revisions produce one winner without losing its record', async t => {
  const sample = setup(t), task = (await registered(sample));
  const module = new URL('../server/store.mjs', import.meta.url).href;
  const input = { taskId: task.id, expectedRevision: task.revision, stage: 'verify', status: 'paused', summary: 'concurrent checkpoint', nextAction: 'Review', threadId };
  const child = () => new Promise((resolve, reject) => {
    const code = `import {BoardStore} from ${JSON.stringify(module)}; try {await new BoardStore({root:${JSON.stringify(sample.root)}}).progress(${JSON.stringify(input)});process.exitCode=0;}catch {process.exitCode=2;}`;
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' });
    process.on('error', reject); process.on('exit', resolve);
  });
  assert.deepEqual((await Promise.all([child(), child()])).sort(), [0, 2]);
  assert.equal(sample.store.get(task.id).task.revision, task.revision + 1);
});

test('archiving a verified Done task is reversible and preserves notes, PR evidence and chat ownership across restart', async t => {
  const sample = setup(t, { prReader: () => pr({ state: 'MERGED', mergedAt: '2026-10-19T12:00:00Z' }) });
  const task = (await registered(sample)), merged = (await sample.store.refreshPr(task.id)), note = fs.readFileSync(sample.legacyNote);
  const archived = (await sample.store.archiveTasks([{ taskId: task.id, expectedRevision: merged.revision }])).tasks[0];
  assert.ok(archived.archivedAt); assert.equal(archived.id, task.id); assert.equal(archived.threadId, threadId); assert.deepEqual(archived.pr, merged.pr);
  const restarted = new BoardStore({ root: sample.root }); assert.equal(restarted.get(task.id).task.archivedAt, archived.archivedAt);
  assert.equal((await restarted.addRepository(sample.repo)).imported, 0); assert.ok(restarted.get(task.id).task.archivedAt);
  const restored = (await restarted.archiveTasks([{ taskId: task.id, expectedRevision: archived.revision }], false)).tasks[0];
  assert.equal(restored.archivedAt, undefined); assert.equal(restored.stage, 'done'); assert.equal(restored.id, task.id); assert.equal(restored.threadId, threadId);
  assert.deepEqual(fs.readFileSync(sample.legacyNote), note);
});

test('a bulk archive is atomic when a selected task is unfinished or changed', async t => {
  const sample = setup(t, { prReader: () => pr({ state: 'MERGED', mergedAt: '2026-10-19T12:00:00Z' }) });
  const first = (await registered(sample)), merged = (await sample.store.refreshPr(first.id)), unfinished = (await registered(sample, 'EX-124'));
  const before = fs.readFileSync(sample.store.filename);
  const selected = [{ taskId: merged.id, expectedRevision: merged.revision }, { taskId: unfinished.id, expectedRevision: unfinished.revision }];
  (await assert.rejects(async () => (await sample.store.archiveTasks(selected)), /verified merge/)); assert.deepEqual(fs.readFileSync(sample.store.filename), before);
  (await assert.rejects(async () => (await sample.store.archiveTasks([{ taskId: merged.id, expectedRevision: merged.revision - 1 }])), /changed/));
  (await assert.rejects(async () => (await sample.store.archiveTasks([selected[0], selected[0]])), /unique/));
  assert.deepEqual(fs.readFileSync(sample.store.filename), before);
});

test('bulk archive and restore retain every completed record and launch history', async t => {
  const sample = setup(t, { prReader: () => pr({ state: 'MERGED', mergedAt: '2026-10-19T12:00:00Z' }) });
  const first = (await registered(sample)), launch = (await sample.store.prepareLaunch({ taskId: first.id }));
  (await sample.store.claimLaunch(launch.launch.id)); (await sample.store.finishLaunch({ requestId: launch.launch.id, state: 'failed', error: 'No chat created.' }));
  const second = (await registered(sample, 'EX-124')); (await checkpoint(sample.store, second, { prUrl: pr().url }));
  const completed = (await Promise.all([first, second].map(async task => (await sample.store.refreshPr(task.id)))));
  const launches = sample.store.read().launches;
  const archived = (await sample.store.archiveTasks(completed.map(task => ({ taskId: task.id, expectedRevision: task.revision })))).tasks;
  assert.equal(sample.store.list().tasks.filter(task => task.archivedAt).length, 2); assert.deepEqual(sample.store.read().launches, launches);
  (await sample.store.archiveTasks(archived.map(task => ({ taskId: task.id, expectedRevision: task.revision })), false));
  assert.equal(sample.store.list().tasks.length, 2); assert.equal(sample.store.list().tasks.some(task => task.archivedAt), false);
});

test('repository errors provide recovery copy and optional diagnostics without saving an invalid path', async t => {
  const sample = setup(t), before = fs.existsSync(sample.store.filename);
  (await assert.rejects(async () => (await sample.store.addRepository(path.join(sample.directory, 'missing'))), error => /folder is unavailable/.test(error.message) && /ENOENT/.test(error.details)));
  const ordinary = path.join(sample.directory, 'ordinary'); fs.mkdirSync(ordinary);
  (await assert.rejects(async () => (await sample.store.addRepository(ordinary)), error => /not a Git repository/.test(error.message) && /fatal/.test(error.details)));
  assert.equal(fs.existsSync(sample.store.filename), before);
});
