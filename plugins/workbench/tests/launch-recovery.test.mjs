import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, registered, checkpoint, threadId, otherThread } from './fixtures.mjs';

const resolution = launch => ({ requestId: launch.id, expectedState: launch.state, expectedUpdatedAt: launch.updatedAt, confirmedNotDelivered: true });

test('every unresolved state requires fresh explicit confirmation and permits a separate normal attempt', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const task = await registered(sample);
  for (const state of ['prepared', 'dispatching', 'queued', 'sent', 'uncertain']) {
    const first = await sample.store.prepareLaunch({ taskId: task.id, autopilot: true });
    if (['dispatching', 'queued', 'sent'].includes(state)) await sample.store.claimLaunch(first.launch.id);
    if (state === 'queued') await sample.store.finishLaunch({ requestId: first.launch.id, state, clientThreadId: 'pending-native-id' });
    if (state === 'sent') await sample.store.finishLaunch({ requestId: first.launch.id, state, threadId });
    if (state === 'uncertain') await sample.store.deliveryUncertain(first.launch.id);
    const current = sample.store.launchGet(first.launch.id).launch;
    await assert.rejects(sample.store.resolveLaunch({ ...resolution(current), confirmedNotDelivered: false }), /Check that/);
    await assert.rejects(sample.store.resolveLaunch({ ...resolution(current), expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }), /changed/);
    const resolved = await sample.store.resolveLaunch(resolution(current));
    assert.equal(resolved.state, 'failed'); assert.equal(resolved.resolution.previousState, state);
    await assert.rejects(sample.store.resolveLaunch(resolution(current)), /already confirmed or resolved/);
    const retry = await sample.store.prepareLaunch({ taskId: task.id });
    assert.notEqual(retry.launch.id, first.launch.id); assert.equal(retry.launch.autopilot, false);
    await sample.store.resolveLaunch(resolution(retry.launch));
  }
});

test('worker acceptance wins a recovery race and late native acknowledgements remain idempotent', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  let task = await registered(sample);
  const first = await sample.store.prepareLaunch({ taskId: task.id }); await sample.store.claimLaunch(first.launch.id);
  const stale = sample.store.launchGet(first.launch.id).launch;
  task = await checkpoint(sample.store, task);
  await assert.rejects(sample.store.resolveLaunch(resolution(stale)), /already confirmed or resolved/);
  assert.equal((await sample.store.finishLaunch({ requestId: first.launch.id, state: 'sent', threadId })).state, 'accepted');
  const second = await sample.store.prepareLaunch({ taskId: task.id }); await sample.store.claimLaunch(second.launch.id);
  await sample.store.resolveLaunch(resolution(sample.store.launchGet(second.launch.id).launch));
  await checkpoint(sample.store, task);
  assert.equal(sample.store.launchGet(second.launch.id).launch.state, 'accepted');
});

test('an exact new-worker request can confirm a launch after recovery without consuming another request', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const task = await registered(sample);
  const first = await sample.store.prepareLaunch({ taskId: task.id, continuation: true });
  await sample.store.claimLaunch(first.launch.id);
  await sample.store.resolveLaunch(resolution(sample.store.launchGet(first.launch.id).launch));
  const worker = await sample.store.register({ repositoryId: task.repositoryId, key: task.key, title: task.title, threadId: otherThread, checkout: sample.repo, requestId: first.launch.id });
  assert.equal(worker.threadId, otherThread);
  assert.equal(sample.store.launchGet(first.launch.id).launch.state, 'accepted');
});

test('a late recovered request cannot take ownership from a newer confirmed worker', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const task = await registered(sample);
  const first = await sample.store.prepareLaunch({ taskId: task.id, continuation: true });
  await sample.store.claimLaunch(first.launch.id);
  await sample.store.resolveLaunch(resolution(sample.store.launchGet(first.launch.id).launch));
  const second = await sample.store.prepareLaunch({ taskId: task.id, continuation: true });
  await sample.store.claimLaunch(second.launch.id);
  await sample.store.register({ repositoryId: task.repositoryId, key: task.key, title: task.title, threadId: otherThread, checkout: sample.repo, requestId: second.launch.id });
  await assert.rejects(sample.store.register({ repositoryId: task.repositoryId, key: task.key, title: task.title, threadId: '32345678-1234-4123-8123-123456789abc', checkout: sample.repo, requestId: first.launch.id }), /ownership/);
  assert.equal(sample.store.get(task.id).task.threadId, otherThread);
});
