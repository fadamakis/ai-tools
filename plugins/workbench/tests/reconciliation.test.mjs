import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server/index.mjs';
import { BoardStore } from '../server/store.mjs';
import { Reconciliation } from '../server/reconciliation.mjs';
import { fixture, registered, checkpoint, threadId, otherThread } from './fixtures.mjs';

const prUrl = 'https://github.com/example/repository/pull/123';
const artifactUrl = 'https://example.invalid/artifacts/EX-123';
const artifactDigest = 'c'.repeat(64);
const iso = value => new Date(value).toISOString();
const mergedPr = (at, values = {}) => ({ url: prUrl, title: 'EX-123: Complete accepted scope', headRefName: 'ex-123', state: 'MERGED', mergedAt: iso(at), headRefOid: 'a'.repeat(40), reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', statusCheckRollup: [{ conclusion: 'SUCCESS' }], ...values });

async function setup(t, { prReader, status = 'blocked', pr = true, requirements = true, initialPrState = 'MERGED', ...values } = {}) {
  let at = Date.now() + 1000;
  let prState = initialPrState;
  const sample = fixture({ legacy: false, prReader: prReader || (() => mergedPr(at, { state: prState, mergedAt: prState === 'MERGED' ? iso(at) : null })) });
  t.after(sample.cleanup);
  sample.store.reconciliation = new Reconciliation(sample.store, { clock: () => at, readTimeout: 100 });
  let task = await registered(sample);
  if (requirements) task = await sample.store.taskEvidence.requirements({ taskId: task.id, expectedRevision: task.revision, threadId, content: 'Complete the agreed task deliverables and verify their behavior.', baseRef: 'main' });
  task = await checkpoint(sample.store, task, { status, summary: 'Waiting for the accepted task deliverables.', nextAction: 'Check completion evidence.', ...(pr ? { prUrl } : {}), ...values });
  return { ...sample, task, now: () => at, advance: amount => { at += amount; }, setPrState: value => { prState = value; }, current: () => sample.store.get(task.id).task };
}

function source(sample, task = sample.current(), values = {}) {
  return { sourceUrl: `codex://threads/${task.threadId}`, sourceEventId: randomUUID(), sourceEventAt: iso(sample.now()), observedAt: iso(sample.now()), taskKey: task.key, threadId: task.threadId, ...values };
}
const worker = (sample, values = {}) => ({ ...source(sample), state: 'completed', pendingReview: false, summary: 'The accepted scope is complete and verified.', ...values });
const coverage = (sample, values = {}) => ({ ...source(sample), requirementsDigest: sample.current().requirements.digest, deliverables: [{ kind: 'pr', url: prUrl }], remaining: [], ...values });
function completion(sample, values = {}) {
  const scopeDigest = sample.current().requirements.digest;
  return { ...source(sample), artifactUrl, artifactDigest, scopeDigest, allScopeComplete: true, pendingReview: false, verification: { ...source(sample), sourceUrl: artifactUrl, artifactUrl, artifactDigest, scopeDigest, result: 'passed', summary: 'Fetched the task-owned artifact and verified the accepted scope against its exact digest.' }, ...values };
}
const observe = (sample, values) => sample.store.reconciliation.observe({ taskId: sample.task.id, expectedRevision: sample.current().revision, ...values });
const check = (sample, values = {}) => sample.store.reconciliation.check({ taskId: sample.task.id, force: true, ...values });

test('a stale blocked checkpoint recovers only with accepted coverage, ended worker and a live merged PR', async t => {
  const sample = await setup(t, { initialPrState: 'OPEN' });
  const original = sample.current();
  await observe(sample, { coverage: coverage(sample), worker: worker(sample) });
  assert.equal(sample.current().status, 'blocked');
  sample.setPrState('MERGED');
  const result = await check(sample), task = sample.current();
  assert.equal(result.results[0].outcome, 'completed');
  assert.equal(task.stage, 'done'); assert.equal(task.status, 'complete');
  assert.equal(task.id, original.id); assert.equal(task.threadId, original.threadId);
  assert.equal(task.summary, original.summary);
  assert.equal(task.pr.state, 'MERGED');
  assert.ok(task.completion); assert.ok(task.reconciliation.checkedAt);
});

test('a merged PR title alone does not prove all task deliverables are complete', async t => {
  const sample = await setup(t);
  await observe(sample, { worker: worker(sample) });
  await check(sample);
  const task = sample.current();
  assert.equal(task.pr.state, 'MERGED');
  assert.equal(task.status, 'blocked'); assert.notEqual(task.stage, 'done');
  assert.match(task.reconciliation.reason, /scope|coverage|requirement/i);
});

test('a manual PR refresh cannot complete a legacy task whose accepted scope is unknown', async t => {
  const sample = await setup(t, { requirements: false });
  const original = sample.current();
  const refreshed = await sample.store.refreshPr(original.id);
  assert.equal(refreshed.pr.state, 'MERGED');
  assert.notEqual(refreshed.stage, 'done'); assert.equal(refreshed.status, 'blocked');
  assert.equal(refreshed.summary, original.summary);
});

test('a manual PR refresh preserves accepted remaining configuration work after a merge', async t => {
  const sample = await setup(t, { initialPrState: 'OPEN' });
  await observe(sample, { coverage: coverage(sample, { remaining: ['Apply and verify the required deployment configuration.'] }), worker: worker(sample) });
  sample.setPrState('MERGED');
  const refreshed = await sample.store.refreshPr(sample.task.id);
  assert.equal(refreshed.pr.state, 'MERGED'); assert.notEqual(refreshed.stage, 'done');
  assert.equal(refreshed.status, 'blocked');
  assert.match(refreshed.reconciliation.reason, /configuration|scope|unfinished/i);
});

test('a later manual PR observation preserves an existing verified completion receipt', async t => {
  const sample = await setup(t);
  await observe(sample, { coverage: coverage(sample), worker: worker(sample) });
  const completed = sample.current(), receipt = structuredClone(completed.completion);
  sample.setPrState('OPEN');
  const refreshed = await sample.store.refreshPr(completed.id);
  assert.equal(refreshed.id, completed.id); assert.equal(refreshed.stage, 'done');
  assert.equal(refreshed.status, 'complete'); assert.deepEqual(refreshed.completion, receipt);
});

test('remaining rollout or stacked deliverables keep a merged PR task open', async t => {
  const sample = await setup(t);
  await observe(sample, { coverage: coverage(sample, { remaining: ['Deploy the required configuration and confirm rollout.'] }), worker: worker(sample) });
  await check(sample);
  assert.notEqual(sample.current().stage, 'done');
  assert.match(sample.current().reconciliation.reason, /remaining|scope|deliverable/i);
});

test('every PR in accepted stacked delivery scope must have a current verified merge', async t => {
  const secondUrl = 'https://github.com/example/repository/pull/124';
  const sample = await setup(t, { prReader: value => mergedPr(Date.now() + 1000, { url: value, ...(value === secondUrl ? { state: 'OPEN', mergedAt: null } : {}) }) });
  await observe(sample, { coverage: coverage(sample, { deliverables: [{ kind: 'pr', url: prUrl }, { kind: 'pr', url: secondUrl }] }), worker: worker(sample) });
  await check(sample);
  assert.equal(sample.current().pr.state, 'MERGED');
  assert.notEqual(sample.current().stage, 'done');
  assert.match(sample.current().reconciliation.reason, /pull request|merge/i);
});

test('a closed Jira issue cannot complete a task or remove its blocker', async t => {
  const sample = await setup(t, { pr: false });
  await observe(sample, { issue: { ...source(sample), sourceUrl: 'https://issues.example.invalid/browse/EX-123', state: 'closed', summary: 'The linked issue is closed.' } });
  assert.equal(sample.current().status, 'blocked');
  assert.notEqual(sample.current().stage, 'done');
});

test('explicit discovered PR evidence is checked live before it is bound to an existing task', async t => {
  let reads = 0;
  const sample = await setup(t, { pr: false, prReader: () => { reads++; return mergedPr(Date.now() + 1000); } });
  const result = await observe(sample, { coverage: coverage(sample), worker: worker(sample), pullRequest: { ...source(sample), sourceUrl: prUrl, url: prUrl } });
  assert.equal(reads, 1); assert.equal(result.task.prUrl, prUrl);
  assert.equal(result.task.pr.state, 'MERGED'); assert.equal(result.task.stage, 'done');
});

test('coverage-only merged PR delivery binds its verified primary PR and can be archived', async t => {
  const sample = await setup(t, { pr: false });
  assert.equal(sample.current().prUrl, undefined);
  const result = await observe(sample, { coverage: coverage(sample), worker: worker(sample) });
  assert.equal(result.outcome, 'completed'); assert.equal(result.task.stage, 'done');
  assert.equal(result.task.prUrl, prUrl); assert.equal(result.task.pr.state, 'MERGED');
  assert.equal(result.task.completion.kind, 'pull_request');
  const receipt = structuredClone(result.task.completion);
  await sample.store.archiveTasks([{ taskId: result.task.id, expectedRevision: result.task.revision }], true);
  assert.ok(sample.current().archivedAt);
  assert.equal(sample.current().id, sample.task.id); assert.deepEqual(sample.current().completion, receipt);
});

test('an inaccessible or unrelated discovered PR cannot become a completion receipt', async t => {
  for (const reader of [() => { throw new Error('unavailable'); }, () => mergedPr(Date.now(), { title: 'EX-999: Unrelated work' })]) {
    const sample = await setup(t, { pr: false, prReader: reader });
    await observe(sample, { coverage: coverage(sample), worker: worker(sample), pullRequest: { ...source(sample), sourceUrl: prUrl, url: prUrl } }).catch(() => {});
    assert.equal(sample.current().prUrl, undefined); assert.notEqual(sample.current().stage, 'done');
  }
});

test('non-PR work completes with task-bound artifact, accepted scope and passed exact-content verification', async t => {
  const sample = await setup(t, { pr: false });
  const result = await observe(sample, { coverage: coverage(sample, { deliverables: [{ kind: 'artifact', url: artifactUrl }] }), worker: worker(sample), completion: completion(sample) });
  assert.equal(result.outcome, 'completed');
  const task = sample.current();
  assert.equal(task.stage, 'done'); assert.equal(task.completion.kind, 'artifact');
  assert.equal(task.completion.artifactUrl, artifactUrl);
  assert.equal(task.completion.artifactDigest, artifactDigest);
  assert.equal(task.pr, undefined);
});

test('artifact completion can be archived and restored while retaining identity and proof history', async t => {
  const sample = await setup(t, { pr: false });
  await observe(sample, { coverage: coverage(sample, { deliverables: [{ kind: 'artifact', url: artifactUrl }] }), worker: worker(sample), completion: completion(sample) });
  const completed = sample.current(), history = structuredClone(completed.reconciliation.history), receipt = structuredClone(completed.completion);
  await sample.store.archiveTasks([{ taskId: completed.id, expectedRevision: completed.revision }], true);
  const archived = sample.current();
  assert.ok(archived.archivedAt);
  await sample.store.archiveTasks([{ taskId: archived.id, expectedRevision: archived.revision }], false);
  const restored = sample.current();
  assert.equal(restored.archivedAt, undefined); assert.equal(restored.id, completed.id);
  assert.equal(restored.threadId, completed.threadId); assert.deepEqual(restored.completion, receipt);
  assert.deepEqual(restored.reconciliation.history, history);
});

test('MCP artifact completion, archive and restore retain the same task and proof history', async t => {
  const sample = await setup(t, { pr: false });
  const server = createServer({ store: sample.store, appHtml: '<html>fixture</html>' });
  const client = new Client({ name: 'artifact-recovery-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name, args) => {
    const result = await client.callTool({ name: `workbench.${name}`, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    return result.structuredContent;
  };
  const result = await call('observation_record', { taskId: sample.task.id, expectedRevision: sample.current().revision, coverage: coverage(sample, { deliverables: [{ kind: 'artifact', url: artifactUrl }] }), worker: worker(sample), completion: completion(sample) });
  assert.equal(result.outcome, 'completed'); assert.equal(result.task.completion.kind, 'artifact');
  const completed = result.task, receipt = structuredClone(completed.completion), history = structuredClone(completed.reconciliation.history);
  await call('archive', { tasks: [{ taskId: completed.id, expectedRevision: completed.revision }], archived: true });
  const archived = (await call('get', { taskId: completed.id })).task;
  assert.ok(archived.archivedAt);
  await call('archive', { tasks: [{ taskId: archived.id, expectedRevision: archived.revision }], archived: false });
  const restored = (await call('get', { taskId: completed.id })).task;
  assert.equal(restored.archivedAt, undefined); assert.equal(restored.id, completed.id);
  assert.equal(restored.threadId, completed.threadId); assert.deepEqual(restored.completion, receipt);
  assert.deepEqual(restored.reconciliation.history, history);
});

test('an unrelated artifact or changed content cannot satisfy accepted artifact coverage', async t => {
  const sample = await setup(t, { pr: false });
  const proof = completion(sample, { artifactUrl: 'https://example.invalid/artifacts/unrelated' });
  await observe(sample, { coverage: coverage(sample, { deliverables: [{ kind: 'artifact', url: artifactUrl }] }), worker: worker(sample), completion: proof }).catch(() => {});
  assert.notEqual(sample.current().stage, 'done');
  const mismatched = completion(sample);
  mismatched.verification.artifactDigest = 'd'.repeat(64);
  await observe(sample, { completion: mismatched }).catch(() => {});
  assert.notEqual(sample.current().stage, 'done');
});

test('new requirements invalidate proof for an earlier accepted scope', async t => {
  const sample = await setup(t, { pr: false });
  const proof = completion(sample), accepted = coverage(sample, { deliverables: [{ kind: 'artifact', url: artifactUrl }] });
  const task = sample.current();
  await sample.store.taskEvidence.requirements({ taskId: task.id, expectedRevision: task.revision, threadId, content: 'The scope now also requires a new delivery step.', baseRef: 'main' });
  await observe(sample, { coverage: accepted, worker: worker(sample), completion: proof }).catch(() => {});
  assert.notEqual(sample.current().stage, 'done');
});

test('a recent reading of an older worker answer cannot supersede a newer task checkpoint', async t => {
  const sample = await setup(t, { pr: false });
  const old = iso(Date.parse(sample.current().checkpointAt || sample.current().updatedAt) - 60000);
  await observe(sample, { coverage: coverage(sample, { deliverables: [{ kind: 'artifact', url: artifactUrl }] }), worker: worker(sample, { sourceEventAt: old }), completion: completion(sample) });
  assert.notEqual(sample.current().stage, 'done');
  assert.equal(sample.current().status, 'blocked');
});

test('a completed worker event cannot cover delivery scope accepted after that event', async t => {
  const sample = await setup(t, { initialPrState: 'OPEN' });
  await observe(sample, { worker: worker(sample) });
  sample.advance(2000);
  await observe(sample, { coverage: coverage(sample) });
  sample.setPrState('MERGED');
  await check(sample);
  assert.equal(sample.current().pr.state, 'MERGED');
  assert.notEqual(sample.current().stage, 'done'); assert.equal(sample.current().status, 'blocked');
  assert.match(sample.current().reconciliation.reason, /predates|accepted.*scope|scope.*after/i);
});

test('an accepted continuation cannot borrow completed-worker or coverage proof from the previous owner', async t => {
  const sample = await setup(t, { initialPrState: 'OPEN' });
  await observe(sample, { coverage: coverage(sample), worker: worker(sample) });
  const previous = structuredClone(sample.current().reconciliation.worker);
  const request = await sample.store.prepareLaunch({ taskId: sample.task.id, continuation: true });
  await sample.store.claimLaunch(request.launch.id);
  await sample.store.finishLaunch({ requestId: request.launch.id, state: 'queued', clientThreadId: 'pending-continuation' });
  await registered(sample, sample.task.key, otherThread);
  assert.equal(sample.current().threadId, otherThread);
  assert.equal(sample.store.launchGet(request.launch.id).launch.state, 'accepted');
  sample.setPrState('MERGED');
  await check(sample);
  const task = sample.current();
  assert.equal(task.pr.state, 'MERGED'); assert.notEqual(task.stage, 'done');
  assert.equal(task.status, 'blocked'); assert.equal(task.completion, undefined);
  assert.match(task.reconciliation.reason, /owner|activity|worker/i);
  assert.deepEqual(task.reconciliation.worker, previous);
  assert.equal(task.reconciliation.coverage.threadId, threadId);
});

test('pending human review or a genuine worker blocker prevents completion despite a merge', async t => {
  for (const values of [{ pendingReview: true }, { state: 'blocked', summary: 'The accepted rollout is still blocked.' }]) {
    const sample = await setup(t);
    await observe(sample, { coverage: coverage(sample), worker: worker(sample, values) });
    await check(sample);
    assert.equal(sample.current().status, 'blocked');
    assert.notEqual(sample.current().stage, 'done');
    assert.match(sample.current().reconciliation.reason, /review|blocked|scope/i);
  }
});

test('an explicit user pause is preserved during passive and manually requested PR checks', async t => {
  const sample = await setup(t, { status: 'paused', pauseKind: 'user', nextAction: 'Wait for my decision.' });
  await observe(sample, { coverage: coverage(sample), worker: worker(sample) });
  await check(sample);
  assert.equal(sample.current().status, 'paused'); assert.notEqual(sample.current().stage, 'done');
  await sample.store.refreshPr(sample.task.id);
  assert.equal(sample.current().status, 'paused'); assert.notEqual(sample.current().stage, 'done');
  assert.equal(sample.current().nextAction, 'Wait for my decision.');
});

test('an ambiguous legacy pause cannot be resolved by a caller-written reason alone', async t => {
  const sample = await setup(t, { status: 'paused' });
  await sample.store.mutate(data => { delete data.tasks.find(task => task.id === sample.task.id).pause; });
  await observe(sample, { coverage: coverage(sample), worker: worker(sample) });
  await observe(sample, { pauseResolution: { ...source(sample), kind: 'orchestration', previousUpdatedAt: sample.current().updatedAt, originalPauseEventId: 'unproven-old-pause', reason: 'It looks like an obsolete merge gate.' } }).catch(() => {});
  await check(sample);
  assert.equal(sample.current().status, 'paused'); assert.notEqual(sample.current().stage, 'done');
});

test('a proven original merge-gate pause can resolve after every accepted deliverable is verified', async t => {
  const sample = await setup(t, { status: 'paused', pauseKind: 'orchestration', pauseCause: 'merge_gate' });
  const paused = sample.current();
  assert.equal(paused.pause.kind, 'orchestration');
  assert.equal(paused.pause.cause, 'merge_gate');
  const result = await observe(sample, { coverage: coverage(sample), worker: worker(sample), pauseResolution: { ...source(sample), kind: 'orchestration', previousUpdatedAt: paused.updatedAt, originalPauseEventId: paused.pause.sourceEventId, reason: 'The saved merge gate is satisfied by live merged deliverables and the completed owning worker.' } });
  assert.equal(result.outcome, 'completed'); assert.equal(sample.current().stage, 'done');
});

test('uncertain publication and unresolved handoff receipts are retained without retrying writes', async t => {
  for (const kind of ['publication', 'launch']) {
    let reads = 0;
    const sample = await setup(t, { prReader: () => { reads++; return mergedPr(Date.now()); } });
    await sample.store.mutate(data => {
      if (kind === 'publication') data.tasks.find(task => task.id === sample.task.id).publications = [{ id: randomUUID(), state: 'uncertain', inFlight: 'push', completed: [] }];
      else data.launches.push({ id: randomUUID(), taskId: sample.task.id, state: 'uncertain', createdAt: iso(sample.now()) });
    });
    await observe(sample, { coverage: coverage(sample), worker: worker(sample) });
    reads = 0;
    const before = sample.current(), result = await check(sample);
    assert.equal(reads, 0); assert.equal(result.results[0].outcome, 'skipped');
    assert.notEqual(sample.current().stage, 'done');
    assert.deepEqual(sample.current().publications, before.publications);
    assert.equal(sample.store.read().launches.length, kind === 'launch' ? 1 : 0);
  }
});

test('running workers and unknown active worker state are never treated as completed', async t => {
  for (const state of ['running', 'missing', 'stale']) {
    const sample = await setup(t, { status: 'active', initialPrState: 'OPEN' });
    if (state === 'missing') await observe(sample, { coverage: coverage(sample) });
    else await observe(sample, { coverage: coverage(sample), worker: worker(sample, { state: state === 'running' ? 'running' : 'completed' }) });
    if (state === 'stale') sample.advance(11 * 60 * 1000);
    sample.setPrState('MERGED');
    await check(sample);
    assert.equal(sample.current().status, 'active'); assert.notEqual(sample.current().stage, 'done');
    assert.match(sample.current().reconciliation.reason, /running|activity|worker|fresh|unknown/i);
  }
});

test('passive checks are throttled, history stays bounded and metadata does not rewrite activity time', async t => {
  let reads = 0;
  const sample = await setup(t, { prReader: () => { reads++; return mergedPr(Date.now()); } });
  const updatedAt = sample.current().updatedAt;
  assert.equal((await check(sample, { force: false })).status, 'checked');
  assert.equal((await check(sample, { force: false })).status, 'throttled');
  assert.equal(reads, 1); assert.equal(sample.current().updatedAt, updatedAt);
  for (let count = 0; count < 22; count++) await check(sample);
  assert.ok(sample.current().reconciliation.history.length <= 20);
  assert.equal(sample.current().updatedAt, updatedAt);
});

test('passive CI refresh preserves a full policy observation at its original time, head and base', async t => {
  const originalHead = 'a'.repeat(40), originalBase = 'b'.repeat(40);
  const required = { version: 1, status: 'satisfied', checks: [{ context: 'tests', appId: 42, status: 'satisfied' }] };
  let remote = mergedPr(Date.now(), { state: 'OPEN', mergedAt: null, headRefOid: originalHead, baseRefOid: originalBase, baseRefName: 'main', ci: { observed: 'passed', required, count: 1 } });
  const sample = await setup(t, { prReader: () => remote });
  await sample.store.refreshPr(sample.task.id);
  const original = structuredClone(sample.current().pr.requiredCiObservation);
  assert.equal(original.required.status, 'satisfied');
  assert.equal(original.head, originalHead); assert.equal(original.base, originalBase);
  assert.ok(original.checkedAt);
  sample.advance(2000);
  const { ci, ...passive } = remote;
  remote = passive;
  await check(sample);
  let task = sample.current();
  assert.equal(task.pr.requiredCi.status, 'unknown');
  assert.deepEqual(task.pr.requiredCiObservation, original);
  assert.notEqual(task.pr.checkedAt, original.checkedAt);
  sample.advance(2000);
  remote = { ...passive, headRefOid: 'd'.repeat(40), baseRefOid: 'e'.repeat(40) };
  await check(sample);
  task = sample.current();
  assert.equal(task.pr.head, remote.headRefOid); assert.equal(task.pr.base, remote.baseRefOid);
  assert.equal(task.pr.requiredCi.status, 'unknown');
  assert.deepEqual(task.pr.requiredCiObservation, original);
  assert.notEqual(task.pr.requiredCiObservation.head, task.pr.head);
  assert.notEqual(task.pr.requiredCiObservation.base, task.pr.base);
});

test('two server instances serialize checks through the shared store lease', async t => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const sample = await setup(t, { prReader: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  const second = new BoardStore({ root: sample.root });
  second.reconciliation = new Reconciliation(second, { clock: sample.now, readTimeout: 100 });
  const pending = check(sample);
  await ready;
  assert.equal((await second.reconciliation.check({ force: true })).status, 'busy');
  release(mergedPr(sample.now())); await pending;
});

test('a stalled passive source read is bounded and releases its lease without changing task state', async t => {
  const sample = await setup(t, { prReader: () => new Promise(() => {}) });
  sample.store.reconciliation.readTimeout = 10;
  const before = sample.current(), result = await check(sample);
  assert.equal(result.results[0].outcome, 'unavailable');
  assert.equal(sample.current().stage, before.stage); assert.equal(sample.current().status, before.status);
  assert.equal(sample.current().summary, before.summary);
  assert.equal(sample.store.read().reconciliation.lease, undefined);
});

test('a new checkpoint during PR observation wins over older reconciliation', async t => {
  let release, started, block = false;
  const ready = new Promise(resolve => { started = resolve; });
  const sample = await setup(t, { prReader: () => { if (!block) return mergedPr(Date.now(), { state: 'OPEN', mergedAt: null }); started(); return new Promise(resolve => { release = resolve; }); } });
  await observe(sample, { coverage: coverage(sample), worker: worker(sample) });
  block = true;
  const pending = check(sample); await ready;
  const current = sample.current();
  await checkpoint(sample.store, current, { status: 'blocked', summary: 'A newly discovered deliverable is blocked.', nextAction: 'Keep this newer evidence.' });
  release(mergedPr(sample.now())); const result = await pending;
  assert.equal(result.results[0].outcome, 'conflict');
  assert.equal(sample.current().summary, 'A newly discovered deliverable is blocked.');
  assert.notEqual(sample.current().stage, 'done');
});

test('an expired lease cannot apply a late read or delete a replacement owner lease', async t => {
  let release, started, block = false;
  const ready = new Promise(resolve => { started = resolve; });
  const sample = await setup(t, { prReader: () => { if (!block) return mergedPr(Date.now(), { state: 'OPEN', mergedAt: null }); started(); return new Promise(resolve => { release = resolve; }); } });
  await observe(sample, { coverage: coverage(sample), worker: worker(sample) });
  block = true;
  const pending = check(sample); await ready;
  sample.advance(120000);
  await sample.store.mutate(data => { data.reconciliation.lease = { id: 'replacement-owner', expiresAt: iso(sample.now() + 60000) }; });
  release(mergedPr(sample.now())); const result = await pending;
  assert.equal(result.results[0].outcome, 'conflict');
  assert.notEqual(sample.current().stage, 'done');
  assert.equal(sample.store.read().reconciliation.lease.id, 'replacement-owner');
});

test('replaying the same source event is idempotent after the saved revision changes', async t => {
  const sample = await setup(t, { pr: false });
  const data = { coverage: coverage(sample, { deliverables: [{ kind: 'artifact', url: artifactUrl }] }), worker: worker(sample), completion: completion(sample) };
  const first = await observe(sample, data), before = fs.readFileSync(sample.store.filename);
  sample.advance(1000);
  const replay = structuredClone(data);
  const second = await sample.store.reconciliation.observe({ taskId: sample.task.id, expectedRevision: first.task.revision, ...replay });
  assert.equal(second.task.completion.sourceEventId, first.task.completion.sourceEventId);
  assert.equal(second.task.reconciliation.history.length, first.task.reconciliation.history.length);
  assert.deepEqual(fs.readFileSync(sample.store.filename), before);
});

test('a later observer check of the same immutable event does not duplicate completion history', async t => {
  const sample = await setup(t, { pr: false });
  const data = { coverage: coverage(sample, { deliverables: [{ kind: 'artifact', url: artifactUrl }] }), worker: worker(sample), completion: completion(sample) };
  const first = await observe(sample, data);
  sample.advance(1000);
  const replay = structuredClone(data);
  for (const value of Object.values(replay)) value.observedAt = iso(sample.now());
  replay.completion.verification.observedAt = iso(sample.now());
  const refreshed = await observe(sample, replay);
  assert.equal(refreshed.task.completion.receiptId, first.task.completion.receiptId);
  assert.equal(refreshed.task.reconciliation.history.length, first.task.reconciliation.history.length);
  assert.equal(refreshed.task.reconciliation.receipts.length, first.task.reconciliation.receipts.length);
  const changed = structuredClone(replay);
  changed.worker.sourceEventAt = iso(sample.now());
  await assert.rejects(() => observe(sample, changed), /event|receipt|changed/i);
});

test('a bounded scan rotates fairly through tasks without PRs', async t => {
  const sample = await setup(t, { pr: false });
  for (let index = 1; index < 7; index++) await registered(sample, `EX-${123 + index}`);
  const first = await sample.store.reconciliation.check({ force: true });
  assert.equal(first.results.length, 5);
  sample.advance(5 * 60 * 1000 + 1);
  const second = await sample.store.reconciliation.check({ force: true });
  assert.ok(second.results.length <= 5);
  assert.equal(new Set([...first.results, ...second.results].map(item => item.taskId)).size, 7);
});

test('a task with five PRs cannot consume every pass while unread single-PR tasks appear freshly checked', async t => {
  const reads = [], owners = new Map();
  const sample = await setup(t, { pr: false, prReader: value => {
    reads.push(value);
    return mergedPr(Date.now(), { url: value, title: `${owners.get(value)}: Accepted delivery`, state: 'OPEN', mergedAt: null });
  } });
  const firstUrls = Array.from({ length: 5 }, (_, index) => `https://github.com/example/repository/pull/${123 + index}`);
  firstUrls.forEach(value => owners.set(value, sample.task.key));
  await observe(sample, { coverage: coverage(sample, { deliverables: firstUrls.map(value => ({ kind: 'pr', url: value })) }), worker: worker(sample) });
  const laterTasks = [], laterUrls = [];
  for (let index = 0; index < 4; index++) {
    const key = `EX-${124 + index}`, value = `https://github.com/example/repository/pull/${224 + index}`;
    owners.set(value, key); laterUrls.push(value);
    let task = await registered(sample, key);
    task = await sample.store.taskEvidence.requirements({ taskId: task.id, expectedRevision: task.revision, threadId, content: `Deliver the accepted ${key} change and verify its behavior.`, baseRef: 'main' });
    task = await checkpoint(sample.store, task, { status: 'blocked', prUrl: value });
    sample.advance(Math.max(0, Date.now() + 1000 - sample.now()));
    const result = await sample.store.reconciliation.observe({ taskId: task.id, expectedRevision: task.revision, coverage: { ...source(sample, task), requirementsDigest: task.requirements.digest, deliverables: [{ kind: 'pr', url: value }], remaining: [] }, worker: { ...source(sample, task), state: 'completed', pendingReview: false, summary: 'Accepted work is complete; the task-owned PR remains open.' } });
    laterTasks.push(result.task);
  }
  const originalChecks = new Map(laterTasks.map(task => [task.id, task.reconciliation.checkedAt]));
  reads.length = 0;
  sample.advance(5 * 60 * 1000 + 1);
  const first = await sample.store.reconciliation.check({ force: true });
  assert.equal(reads.length, 5); assert.equal(first.results.length, 1);
  assert.deepEqual(new Set(reads), new Set(firstUrls));
  for (const task of laterTasks) assert.equal(sample.store.get(task.id).task.reconciliation.checkedAt, originalChecks.get(task.id));
  const observedLater = new Set();
  for (let pass = 0; pass < 3 && observedLater.size < laterUrls.length; pass++) {
    reads.length = 0;
    sample.advance(5 * 60 * 1000 + 1);
    await sample.store.reconciliation.check({ force: true });
    assert.ok(reads.length <= 5);
    for (const value of reads) if (laterUrls.includes(value)) observedLater.add(value);
  }
  assert.deepEqual(observedLater, new Set(laterUrls));
});

test('two four-PR tasks alternate complete observations without consuming a partial read budget', async t => {
  const reads = [], owners = new Map();
  const sample = await setup(t, { pr: false, prReader: value => {
    reads.push(value);
    return mergedPr(Date.now(), { url: value, title: `${owners.get(value)}: Accepted delivery`, state: 'OPEN', mergedAt: null });
  } });
  const firstUrls = Array.from({ length: 4 }, (_, index) => `https://github.com/example/repository/pull/${123 + index}`);
  firstUrls.forEach(value => owners.set(value, sample.task.key));
  await observe(sample, { coverage: coverage(sample, { deliverables: firstUrls.map(value => ({ kind: 'pr', url: value })) }), worker: worker(sample) });
  const secondUrls = Array.from({ length: 4 }, (_, index) => `https://github.com/example/repository/pull/${224 + index}`);
  secondUrls.forEach(value => owners.set(value, 'EX-124'));
  let second = await registered(sample, 'EX-124');
  second = await sample.store.taskEvidence.requirements({ taskId: second.id, expectedRevision: second.revision, threadId, content: 'Deliver and verify all four accepted EX-124 PRs.', baseRef: 'main' });
  second = await checkpoint(sample.store, second, { status: 'blocked' });
  sample.advance(Math.max(0, Date.now() + 1000 - sample.now()));
  second = (await sample.store.reconciliation.observe({ taskId: second.id, expectedRevision: second.revision, coverage: { ...source(sample, second), requirementsDigest: second.requirements.digest, deliverables: secondUrls.map(value => ({ kind: 'pr', url: value })), remaining: [] }, worker: { ...source(sample, second), state: 'completed', pendingReview: false, summary: 'All four task-owned PR deliverables are ready for merge.' } })).task;
  const secondCheckedAt = second.reconciliation.checkedAt;
  reads.length = 0;
  sample.advance(5 * 60 * 1000 + 1);
  const firstPass = await sample.store.reconciliation.check({ force: true });
  assert.equal(reads.length, 4); assert.equal(firstPass.results.length, 1);
  assert.deepEqual(new Set(reads), new Set(firstUrls));
  assert.equal(sample.store.get(second.id).task.reconciliation.checkedAt, secondCheckedAt);
  reads.length = 0;
  sample.advance(5 * 60 * 1000 + 1);
  const secondPass = await sample.store.reconciliation.check({ force: true });
  assert.equal(reads.length, 4); assert.equal(secondPass.results.length, 1);
  assert.equal(secondPass.results[0].taskId, second.id);
  assert.deepEqual(new Set(reads), new Set(secondUrls));
});

test('source identity and exact issue/PR links are validated before saving', async t => {
  const sample = await setup(t);
  const before = fs.readFileSync(sample.store.filename);
  await assert.rejects(() => observe(sample, { worker: worker(sample, { threadId: otherThread }) }));
  await assert.rejects(() => observe(sample, { issue: { ...source(sample), sourceUrl: 'https://issues.example.invalid/browse/EX-999', state: 'closed', summary: 'Another issue.' } }));
  await assert.rejects(() => observe(sample, { worker: worker(sample, { sourceUrl: `codex://threads/${otherThread}` }) }));
  assert.deepEqual(fs.readFileSync(sample.store.filename), before);
});

test('coverage exceeding five unique PRs including the saved or discovered primary is rejected before reads or mutations', async t => {
  for (const discovered of [false, true]) {
    let reads = 0;
    const sample = await setup(t, { pr: !discovered, prReader: value => { reads++; return mergedPr(Date.now(), { url: value }); } });
    const before = fs.readFileSync(sample.store.filename);
    const deliverables = Array.from({ length: 5 }, (_, index) => ({ kind: 'pr', url: `https://github.com/example/repository/pull/${124 + index}` }));
    await assert.rejects(() => observe(sample, { coverage: coverage(sample, { deliverables }), ...(discovered ? { pullRequest: { ...source(sample), sourceUrl: prUrl, url: prUrl } } : {}) }), /primary PR exceeds the five-PR check limit/);
    assert.equal(reads, 0);
    assert.deepEqual(fs.readFileSync(sample.store.filename), before);
  }
});
