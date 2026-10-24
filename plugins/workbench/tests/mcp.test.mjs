import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server/index.mjs';
import { fixture, threadId, registered, checkpoint } from './fixtures.mjs';

test('installed-format stdio server discovers UI, imports notes, saves progress and restores a thread panel', async t => {
  const sample = fixture(); t.after(sample.cleanup);
  const configPath = path.join(sample.directory, 'discovery.toml');
  fs.writeFileSync(configPath, `[projects.${JSON.stringify(sample.repo)}]\ntrust_level="trusted"\n`);
  const bin = path.join(sample.directory, 'bin'); fs.mkdirSync(bin);
  const pr = { url: 'https://github.com/example/repository/pull/123', title: 'EX-123: Imported task', state: 'OPEN', mergedAt: null, headRefOid: 'a'.repeat(40), headRefName: 'ex-123', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [] };
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(pr))});\n`, { mode: 0o700 });
  const client = new Client({ name: 'workbench-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('plugins/workbench/server/dist/index.mjs')], env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, WORKBENCH_PREVIEW_DATA_DIR: sample.root, WORKBENCH_PREVIEW_DISCOVERY_CONFIG: configPath }, stderr: 'pipe' });
  await client.connect(transport); t.after(() => client.close());
  const tools = (await client.listTools()).tools;
  for (const [name, kind] of [['workbench.open', 'global'], ['workbench.task', 'thread']]) {
    const tool = tools.find(item => item.name === name);
    assert.deepEqual(tool._meta['openai/ui'].entrypoints, [{ type: kind }]);
    assert.equal((await client.callTool({ name, arguments: {} })).isError, undefined);
  }
  const open = tools.find(item => item.name === 'workbench.open');
  const version = JSON.parse(fs.readFileSync(path.resolve('plugins/workbench/plugin.json'), 'utf8')).version;
  assert.equal(open._meta.ui.resourceUri.split('/').at(-3), version);
  assert.match(open._meta.ui.resourceUri, /\/[a-f0-9]{16}\/app\.html$/);
  const resource = (await client.readResource({ uri: open._meta.ui.resourceUri })).contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app'); assert.match(resource.text, /Delivery board/); assert.match(resource.text, /Restore to Done/);
  assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
  assert.deepEqual(tools.find(item => item.name === 'workbench.launch_prepare')._meta.ui.visibility, ['app']);
  assert.deepEqual(tools.find(item => item.name === 'workbench.repository_pick')._meta.ui.visibility, ['app']);
  assert.deepEqual(tools.find(item => item.name === 'workbench.launch_resolve')._meta.ui.visibility, ['app']);
  const discovered = await client.callTool({ name: 'workbench.repository_discover', arguments: {} });
  assert.equal(discovered.structuredContent.repositories[0].importableTaskCount, 1);
  assert.equal(fs.existsSync(sample.store.filename), false);
  const added = await client.callTool({ name: 'workbench.repository_add', arguments: { path: sample.repo } });
  assert.equal(added.structuredContent.imported, 1);
  assert.equal(added.structuredContent.reconciliation.checked, 1);
  const failedImport = await client.callTool({ name: 'workbench.repository_add', arguments: { path: path.join(sample.directory, 'missing') } });
  assert.equal(failedImport.isError, true); assert.match(failedImport.content[0].text, /folder is unavailable/);
  assert.match(failedImport.structuredContent.error.details, /ENOENT/);
  const rejectedArchive = await client.callTool({ name: 'workbench.archive', arguments: { tasks: [{ taskId: (await client.callTool({ name: 'workbench.list', arguments: {} })).structuredContent.tasks[0].id, expectedRevision: 2 }] } });
  assert.equal(rejectedArchive.isError, true); assert.match(rejectedArchive.content[0].text, /verified merge/);
  const imported = (await client.callTool({ name: 'workbench.list', arguments: {} })).structuredContent.tasks[0];
  assert.equal(imported.stage, 'pr'); assert.equal(imported.status, 'waiting');
  const registered = await client.callTool({ name: 'workbench.task_register', arguments: { repositoryId: added.structuredContent.repository.id, key: 'EX-123', title: 'Existing task', threadId, checkout: sample.repo }, _meta: { 'openai/session': 'test-worker' } });
  const task = registered.structuredContent.task;
  const panel = await client.callTool({ name: 'workbench.task', arguments: {}, _meta: { 'openai/session': 'test-worker' } });
  assert.equal(panel.structuredContent.selected.task.id, task.id); assert.equal(panel.structuredContent.selected.noteIsLegacy, true);
  const progress = await client.callTool({ name: 'workbench.progress', arguments: { taskId: task.id, expectedRevision: task.revision, stage: 'verify', status: 'blocked', summary: 'Missing fixture account.', nextAction: 'Seed the account.', threadId } });
  assert.equal(progress.structuredContent.task.stage, 'verify');
  const wrong = await client.callTool({ name: 'workbench.progress', arguments: { taskId: task.id, expectedRevision: task.revision, stage: 'done', status: 'paused', summary: 'Claimed done', nextAction: '', threadId } });
  assert.equal(wrong.isError, true);
  const anotherGlobal = await client.callTool({ name: 'workbench.open', arguments: {}, _meta: { 'openai/session': 'test-worker' } });
  assert.equal(anotherGlobal.structuredContent.selected, null);
});

test('a changed app build has a new resource identity even when its package version is unchanged', async t => {
  const sample = fixture(); t.after(sample.cleanup);
  const uris = [];
  for (const appHtml of ['<html>first build</html>', '<html>changed build</html>']) {
    const server = createServer({ store: sample.store, appHtml });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'cache-regression', version: '1.0.0' });
    await client.connect(clientTransport);
    try {
      const open = (await client.listTools()).tools.find(tool => tool.name === 'workbench.open');
      const uri = open._meta.ui.resourceUri;
      assert.equal((await client.readResource({ uri })).contents[0].text, appHtml);
      uris.push(uri);
    } finally { await client.close(); await server.close(); }
  }
  assert.notEqual(uris[0], uris[1], 'hosts must not reuse a different build under the same resource URI');
});

test('a delayed explicit PR check leaves board reads and checkpoints responsive and rejects its stale result', async t => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const sample = fixture({ legacy: false, prReader: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  t.after(sample.cleanup);
  let task = await registered(sample);
  task = await checkpoint(sample.store, task, { prUrl: 'https://github.com/example/repository/pull/123' });
  const server = createServer({ store: sample.store, appHtml: '<html>fixture</html>' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'concurrent-pr-test', version: '1.0.0' });
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const refreshing = client.callTool({ name: 'workbench.pr_refresh', arguments: { taskId: task.id } });
  await waiting;
  const listing = await client.callTool({ name: 'workbench.list', arguments: {} });
  assert.equal(listing.structuredContent.tasks.length, 1);
  const progress = await client.callTool({ name: 'workbench.progress', arguments: { taskId: task.id, expectedRevision: task.revision, stage: 'verify', status: 'blocked', summary: 'New evidence', nextAction: 'Fix fixture', threadId } });
  assert.equal(progress.structuredContent.task.summary, 'New evidence');
  release({ url: task.prUrl, title: task.key, state: 'MERGED', mergedAt: new Date().toISOString(), headRefOid: 'a'.repeat(40), statusCheckRollup: [] });
  const result = await refreshing;
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /changed during/);
  assert.equal(sample.store.get(task.id).task.stage, 'verify');
});

test('MCP recovery validates confirmation, resolves only its request and preserves independent evidence', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  let task = await registered(sample);
  const server = createServer({ store: sample.store, appHtml: '<html>fixture</html>' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'recovery-contract-test', version: '1.0.0' });
  await client.connect(clientTransport); t.after(async () => { await client.close(); await server.close(); });
  const call = (name, args) => client.callTool({ name, arguments: args });
  for (const [kind, checkedAt] of [['verify', '2026-10-20T10:00:00.000Z'], ['review', '2026-10-20T11:00:00.000Z']]) {
    const result = await call('workbench.progress', { taskId: task.id, expectedRevision: task.revision, stage: kind, status: 'paused', summary: kind, nextAction: 'Continue', threadId, evidence: { [kind]: 'passed', checkedAt } });
    task = result.structuredContent.task;
  }
  assert.equal(task.evidenceChecks.verify.checkedAt, '2026-10-20T10:00:00.000Z');
  assert.equal(task.evidenceChecks.review.checkedAt, '2026-10-20T11:00:00.000Z');
  const first = (await call('workbench.launch_prepare', { taskId: task.id })).structuredContent.launch;
  const second = (await call('workbench.launch_prepare', { repositoryId: task.repositoryId, title: 'EX-999 A different task' })).structuredContent.launch;
  const args = { requestId: first.id, expectedState: first.state, expectedUpdatedAt: first.updatedAt, confirmedNotDelivered: false };
  assert.equal((await call('workbench.launch_resolve', args)).isError, true);
  const resolved = await call('workbench.launch_resolve', { ...args, confirmedNotDelivered: true });
  assert.equal(resolved.structuredContent.launch.state, 'failed');
  assert.equal(sample.store.launchGet(second.id).launch.state, 'prepared');
});
