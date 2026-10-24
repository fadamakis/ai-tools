import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server/index.mjs';
import { ReviewStore } from '../server/store.mjs';
import { NativeReviewer } from '../server/native-review.mjs';
import { fixture, beforeDemo, weakenDemo } from './fixtures.mjs';

test('bundled stdio server discovers both entrypoints and completes a local review without stdout noise', async t => {
  const sample = fixture(beforeDemo); t.after(sample.cleanup); weakenDemo(sample);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-mcp-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const client = new Client({ name: 'shelob-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('plugins/shelob/server/dist/index.mjs')], env: { ...process.env, SHELOB_DATA_DIR: root }, stderr: 'pipe' });
  let diagnostics = ''; transport.stderr?.on('data', chunk => { diagnostics += chunk.toString(); });
  await client.connect(transport); t.after(() => client.close());
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 23);
  assert.equal(tools.find(tool => tool.name === 'shelob.preflight').annotations.readOnlyHint, true);
  assert.deepEqual(tools.find(tool => tool.name === 'shelob.ui_heartbeat')._meta.ui.visibility, ['app']);
  assert.equal((await client.callTool({ name: 'shelob.preflight', arguments: {} })).structuredContent.status, 'ui_unverified');
  assert.equal(tools.find(tool => tool.name === 'shelob.code_review').annotations.readOnlyHint, false);
  assert.ok(tools.find(tool => tool.name === 'shelob.finalize').inputSchema.properties.assessments.properties.codeReview);
  assert.deepEqual(tools.find(tool => tool.name === 'shelob.rule_save')._meta.ui.visibility, ['app']);
  assert.equal(tools.find(tool => tool.name === 'shelob.rule_save').annotations.readOnlyHint, false);
  const rules = await client.callTool({ name: 'shelob.rules', arguments: {} });
  assert.equal(rules.structuredContent.pack.rules.length, 9);
  assert.equal(rules.structuredContent.customized, false);
  for (const name of ['shelob.comment_preview', 'shelob.comment_post', 'shelob.review_preview', 'shelob.review_post', 'shelob.settings', 'shelob.settings_save', 'shelob.comment_discussed']) assert.deepEqual(tools.find(tool => tool.name === name)._meta.ui.visibility, ['app']);
  assert.equal(tools.find(tool => tool.name === 'shelob.comment_post').inputSchema.properties.confirmed.const, true);
  assert.equal(tools.find(tool => tool.name === 'shelob.comment_post').annotations.readOnlyHint, false);
  assert.deepEqual(tools.find(tool => tool.name === 'shelob.start').inputSchema.properties.reviewMode.enum, ['pr_only', 'local_copy']);
  const global = tools.find(tool => tool.name === 'shelob.open'), thread = tools.find(tool => tool.name === 'shelob.review');
  assert.deepEqual(global._meta['openai/ui'].entrypoints, [{ type: 'global' }]);
  assert.deepEqual(thread._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
  for (const entry of [global, thread]) {
    assert.equal(entry.inputSchema.required?.length || 0, 0);
    const result = await client.callTool({ name: entry.name, arguments: {} }); assert.equal(result.isError, undefined);
  }
  assert.equal(global._meta.ui.resourceUri, 'ui://shelob/review/app.html');
  const resource = (await client.readResource({ uri: global._meta.ui.resourceUri })).contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.text, /Your reviews/);
  assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
  for (const old of ['0.4.2', '0.7.0']) {
    const uri = `ui://shelob/review/${old}`;
    const compatibility = (await client.readResource({ uri })).contents[0];
    assert.equal(compatibility.uri, uri);
    const withoutRuntime = html => html.replace(/<script type="application\/json" id="shelob-runtime">[^<]*<\/script>/, '');
    assert.equal(withoutRuntime(compatibility.text), withoutRuntime(resource.text));
    assert.equal(compatibility.mimeType, resource.mimeType);
    assert.deepEqual(compatibility._meta, resource._meta);
  }
  const start = await client.callTool({ name: 'shelob.start', arguments: { kind: 'local', repo: sample.repo, base: 'main' }, _meta: { 'openai/session': 'chat-a' } });
  const runId = start.structuredContent.run.id;
  const originalFinding=start._meta.report.results.flatMap(result=>result.findings)[0];
  const proposal=await client.callTool({name:'shelob.suggest_comment',arguments:{requestId:'32345678-1234-4123-8123-123456789abc',runId,snapshotId:start._meta.report.snapshot.id,findingId:originalFinding.id,originalDraft:'My existing draft.',draft:'A proposed replacement.'}});
  assert.equal(proposal.isError,undefined);
  const reread=await client.callTool({name:'shelob.get',arguments:{runId}});
  assert.equal(reread._meta.draftSuggestions[0].draft,'A proposed replacement.');
  assert.deepEqual(reread._meta.report.results.flatMap(result=>result.findings)[0],originalFinding,'preparing a rewrite does not alter the finding');

  assert.equal(start.structuredContent.run.state, 'awaiting_review');
  assert.equal(start.structuredContent.report.files[0].patch, undefined, 'raw patches are fetched on demand');
  assert.ok(start._meta.report.files[0].patch);
  await client.callTool({ name: 'shelob.review', arguments: { runId }, _meta: { 'openai/session': 'chat-a' } });
  const open = await client.callTool({ name: 'shelob.review', arguments: {}, _meta: { 'openai/session': 'chat-a' } });
  assert.equal(open.structuredContent.run.id, runId);
  const sidebar = await client.callTool({ name: 'shelob.open', arguments: {}, _meta: { 'openai/session': 'chat-a' } });
  assert.equal(sidebar.structuredContent.entrypoint, 'global');
  assert.equal(sidebar.structuredContent.run, undefined, 'sidebar launch starts at home even when the chat has a report');
  assert.ok(sidebar.structuredContent.reviews.some(review => review.id === runId));
  const other = await client.callTool({ name: 'shelob.review', arguments: {}, _meta: { 'openai/session': 'chat-b' } });
  assert.equal(other.structuredContent.run, undefined);
  await client.callTool({ name: 'shelob.get', arguments: { runId }, _meta: { 'openai/session': 'chat-b' } });
  assert.equal((await client.callTool({ name: 'shelob.review', arguments: {}, _meta: { 'openai/session': 'chat-b' } })).structuredContent.run, undefined, 'reading history does not associate the run with another conversation');
  const source = await client.callTool({ name: 'shelob.source', arguments: { runId, operation: 'read', file: 'src/discount.test.ts' } });
  assert.match(source.structuredContent.content, /it.skip/);
  const protocol = await client.callTool({ name: 'shelob.protocol', arguments: {} });
  assert.equal(protocol.structuredContent.assessmentSchema.properties.schemaVersion.const, '1.0.0');
  const report = start.structuredContent.report;
  const assessments = { schemaVersion: '1.0.0', snapshotId: report.snapshot.id, assessments: report.results.filter(result => result.mode === 'contextual' && result.matchedFiles.length && (result.ruleId !== 'DESCRIPTION-001' || report.description?.text)).map(result => ({ ruleId: result.ruleId, status: 'not_assessed', reason: 'Fixture intentionally leaves this judgment unresolved.' })) };
  const final = await client.callTool({ name: 'shelob.finalize', arguments: { runId, assessments } });
  assert.equal(final.isError, undefined); assert.equal(final.structuredContent.run.state, 'complete');
  assert.ok(fs.existsSync(final.structuredContent.outputs.html));
  const failure = await client.callTool({ name: 'shelob.get', arguments: { runId: '00000000-0000-4000-8000-000000000000' } });
  assert.equal(failure.isError, true);
  assert.equal(diagnostics, '');
  await client.close();
  const restarted = new Client({ name: 'shelob-restart-test', version: '1.0.0' });
  await restarted.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('plugins/shelob/server/dist/index.mjs')], env: { ...process.env, SHELOB_DATA_DIR: root }, stderr: 'pipe' }));
  t.after(() => restarted.close());
  const restored = await restarted.callTool({ name: 'shelob.review', arguments: {}, _meta: { 'openai/session': 'chat-a' } });
  assert.equal(restored.structuredContent.run.id, runId);
  assert.equal(restored.structuredContent.run.state, 'complete');
  assert.equal((await restarted.callTool({ name: 'shelob.open', arguments: {} })).structuredContent.reviews.length, 1);
  const model = (await restarted.callTool({ name: 'shelob.rules', arguments: {} })).structuredContent;
  const rule = { id: 'CUSTOM-001', title: 'API contracts', category: 'Contracts', mode: 'contextual', severity: 'warning', scope: ['**'], rationale: 'Preserve caller expectations.', instructions: 'Trace callers and report a concrete incompatible behavior.' };
  const saved = await restarted.callTool({ name: 'shelob.rule_save', arguments: { revision: model.revision, rule } });
  assert.equal(saved.structuredContent.pack.rules.length, 10);
  const stale = await restarted.callTool({ name: 'shelob.rule_save', arguments: { revision: model.revision, rule } });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /changed in another window/);
});

