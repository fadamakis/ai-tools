import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCodexCli } from '../server/codex-cli.mjs';
import { ReviewSettings } from '../server/settings.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-cli-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = relative => {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o700 }); return file;
  };
  return { root, write, options: { env: { PATH: path.join(root, 'bin') }, platform: 'darwin', applicationDirectories: [path.join(root, 'Applications')] } };
}

test('an MCP server without CODEX_CLI_PATH selects the app CLI ahead of an older PATH install', t => {
  const { write, options } = fixture(t);
  write('bin/codex');
  const bundled = write('Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  assert.equal(resolveCodexCli(options), bundled);
  const custom = write('custom/codex');
  assert.equal(resolveCodexCli({ ...options, env: { ...options.env, CODEX_CLI_PATH: custom } }), custom);
  const absent = `${custom}-missing`;
  assert.equal(resolveCodexCli({ ...options, env: { ...options.env, CODEX_CLI_PATH: absent } }), absent, 'never silently replace an explicit override');
});

test('PATH remains available outside macOS and when the desktop CLI is absent or not executable', t => {
  const { write, options } = fixture(t);
  const installed = write('bin/codex');
  assert.equal(resolveCodexCli(options), installed);
  const bundled = write('Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  fs.chmodSync(bundled, 0o600);
  assert.equal(resolveCodexCli(options), installed);
  fs.chmodSync(bundled, 0o700);
  assert.equal(resolveCodexCli({ ...options, platform: 'linux' }), installed);
});

test('a CLI replacement invalidates a saved rejection even when its PATH command name is unchanged', t => {
  const { root, write } = fixture(t);
  const first = write('bin/first'), second = write('bin/second'), link = path.join(root, 'bin/codex');
  fs.symlinkSync(first, link);
  const original = process.env.CODEX_CLI_PATH;
  process.env.CODEX_CLI_PATH = link;
  t.after(() => { if (original === undefined) delete process.env.CODEX_CLI_PATH; else process.env.CODEX_CLI_PATH = original; });
  const settings = new ReviewSettings(path.join(root, 'settings'));
  const signature = settings.signature('chosen-model');
  settings.recordFailure(signature, 'The model is not supported.');
  assert.ok(settings.rejected(settings.signature('chosen-model')));
  fs.unlinkSync(link); fs.symlinkSync(second, link);
  assert.equal(settings.rejected(settings.signature('chosen-model')), null);
  const replacementSignature = settings.signature('chosen-model');
  fs.appendFileSync(second, '# replaced\n');
  assert.notEqual(settings.signature('chosen-model'), replacementSignature);
});
