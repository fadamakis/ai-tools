import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, threadId } from './fixtures.mjs';

test('the configured stdio entrypoint serves delivery tools and disposable content-bound evidence', async t => {
  const s = fixture({ legacy: false });
  const client = new Client({ name: 'workbench-delivery-smoke', version: '1' });
  t.after(async () => { await client.close(); await s.cleanup(); });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../server/dist/index.mjs', import.meta.url))], env: { ...process.env, WORKBENCH_PREVIEW_DATA_DIR: s.root }, stderr: 'pipe' }), { timeout: 15000 });
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name: `workbench.${name}`, arguments: args });
    assert.equal(result.isError, undefined); return result.structuredContent;
  };
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  for (const suffix of ['requirements_set', 'evidence_capture', 'publication_prepare', 'publication_execute', 'publication_reconcile', 'remote_bind', 'remote_refresh']) assert.ok(tools.includes(`workbench.${suffix}`));
  assert.equal((await call('list')).tasks.length, 0);
  const { repository } = await call('repository_add', { path: s.repo, importExisting: false });
  let { task } = await call('task_register', { repositoryId: repository.id, key: 'SMOKE-1', title: 'Disposable source smoke', threadId, checkout: s.repo });
  const worker = () => ({ taskId: task.id, expectedRevision: task.revision, threadId });
  ({ task } = await call('requirements_set', { ...worker(), content: 'The fixture stays readable.', baseRef: 'main' }));
  const captured = await call('evidence_capture', { ...worker(), kind: 'verify' }); task = captured.task;
  ({ task } = await call('progress', { ...worker(), stage: 'verify', status: 'paused', summary: 'Disposable fixture checked.', nextAction: 'Independent review.', evidence: { verify: 'passed', snapshotId: captured.snapshot.id, checkedAt: new Date().toISOString() } }));
  assert.equal(task.evidenceChecks.verify.snapshot.head, s.git('rev-parse', 'HEAD'));
  assert.equal((await call('get', { taskId: task.id })).task.id, task.id);
  const resource = (await client.listResources()).resources[0];
  assert.ok((await client.readResource({ uri: resource.uri })).contents[0].text.includes('<!doctype html>'));
});
