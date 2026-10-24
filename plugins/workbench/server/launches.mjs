import { randomUUID } from 'node:crypto';
import { unresolvedLaunchStates } from '../shared/launch-states.mjs';
const now = () => new Date().toISOString();
const touch = launch => { launch.updatedAt = new Date(Math.max(Date.now(), Date.parse(launch.updatedAt) + 1)).toISOString(); };

export function taskKey(value) {
  const ticket = value.match(/\b[A-Z][A-Z0-9]+-\d+\b/);
  return ticket?.[0] || value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'task';
}

export class LaunchLifecycle {
  constructor(store) { this.store = store; }

  async prepareLaunch({ taskId, repositoryId, title, environment = 'local', autopilot = false, continuation = false }) {
    return this.store.mutate(data => {
      const task = taskId ? this.store.task(data, taskId) : this.store.makeTask(data, repositoryId, taskKey(title), title);
      if (task.stage === 'done') throw new Error('This task is merged. Start a separate task.');
      const existing = data.launches.find(item => item.taskId === task.id && unresolvedLaunchStates.includes(item.state));
      if (existing) return { launch: existing, task: { key: task.key, title: task.title }, dispatch: false };
      const repository = this.store.repository(data, task.repositoryId);
      const launch = { id: randomUUID(), taskId: task.id, repositoryId: repository.id, ownerThreadId: task.threadId || null, autopilot, environment, continuation, target: task.threadId && !continuation ? 'existing' : 'new', ...(task.threadId && !continuation ? { threadId: task.threadId } : {}), state: 'prepared', createdAt: now(), updatedAt: now() };
      data.launches.push(launch);
      return { launch, task: { key: task.key, title: task.title }, dispatch: true };
    });
  }

  launchGet(id) {
    const data = this.store.read(), launch = data.launches.find(item => item.id === id);
    if (!launch) throw new Error('Unknown board launch.');
    return { launch, task: this.store.task(data, launch.taskId), repository: this.store.repository(data, launch.repositoryId) };
  }

  async claimLaunch(id) {
    return this.store.mutate(data => {
      const launch = data.launches.find(item => item.id === id);
      if (!launch || launch.state !== 'prepared') throw new Error('This launch has already been claimed. Check its saved state; do not send it again.');
      launch.state = 'dispatching'; touch(launch); return launch;
    });
  }

  async finishLaunch({ requestId, state, threadId, clientThreadId, error }) {
    return this.store.mutate(data => {
      const launch = data.launches.find(item => item.id === requestId);
      if (launch?.state === 'accepted' && (launch.threadId === threadId || state === 'queued')) return launch;
      if (!launch || !['dispatching', 'queued'].includes(launch.state)) throw new Error('This launch is not awaiting a delivery result.');
      if (state === 'sent' && !threadId) throw new Error('A delivered launch requires the verified Codex chat ID.');
      if (threadId && launch.threadId && launch.threadId !== threadId) throw new Error('The delivery result identifies a different chat than this launch.');
      if (state === 'queued' && !clientThreadId) throw new Error('A queued worktree launch requires its native clientThreadId.');
      const task = this.store.task(data, launch.taskId);
      if (launch.target === 'new' && Object.hasOwn(launch, 'ownerThreadId') && launch.ownerThreadId !== (task.threadId || null) && task.threadId !== threadId) throw new Error('Another chat confirmed ownership after this launch. Check its delivery before continuing.');
      Object.assign(launch, { state, ...(threadId ? { threadId } : {}), ...(clientThreadId ? { clientThreadId } : {}), ...(error ? { error } : {}) });
      touch(launch);
      if (threadId && state === 'sent') { task.threadId = threadId; task.updatedAt = now(); task.revision++; }
      return launch;
    });
  }

  async deliveryUncertain(id) {
    return this.store.mutate(data => {
      const launch = data.launches.find(item => item.id === id);
      if (launch?.state === 'prepared') { launch.state = 'uncertain'; touch(launch); launch.error = 'Codex did not confirm receipt. Check the board chat before trying again.'; }
      return launch;
    });
  }

  async resolveLaunch({ requestId, expectedState, expectedUpdatedAt, confirmedNotDelivered }) {
    if (confirmedNotDelivered !== true) throw new Error('Check that this request was not delivered before releasing it.');
    return this.store.mutate(data => {
      const launch = data.launches.find(item => item.id === requestId);
      if (!launch || !unresolvedLaunchStates.includes(launch.state)) throw new Error('This request is already confirmed or resolved. Refresh the board.');
      if (launch.state !== expectedState || launch.updatedAt !== expectedUpdatedAt) throw new Error('This request changed. Refresh and check delivery again before releasing it.');
      const resolution = { kind: 'not_delivered', previousState: launch.state, previousUpdatedAt: launch.updatedAt, ...(launch.error ? { previousError: launch.error } : {}) };
      launch.state = 'failed'; touch(launch);
      launch.resolution = { ...resolution, resolvedAt: launch.updatedAt };
      launch.error = 'You confirmed this request was not delivered. Start or resume again when ready.';
      return launch;
    });
  }

  bindWorker(data, task, threadId, requestId) {
      const requested = requestId && data.launches.find(item => item.id === requestId);
      if (requestId && (!requested || requested.taskId !== task.id || requested.threadId && requested.threadId !== threadId)) throw new Error('The worker does not match its board launch.');
      const workerLaunch = data.launches.find(item => item.taskId === task.id && item.target === 'new' && (!requestId || item.id === requestId) && (['dispatching', 'queued', 'sent', 'uncertain'].includes(item.state) || requestId && item.state === 'failed' && item.resolution?.kind === 'not_delivered') && (!item.threadId || item.threadId === threadId));
      if (workerLaunch && Object.hasOwn(workerLaunch, 'ownerThreadId') && workerLaunch.ownerThreadId !== (task.threadId || null) && task.threadId !== threadId) throw new Error('Another chat already confirmed ownership after this launch.');
      if (requested?.target === 'new' && !workerLaunch && !(requested.state === 'accepted' && requested.threadId === threadId)) throw new Error('This new-chat request cannot confirm a worker in its current state.');
      if (threadId && task.threadId && threadId !== task.threadId) {
        if (!workerLaunch) throw new Error('Another chat owns this task. Use an explicit new-continuation launch before binding it.');
      }
      // A new worker's registration confirms delivery even before its first
      // checkpoint. The previous owner must never accept that new launch.
      if (threadId && workerLaunch && (!task.threadId || task.threadId !== threadId || workerLaunch.threadId === threadId)) {
        workerLaunch.state = 'accepted'; workerLaunch.threadId = threadId; touch(workerLaunch);
      }
      if (threadId) task.threadId = threadId;
  }

  acceptCheckpoint(data, task, threadId) {
      for (const launch of data.launches.filter(item => item.taskId === task.id && (['sent', 'queued', 'dispatching', 'uncertain'].includes(item.state) || item.target === 'existing' && item.state === 'failed' && item.resolution?.kind === 'not_delivered' && item.threadId === threadId))) {
        if (launch.target === 'new' && launch.threadId !== threadId) continue;
        if (launch.threadId && launch.threadId !== threadId) continue;
        launch.state = 'accepted'; launch.threadId = threadId; touch(launch);
      }
  }
}
