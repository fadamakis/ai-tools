import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ReviewStore } from '../server/store.mjs';
import { reviewDecision } from '../assets/review-decision.mjs';
import { reviewVerdict } from '../assets/report-model.mjs';
import { reviewAction } from '../app/review-action.mjs';
import { reviewResult } from '../server/index.mjs';
import { digest } from '../scripts/lib/git.mjs';
import { fixture } from './fixtures.mjs';

test('source search resumes within a file and across files without losing matching lines', async t => {
  const sample = fixture({ 'a.txt': 'needle first\nneedle second\nneedle third\n', 'b.txt': 'needle fourth\n' }); t.after(sample.cleanup);
  sample.write('a.txt', 'needle first\nneedle second\nneedle third\nchanged\n');
  const store = new ReviewStore({ root: path.join(sample.root, 'data') });
  const { run } = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  for (const file of [undefined, 'a.txt']) {
    const found = []; let offset = 0, line = 1;
    for (let page = 0; page < 10; page++) {
      const result = store.inspect(run.id, { operation: 'search', query: 'needle', limit: 1, file, offset, line });
      found.push(...result.matches.map(match => `${match.path}:${match.line}`));
      if (result.nextOffset === null) break;
      assert.ok(Number.isInteger(result.nextLine), 'truncated search must provide a resumable source position');
      offset = result.nextOffset; line = result.nextLine;
    }
    assert.deepEqual(found, file ? ['a.txt:1', 'a.txt:2', 'a.txt:3'] : ['a.txt:1', 'a.txt:2', 'a.txt:3', 'b.txt:1']);
  }
});

test('an active PR review without a freshness receipt stays in progress in sidebar and report actions', () => {
  const report = { source: { kind: 'github_pr', reviewMode: 'pr_only' }, files: [],
    analysis: { execution: { state: 'pending', label: 'Review in progress · PR-only' }, codeReview: { required: true, status: 'running' } },
    results: [{ ruleId: 'CODEX-REVIEW', mode: 'codex', status: 'not_assessed', findings: [], reason: 'Native Codex review is running.' }] };
  const run = { state: 'awaiting_review' }, verdict = reviewVerdict(report.results, { report, runState: run.state });
  const decision = reviewDecision(report, { verdict, execution: report.analysis.execution });
  assert.equal(decision.state, 'progress');
  assert.deepEqual(reviewAction({ decision, run, isPr: true, nativeRunning: true }), { kind: 'running', label: 'Review in progress' });
  assert.equal(verdict.state, 'progress');
  report.freshness = { status: 'outdated', message: 'Head changed.' };
  assert.equal(reviewDecision(report, { verdict, execution: report.analysis.execution }).state, 'stale');
});

test('an active server can finish a pinned review and serve protocol and default rules after its old cache is removed', async t => {
  const sample = fixture(); t.after(sample.cleanup); sample.write('src/value.ts', 'export const value = 2;\n');
  const plugin = path.join(sample.root, 'old-version-cache');
  fs.cpSync(new URL('../', import.meta.url), plugin, { recursive: true });
  const { ReviewStore: IsolatedStore } = await import(pathToFileURL(path.join(plugin, 'server/store.mjs')));
  const { createServer } = await import(pathToFileURL(path.join(plugin, 'server/index.mjs')));
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const store = new IsolatedStore({ root: path.join(sample.root, 'data'), nativeReviewer: { async review({ directory, report }) {
    await pending;
    fs.mkdirSync(directory, { recursive: true });
    const output = 'No demonstrated regression in the changed default.', outputFile = path.join(directory, 'output.txt');
    fs.writeFileSync(outputFile, output);
    return { status: 'completed', snapshotId: report.snapshot.id, engine: 'codex exec review', outputDigest: digest(output), outputFile };
  } } });
  const server = createServer({ store, root: plugin }), client = new Client({ name: 'shelob-upgrade-lifecycle', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  t.after(async () => { finish(); await client.close(); await server.close(); });
  const { run, report } = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  const initialBytes = fs.readFileSync(run.initial.json, 'utf8');
  assert.equal((await store.codeReview(run.id, { wait: false })).nativeReview.status, 'running');
  fs.rmSync(plugin, { recursive: true });
  assert.match(store.inspect(run.id, { operation: 'read', file: 'src/value.ts' }).content, /value = 2/);
  const failures = [];
  for (const name of ['shelob.protocol', 'shelob.rules']) {
    const result = await client.callTool({ name, arguments: {} });
    if (result.isError) failures.push(`${name}: ${result.content[0].text}`);
  }
  finish();
  let reviewed;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolve => setImmediate(resolve)); reviewed = store.get(run.id);
    if (reviewed.nativeReview.status !== 'running') break;
  }
  assert.equal(reviewed.nativeReview.status, 'completed');
  try {
    const final = await store.finalize(run.id, { schemaVersion: '1.0.0', snapshotId: report.snapshot.id, assessments: [],
      codeReview: { outputDigest: reviewed.nativeReview.outputDigest, status: 'assessed', reason: 'Checked the supplied before and after source.' } });
    assert.equal(final.run.state, 'complete');
    assert.ok(fs.readFileSync(final.run.final.html, 'utf8').includes('Shelob'));
    assert.equal(fs.readFileSync(run.initial.json, 'utf8'), initialBytes);
  } catch (error) { failures.push(`finalize: ${error.message}`); }
  try { assert.equal((await store.start({ kind: 'local', repo: sample.repo, base: 'main' })).run.state, 'awaiting_review'); }
  catch (error) { failures.push(`start: ${error.message}`); }
  assert.deepEqual(failures, []);
});