test('the app survives removal of its version cache and stale resource addresses load the current bundle', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-upgrade-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.mkdirSync(path.join(root, 'schemas'));
  fs.mkdirSync(path.join(root, 'references'));
  fs.mkdirSync(path.join(root, 'app/dist'), { recursive: true });
  fs.copyFileSync(new URL('../plugin.json', import.meta.url), path.join(root, 'plugin.json'));
  fs.copyFileSync(new URL('../assets/sidebar-icon.svg', import.meta.url), path.join(root, 'assets/sidebar-icon.svg'));
  fs.copyFileSync(new URL('../schemas/assessments.schema.json', import.meta.url), path.join(root, 'schemas/assessments.schema.json'));
  fs.copyFileSync(new URL('../references/review-protocol.md', import.meta.url), path.join(root, 'references/review-protocol.md'));
  const html = '<!doctype html><html><body>Current Shelob fixture</body></html>';
  fs.writeFileSync(path.join(root, 'app/dist/index.html'), html);
  const server = createServer({ root, store: new ReviewStore({ root: path.join(root, 'data') }) });
  const client = new Client({ name: 'shelob-upgrade-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const before = (await client.readResource({ uri: 'ui://shelob/review/app.html' })).contents[0];
  fs.rmSync(path.join(root, 'app'), { recursive: true }); fs.unlinkSync(path.join(root, 'plugin.json'));
  const launch = await client.callTool({ name: 'shelob.open', arguments: {} });
  assert.equal(launch.isError, undefined);
  for (const uri of ['ui://shelob/review/app.html', 'ui://shelob/review/0.4.2', 'ui://shelob/review/0.7.0']) {
    const resource = (await client.readResource({ uri })).contents[0];
    assert.equal(resource.text.replace(/<script type="application\/json" id="shelob-runtime">[^<]*<\/script>/, ""), html); assert.equal(resource.mimeType, before.mimeType);
  }
  await assert.rejects(client.readResource({ uri: 'ui://shelob/review/not-an-app' }), /Unknown Shelob app resource/);
});

test('MCP runs native review asynchronously and finalizes its validated output as a separate check', async t => {
  const sample = fixture(); t.after(sample.cleanup); sample.write('src/value.ts', 'export const value = 2;\n');
  const root = path.join(sample.root, 'mcp-data');
  const nativeReviewer = new NativeReviewer(async args => ({ code: 0, stdout: args.includes('list') ? '[]' : [
    { type: 'item.completed', item: { type: 'agent_message', text: 'No concrete regression found in the supplied default-value change.' } }, { type: 'turn.completed' },
  ].map(event => JSON.stringify(event)).join('\n') }));
  const store = new ReviewStore({ root, nativeReviewer });
  const server = createServer({ store }), client = new Client({ name: 'shelob-native-mcp-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  const started = await client.callTool({ name: 'shelob.start', arguments: { kind: 'local', repo: sample.repo, base: 'main' } });
  const runId = started.structuredContent.run.id;
  const launching = await client.callTool({ name: 'shelob.code_review', arguments: { runId } });
  assert.equal(launching.structuredContent.nativeReview.status, 'running');
  let result;
  for (let i = 0; i < 20; i++) { await new Promise(resolve => setImmediate(resolve)); result = await client.callTool({ name: 'shelob.get', arguments: { runId } }); if (result.structuredContent.nativeReview.status !== 'running') break; }
  assert.equal(result.structuredContent.nativeReview.status, 'completed');
  assert.match(result.structuredContent.nativeReview.output, /No concrete regression/);
  const final = await client.callTool({ name: 'shelob.finalize', arguments: { runId, assessments: { schemaVersion: '1.0.0', snapshotId: result.structuredContent.report.snapshot.id,
    codeReview: { status: 'assessed', reason: 'Native output and the changed default were checked.', outputDigest: result.structuredContent.nativeReview.outputDigest }, assessments: [] } } });
  assert.equal(final.isError, undefined);
  assert.equal(final.structuredContent.report.results[0].status, 'assessed');
  assert.equal(final.structuredContent.report.analysis.codeReview.status, 'completed');
  assert.ok(final.structuredContent.report.results.some(result => result.status === 'not_assessed'), 'selected contextual rules remain incomplete when omitted');
});
