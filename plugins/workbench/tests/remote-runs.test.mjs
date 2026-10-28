import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, registered } from './fixtures.mjs';
import { RemoteRuns, decodeCheckpoint } from '../server/remote-runs.mjs';

const runUrl = 'https://github.com/example/repository/actions/runs/100';
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const checkpoint = values => ({ schemaVersion: 1, status: 'review_ready', currentHeadSha: head, workflowRunUrl: runUrl, issueKey: 'EX-123', ...values });
const comment = (state, values = {}) => ({ id: 77, user: { id: 42, type: 'Bot' }, body: `<!-- claude-autopilot -->\n<!-- claude-autopilot-state:v1 ${Buffer.from(JSON.stringify(state)).toString('base64url')} -->`, ...values });

async function setup(t) {
  const s = fixture({ legacy: false }); t.after(s.cleanup); const task = await registered(s);
  const state = { comment: comment(checkpoint()), offline: false, prHead: head, attempt: 1, requests: [] };
  const read = async (endpoint, options) => {
    state.requests.push([endpoint, options]); if (state.offline) throw new Error('403');
    if (endpoint.includes('/actions/runs/')) return { id: 100, run_attempt: state.attempt, workflow_id: 5, repository: { full_name: 'example/repository' }, head_repository: { full_name: 'example/repository' }, path: '.github/workflows/automation.yml', head_sha: base, status: 'completed', conclusion: 'success', pull_requests: [] };
    if (endpoint.includes('/actions/workflows/')) return { path: '.github/workflows/automation.yml' };
    if (endpoint.includes('/pulls/')) return { head: { ref: 'claude-EX-123', sha: state.prHead, repo: { full_name: 'example/repository' } }, base: { sha: base, repo: { full_name: 'example/repository' } } };
    if (endpoint.includes('/comments')) return [[state.comment], []];
    throw new Error('Unexpected read');
  };
  s.store.remoteRuns = new RemoteRuns(s.store, { read, identity: async () => 'example/repository' });
  const args = () => ({ taskId: task.id, expectedRevision: s.store.get(task.id).task.revision });
  const bind = values => s.store.remoteRuns.bind({ ...args(), runUrl, workflowPath: '.github/workflows/automation.yml', botId: 42, prUrl: 'https://github.com/example/repository/pull/123', ...values });
  return { ...s, task, state, args, bind };
}

test('only a configured bot with supported structured state supplies a checkpoint', () => {
  assert.equal(decodeCheckpoint(comment(checkpoint()), 42).status, 'review_ready');
  assert.equal(decodeCheckpoint(comment(checkpoint()), 99), undefined);
  assert.equal(decodeCheckpoint(comment(checkpoint(), { user: { id: 42, type: 'User' } }), 42), undefined);
  assert.equal(decodeCheckpoint(comment(checkpoint({ schemaVersion: 99 })), 42), undefined);
});
test('a dispatch run associates its PR through trusted structured evidence without completing local work', async t => {
  const s = await setup(t), before = s.store.get(s.task.id).task;
  const result = await s.bind();
  assert.equal(result.task.remoteRun.observation.checkpointStatus, 'verified');
  assert.equal(result.task.remoteRun.observation.implementationHead, head);
  assert.equal(result.task.stage, before.stage); assert.equal(result.task.threadId, before.threadId);
  assert.deepEqual(result.task.evidenceChecks, before.evidenceChecks);
  assert.equal(s.state.requests.some(([endpoint]) => endpoint.includes('dispatch')), false);
  const count = s.state.requests.length; s.store.list(); s.store.get(s.task.id); assert.equal(s.state.requests.length, count);
});
test('access failure preserves the previous observation; moved heads and unknown schemas remain explicit', async t => {
  const s = await setup(t); const first = await s.bind(); s.state.offline = true;
  let result = await s.store.remoteRuns.refresh(s.args());
  assert.deepEqual(result.task.remoteRun.observation, JSON.parse(JSON.stringify(first.task.remoteRun.observation))); assert.match(result.task.remoteRun.error, /unavailable/);
  s.state.offline = false; s.state.prHead = 'c'.repeat(40);
  result = await s.store.remoteRuns.refresh(s.args()); assert.equal(result.task.remoteRun.observation.checkpointStatus, 'stale');
  s.state.comment = comment(checkpoint({ schemaVersion: 2 }));
  result = await s.store.remoteRuns.refresh(s.args()); assert.equal(result.task.remoteRun.observation.checkpointStatus, 'unverified');
  result = await s.store.remoteRuns.unbind(s.args()); assert.equal(result.task.remoteRun, undefined); assert.equal(result.task.stage, first.task.stage);
});
test('mismatched workflows and run identities never provide verified remote evidence', async t => {
  const s = await setup(t);
  assert.ok((await s.bind({ workflowPath: '.github/workflows/other.yml' })).task.remoteRun.error);
  s.state.comment = comment(checkpoint({ workflowRunUrl: runUrl.replace('/100', '/101') }));
  assert.ok((await s.bind()).task.remoteRun.error);
  await assert.rejects(s.bind({ runUrl: 'https://github.com/other/repository/actions/runs/100' }), /task repository/);
});
test('workflow dispatch without a known PR and reruns without attempt-bound state remain unverified', async t => {
  const s = await setup(t); let result = await s.bind({ prUrl: undefined });
  assert.equal(result.task.remoteRun.observation.checkpointStatus, 'unverified');
  s.state.attempt = 2; result = await s.bind(); assert.equal(result.task.remoteRun.observation.checkpointStatus, 'unverified');
});

test('checkpoint attempts must agree with every explicitly observed attempt', async t => {
  const s = await setup(t);
  for (const values of [{ workflowRunUrl: `${runUrl}/attempts/2` }, { workflowRunAttempt: 2 }, { workflowRunUrl: `${runUrl}/attempts/1`, workflowRunAttempt: 2 }]) {
    s.state.comment = comment(checkpoint(values));
    assert.equal((await s.bind({ runUrl: `${runUrl}/attempts/1` })).task.remoteRun.observation.checkpointStatus, 'unverified');
  }
  s.state.attempt = 2;
  s.state.comment = comment(checkpoint({ workflowRunUrl: `${runUrl}/attempts/2` }));
  assert.equal((await s.bind({ runUrl: `${runUrl}/attempts/2` })).task.remoteRun.observation.checkpointStatus, 'verified');
});