test('terminating a preparing or native-review process recovers as interrupted or failed after restart', async t => {
  for (const phase of ['preparing', 'native']) {
    const sample = fixture(); t.after(sample.cleanup); sample.write('src/value.ts', 'export const value = 2;\n');
    const root = path.join(sample.root, 'data');
    const child = fork(new URL('./helpers/interrupted-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    const response = once(child, 'message');
    child.send({ root, repo: sample.repo, phase });
    const [{ id, nativeStatus }] = await response;
    if (phase === 'native') assert.equal(nativeStatus, 'running');
    const before = fs.readFileSync(path.join(root, 'runs', id, 'run.json'), 'utf8');
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    const store = new ReviewStore({ root }), recovered = store.get(id), listed = store.list().find(row => row.id === id);
    if (phase === 'preparing') {
      assert.equal(recovered.run.state, 'interrupted'); assert.equal(listed.state, 'interrupted'); assert.match(recovered.run.error, /stopped/);
    } else {
      assert.equal(recovered.nativeReview.status, 'failed'); assert.equal(recovered.report.analysis.execution.state, 'failed');
      assert.equal(listed.execution.state, 'failed'); assert.equal(listed.decision.state, 'failed');
      assert.ok(recovered.report.snapshot.id); assert.ok(fs.existsSync(recovered.run.initial.html));
      assert.notEqual(listed.verdict.state, 'approve');
    }
    assert.equal(fs.readFileSync(path.join(root, 'runs', id, 'run.json'), 'utf8'), before, 'reading recovery preserves saved history');
  }
});

test('legacy pending snapshots require a fresh run while completed historical reports remain readable', async t => {
  const sample = fixture(); t.after(sample.cleanup); sample.write('src/value.ts', 'export const value = 2;\n');
  const store = new ReviewStore({ root: path.join(sample.root, 'data') });
  const { run, report } = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  const legacy = structuredClone(report); legacy.pluginVersion = '0.10.0';
  fs.writeFileSync(run.initial.json, JSON.stringify(legacy));
  const before = fs.readFileSync(run.initial.json, 'utf8');
  const pending = reviewResult(store.get(run.id), '0.11.3').structuredContent;
  assert.equal(pending.run.requiresRerun, true); assert.deepEqual(pending.restart, run.request);
  const saved = store.manifest(run.id); saved.state = 'complete'; saved.final = run.initial; store.save(saved);
  const completed = reviewResult(new ReviewStore({ root: store.root }).get(run.id), '0.11.3').structuredContent;
  assert.equal(completed.run.requiresRerun, false); assert.equal(completed.report.pluginVersion, '0.10.0');
  assert.equal(store.list()[0].id, run.id); assert.equal(fs.readFileSync(run.initial.json, 'utf8'), before);
});
