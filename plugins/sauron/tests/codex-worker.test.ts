import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCodexWorker } from '../src/server/codex-worker.js';

function fixture(t: any, program: string) {
  const directory = mkdtempSync(join(tmpdir(), 'sauron-worker-test-'));
  const runtime = join(directory, 'runtime.cjs');
  writeFileSync(runtime, '#!/usr/bin/env node\n' + program, { mode: 0o700 });
  const previous = process.env.SAURON_CODEX_BIN;
  process.env.SAURON_CODEX_BIN = runtime;
  t.after(() => {
    if (previous === undefined) delete process.env.SAURON_CODEX_BIN;
    else process.env.SAURON_CODEX_BIN = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const request = { prompt: 'Read this exact task.', schema: { type: 'object' }, prefix: `sauron-worker-${randomUUID()}-`, maxOutputLength: 4096 };
  const cleaned = () => assert.equal(readdirSync(tmpdir()).some(name => name.startsWith(request.prefix)), false);
  return { request, cleaned, directory };
}

test('worker passes the prompt and schema through private files and cleans up successful output', async t => {
  const { request, cleaned } = fixture(t, `
const fs = require('node:fs');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
let prompt = '';
process.stdin.on('data', chunk => prompt += chunk);
process.stdin.on('end', () => {
  const schema = arg('--output-schema');
  fs.writeFileSync(arg('--output-last-message'), JSON.stringify({ prompt, schema: JSON.parse(fs.readFileSync(schema)),
    directoryMode: fs.statSync(arg('--cd')).mode & 0o777, schemaMode: fs.statSync(schema).mode & 0o777 }));
});`);
  assert.deepEqual(await runCodexWorker(request), { prompt: 'Read this exact task.', schema: { type: 'object' }, directoryMode: 0o700, schemaMode: 0o600 });
  cleaned();
});

test('worker failures reject without leaving private task files', async t => {
  const programs = [
    ['nonzero exit', 'process.exit(1)', /runtime/],
    ['invalid JSON', "require('node:fs').writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1], 'not json')", /JSON/],
    ['oversized JSON', "require('node:fs').writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1], JSON.stringify('x'.repeat(5000)))", /invalid/],
    ['timeout', 'setInterval(() => {}, 1000)', /timeout/],
  ] as const;
  for (const [name, program, error] of programs) await t.test(name, async t => {
    const { request, cleaned } = fixture(t, program);
    await assert.rejects(runCodexWorker({ ...request, timeoutMs: 1000 }), error);
    cleaned();
  });
  await t.test('startup failure', async t => {
    const { request, cleaned, directory } = fixture(t, '');
    process.env.SAURON_CODEX_BIN = join(directory, 'missing-runtime');
    await assert.rejects(runCodexWorker(request), /runtime/);
    cleaned();
  });
});
