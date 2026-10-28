import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server/index.mjs';
import { fixture, registered, threadId } from './fixtures.mjs';

test('MCP exposes bounded delivery tools and binds a result to a server-generated snapshot', async t => {
  const s = fixture({ legacy: false }); t.after(s.cleanup); let task = await registered(s);
  const server = createServer({ store: s.store }); const client = new Client({ name: 'delivery-test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(right); await client.connect(left); t.after(() => client.close());
  const tools = (await client.listTools()).tools;
  for (const suffix of ['requirements_set', 'evidence_capture', 'publication_prepare', 'publication_execute', 'publication_reconcile', 'publication_close', 'remote_bind', 'remote_refresh', 'remote_unbind']) assert.ok(tools.some(tool => tool.name === `workbench.${suffix}`));
  assert.equal(tools.find(tool => tool.name === 'workbench.publication_execute').annotations.readOnlyHint, false);
  const call = (name, args) => client.callTool({ name: `workbench.${name}`, arguments: args });
  const worker = () => ({ taskId: task.id, expectedRevision: task.revision, threadId });
  let result = await call('requirements_set', { ...worker(), content: 'The fixture remains readable.', baseRef: 'main' }); assert.equal(result.isError, undefined); task = result.structuredContent.task;
  result = await call('evidence_capture', { ...worker(), kind: 'verify' }); assert.equal(result.isError, undefined); task = result.structuredContent.task;
  const snapshotId = result.structuredContent.snapshot.id;
  result = await call('progress', { ...worker(), stage: 'verify', status: 'paused', summary: 'Fixture checked.', nextAction: 'Independent review', evidence: { verify: 'passed', checkedAt: new Date().toISOString(), snapshotId } });
  assert.equal(result.isError, undefined); assert.equal(result.structuredContent.task.evidenceChecks.verify.snapshot.id, snapshotId);
  assert.equal((await call('remote_bind', { taskId: task.id, expectedRevision: 1, runUrl: 'javascript:alert(1)', workflowPath: '../outside.yml', botId: -1 })).isError, true);
});
