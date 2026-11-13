import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardController, launchMessage } from '../app/controller.mjs';
import { taskAction, currentLaunches, cardNextAction, taskStatus } from '../app/presentation.mjs';
import { fixture, registered, threadId, otherThread } from './fixtures.mjs';

test('saved task states expose a useful action without requiring the user to diagnose the workflow', () => {
  const task = { id: 'task', key: 'EX-123', threadId, stage: 'pr', status: 'waiting' };
  assert.equal(taskAction({ ...task, status: 'blocked' }).label, 'Recheck blocker');
  assert.equal(taskAction({ ...task, pr: { state: 'MERGED', checks: 'failed' } }).label, 'Confirm delivery');
  assert.equal(taskStatus({ ...task, pr: { state: 'MERGED' } }), 'Merged · confirm delivery');
  assert.match(cardNextAction({ ...task, pr: { state: 'MERGED' }, nextAction: 'Wait for CI.' }), /PR merged/);
  assert.equal(taskAction(task).label, 'Check and continue');
  for (const status of ['active', 'paused', 'unverified']) assert.equal(taskAction({ ...task, status }).label, 'Recover and resume');
  assert.equal(taskAction({ ...task, threadId: undefined }).kind, 'launch');
  assert.equal(taskAction({ ...task, stage: 'done' }).label, 'Archive task');
  assert.equal(taskAction({ ...task, stage: 'done', archivedAt: '2026-01-01' }).label, 'Restore to Done');
  const blocked = { ...task, status: 'blocked', nextAction: 'An admin must supply a safe test account.' };
  assert.equal(cardNextAction(blocked), blocked.nextAction);
  const paused = { ...task, status: 'paused', pause: { kind: 'user' }, pr: { state: 'MERGED' }, nextAction: 'Wait for my review.' };
  assert.equal(cardNextAction(paused), 'Wait for my review.');
  assert.equal(taskStatus(paused), 'Paused');
  assert.equal(taskAction(paused).label, 'Recover and resume');
});

test('pending receipts and freshly running workers take precedence; stale activity permits a recovery check only', () => {
  const at = Date.now(), task = { id: 'task', key: 'EX-123', threadId, stage: 'build', status: 'active' };
  const worker = { state: 'running', taskKey: task.key, threadId, observedAt: new Date(at).toISOString() };
  assert.equal(taskAction({ ...task, reconciliation: { worker } }, [], at).kind, 'chat');
  assert.equal(taskAction({ ...task, reconciliation: { worker: { ...worker, observedAt: '2020-01-01' } } }, [], at).kind, 'recover');
  assert.equal(taskAction({ ...task, reconciliation: { worker: { ...worker, threadId: otherThread } } }, [], at).kind, 'recover');
  const launch = { taskId: task.id, state: 'uncertain' };
  assert.deepEqual(taskAction(task, [launch]), { kind: 'request', label: 'Review request', launch });
});

test('old failed handoffs remain in history without displacing newer worker progress on the board', () => {
  const task = { id: 'task', threadId, stage: 'plan', checkpointAt: '2026-10-28T21:00:00Z' };
  const historical = { id: 'old', taskId: task.id, state: 'failed', updatedAt: '2026-10-28T19:00:00Z' };
  const unresolved = { ...historical, id: 'pending', state: 'uncertain' };
  assert.deepEqual(currentLaunches([task], [historical]), []);
  assert.deepEqual(currentLaunches([task], [historical, unresolved]), [unresolved]);
  assert.equal(historical.state, 'failed');
  assert.deepEqual(currentLaunches([{ ...task, threadId: undefined }], [historical]), [historical]);
});

test('recovery prepares one editable draft in the active chat while preserving worker ownership and context', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const task = await registered(sample), messages = [];
  const before = sample.store.get(task.id).task;
  const app = { addEventListener() {}, callServerTool: async request => ({ structuredContent: request.name === 'workbench.launch_prepare' ? await sample.store.prepareLaunch(request.arguments) : sample.store.list() }) };
  const vm = new BoardController(app, { message: { send: async message => messages.push(message) } }, {});
  await vm.recover(task);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]._meta['openai/message'], { target: 'active', send: false });
  assert.match(messages[0].content[0].text, /Recover and resume task "EX-123"/);
  assert.match(messages[0].content[0].text, /Recheck blockers; do not assume they are fixed/);
  assert.match(messages[0].content[0].text, /Do not create another chat/);
  assert.match(messages[0].content[0].text, /Autopilot is off/);
  assert.deepEqual(sample.store.get(task.id).task, before);
  const launch = sample.store.get(task.id).launches[0];
  assert.equal(launch.target, 'existing'); assert.equal(launch.threadId, threadId); assert.equal(launch.state, 'prepared');
  await vm.recover(task);
  assert.equal(messages.length, 1);
  assert.equal(sample.store.get(task.id).launches.length, 1);
});

test('a no-dispatch recovery has a terminal receipt and cannot be claimed again', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const task = await registered(sample), before = sample.store.get(task.id).task;
  const { launch } = await sample.store.prepareLaunch({ taskId: task.id, delivery: 'recovery' });
  await sample.store.claimLaunch(launch.id);
  await sample.store.finishLaunch({ requestId: launch.id, state: 'resolved' });
  assert.equal(sample.store.launchGet(launch.id).launch.state, 'resolved');
  assert.deepEqual(sample.store.get(task.id).task, before);
  await assert.rejects(sample.store.claimLaunch(launch.id), /already been claimed/);
  assert.equal((await sample.store.prepareLaunch({ taskId: task.id, delivery: 'recovery' })).dispatch, true);
});

test('recovery sends retain the checkpoint timestamp and cannot change owner or create a worker', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const task = await registered(sample), before = sample.store.get(task.id).task;
  const { launch } = await sample.store.prepareLaunch({ taskId: task.id, delivery: 'recovery' });
  await sample.store.claimLaunch(launch.id);
  await assert.rejects(sample.store.finishLaunch({ requestId: launch.id, state: 'sent', threadId: otherThread }), /different chat/);
  await assert.rejects(sample.store.finishLaunch({ requestId: launch.id, state: 'queued', clientThreadId: 'queued' }), /exact owning chat/);
  await sample.store.finishLaunch({ requestId: launch.id, state: 'sent', threadId });
  assert.deepEqual(sample.store.get(task.id).task, before);
  await assert.rejects(sample.store.prepareLaunch({ taskId: task.id, delivery: 'recovery', continuation: true }), /existing task/);
  const unbound = await sample.store.mutate(data => sample.store.makeTask(data, task.repositoryId, 'EX-124', 'Another task'));
  await assert.rejects(sample.store.prepareLaunch({ taskId: unbound.id, delivery: 'recovery' }), /saved worker/);
});

test('an ownership race is rejected before a recovery can dispatch', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const task = await registered(sample);
  const { launch } = await sample.store.prepareLaunch({ taskId: task.id, delivery: 'recovery' });
  await sample.store.mutate(data => { sample.store.task(data, task.id).threadId = otherThread; });
  await assert.rejects(sample.store.claimLaunch(launch.id), /owning chat changed/);
  assert.equal(sample.store.launchGet(launch.id).launch.state, 'prepared');
  assert.match(launchMessage({ ...launch, autopilot: true }, task), /Autopilot is on/);
});
