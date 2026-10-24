import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { configuredProjectRoots, discoverRepositories, pickRepositoryFolder, folderPickerScript } from '../server/repository-import.mjs';
import { fixture, registered, checkpoint } from './fixtures.mjs';

test('discovery reads only project section keys, including spaces and quoted keys', async () => {
  const roots = configuredProjectRoots(`[projects."/work/my app"]\ntrust_level = "trusted"\n[projects.'/work/second'] # comment\n[projects."/work/my app"]\n[mcp_servers."/not/a/project"]\n[projects."relative/path"]\n[projects."/broken\\q"]\n`);
  assert.deepEqual(roots, ['/work/my app', '/work/second']);
});

test('configured repositories are discovered without importing or changing saved progress', async t => {
  const sample = fixture(); t.after(sample.cleanup);
  const task = (await checkpoint(sample.store, (await registered(sample))));
  const before = fs.readFileSync(sample.store.filename), original = fs.readFileSync(sample.legacyNote);
  fs.writeFileSync(path.join(path.dirname(sample.legacyNote), 'EX-456.md'), '# Another task\n');
  const configPath = path.join(sample.directory, 'config.toml');
  fs.writeFileSync(configPath, `[projects.${JSON.stringify(sample.repo)}]\ntrust_level="trusted"\n[projects."/missing/repository"]\n`);
  const result = await discoverRepositories({ configPath, board: sample.store.list() });
  assert.equal(result.repositories.length, 1); assert.equal(result.repositories[0].taskCount, 2); assert.equal(result.repositories[0].importableTaskCount, 1);
  assert.deepEqual(fs.readFileSync(sample.store.filename), before); assert.deepEqual(fs.readFileSync(sample.legacyNote), original);
  assert.equal(sample.store.get(task.id).task.stage, 'build');
});

test('discovery deduplicates worktrees and considers preview notes without guessing their stage', async t => {
  const sample = fixture(); t.after(sample.cleanup);
  const worktree = path.join(sample.directory, 'worktree'); sample.git('worktree', 'add', '-b', 'discovery', worktree);
  const notes = path.join(sample.repo, '.git/workbench-preview'); fs.mkdirSync(notes);
  fs.writeFileSync(path.join(notes, 'EX-123.md'), '# Preview continuation\n');
  fs.writeFileSync(path.join(notes, 'EX-789.md'), '# Another preview task\n');
  const result = await discoverRepositories({ roots: [sample.repo, worktree] });
  assert.equal(result.repositories.length, 1); assert.equal(result.repositories[0].taskCount, 2);
  assert.equal((await sample.store.addRepository(sample.repo)).imported, 2);
  const task = sample.store.list().tasks.find(task => task.key === 'EX-123');
  assert.equal(task.stage, 'backlog'); assert.equal(task.status, 'unverified');
  assert.equal(sample.store.get(task.id).noteIsLegacy, false); assert.match(sample.store.get(task.id).note, /Preview continuation/);
  assert.equal((await sample.store.addRepository(sample.repo)).imported, 0);
});

test('unavailable config keeps registered repositories discoverable and never recursively searches parents', async t => {
  const sample = fixture(); t.after(sample.cleanup); (await sample.store.addRepository(sample.repo, false));
  const result = await discoverRepositories({ configPath: path.join(sample.directory, 'missing'), board: sample.store.list() });
  assert.equal(result.configUnavailable, true); assert.equal(result.repositories.length, 1);
  assert.equal((await discoverRepositories({ roots: [sample.directory] })).repositories.length, 0);
});

test('folder picker returns the native selection through argument-safe execution', async () => {
  let invocation;
  const result = await pickRepositoryFolder({ platform: 'darwin', run: async (...args) => { invocation = args; return { stdout: "/Users/you/a folder's repository/\n" }; } });
  assert.deepEqual(result, { path: "/Users/you/a folder's repository/", cancelled: false });
  assert.equal(invocation[0], '/usr/bin/osascript'); assert.deepEqual(invocation[1], ['-e', folderPickerScript]);
  assert.equal(invocation[2].shell, undefined);
});

test('folder picker distinguishes cancellation, timeout and unsupported hosts', async () => {
  const cancelled = await pickRepositoryFolder({ platform: 'darwin', run: async () => { throw Object.assign(new Error('Cancelled'), { stderr: 'User canceled. (-128)' }); } });
  assert.deepEqual(cancelled, { cancelled: true });
  await assert.rejects(() => pickRepositoryFolder({ platform: 'darwin', run: async () => { throw Object.assign(new Error('Stopped'), { killed: true }); } }), /timed out/);
  await assert.rejects(() => pickRepositoryFolder({ platform: 'linux' }), /available on macOS/);
});
