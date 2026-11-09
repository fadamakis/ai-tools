import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server/index.mjs';
import { fixture, registered, checkpoint, threadId } from './fixtures.mjs';

async function connected(t) {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  let task = await registered(sample);
  task = await checkpoint(sample.store, task, { status: 'blocked', summary: 'Test account unavailable.', nextAction: 'Provide the test account.' });
  const server = createServer({ store: sample.store, appHtml: '<html>fixture</html>' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'reconciliation-contract', version: '1.0.0' });
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return { sample, task, client, call: (name, args = {}) => client.callTool({ name, arguments: args }) };
}

test('status tools declare local mutations and listing advertises capability without running checks', async t => {
  const { sample, client, call } = await connected(t);
  const before = sample.store.read();
  const tools = (await client.listTools()).tools;
  for (const name of ['workbench.reconcile', 'workbench.observation_record']) assert.equal(tools.find(tool => tool.name === name).annotations.readOnlyHint, false);
  const board = (await call('workbench.list')).structuredContent;
  assert.equal(board.reconciliation.available, true);
  assert.deepEqual(sample.store.read(), before);
});

test('connected Jira closure is recorded without declaring blocked delivery complete or launching work', async t => {
  const { sample, task, call } = await connected(t);
  const observedAt = new Date().toISOString();
  const result = await call('workbench.observation_record', { taskId: task.id, expectedRevision: task.revision, issue: { sourceUrl: 'https://issues.example.invalid/browse/EX-123', sourceEventId: 'issue-version-2', sourceEventAt: observedAt, observedAt, taskKey: task.key, threadId, state: 'closed', summary: 'Issue is closed; deployment proof is absent.' } });
  assert.notEqual(result.isError, true);
  const current = sample.store.get(task.id).task;
  assert.equal(current.status, 'blocked');
  assert.notEqual(current.stage, 'done');
  assert.deepEqual(sample.store.read().launches, []);
  assert.equal(current.summary, 'Test account unavailable.');
});

test('observations require source event provenance and reject implicit approval or retry fields', async t => {
  const { task, call } = await connected(t);
  const observedAt = new Date().toISOString();
  const base = { sourceUrl: `codex://threads/${threadId}`, sourceEventId: 'final-1', sourceEventAt: observedAt, observedAt, taskKey: task.key, threadId, state: 'completed', pendingReview: false, summary: 'An observed final outcome.' };
  const missing = { ...base }; delete missing.sourceEventAt;
  assert.equal((await call('workbench.observation_record', { taskId: task.id, expectedRevision: task.revision, worker: missing })).isError, true);
  assert.equal((await call('workbench.observation_record', { taskId: task.id, expectedRevision: task.revision, worker: base, retry: true })).isError, true);
});
