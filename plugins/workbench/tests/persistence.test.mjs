import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { promises as io } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BoardPersistence } from '../server/persistence.mjs';
import { migrateLock } from '../scripts/migrate-lock.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-persistence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new BoardPersistence(root);
}

test('legacy locks require offline recovery, retain diagnostics and never remove a living owner', async t => {
  const store = fixture(t);
  for (const value of ['', 'not-a-pid', '2147483647']) {
    fs.writeFileSync(store.lockfile, value);
    await assert.rejects(store.mutate(() => {}), /offline recovery/);
    assert.throws(() => migrateLock({ root: store.root }), /Stop all old/);
    const result = migrateLock({ root: store.root, writersStopped: true });
    assert.equal(fs.readFileSync(result.archived, 'utf8'), value);
    await store.mutate(data => { data.marker = value; });
    assert.equal(store.read().marker, value);
  }
  fs.writeFileSync(store.lockfile, String(process.pid));
  assert.throws(() => migrateLock({ root: store.root, writersStopped: true }), /alive/);
  assert.equal(fs.readFileSync(store.lockfile, 'utf8'), String(process.pid));
});

test('a killed lock owner leaves a recoverable stale directory without corrupting board data', async t => {
  const store = fixture(t);
  await store.mutate(data => { data.marker = 'before'; });
  const locking = new URL('../server/dist/locking.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import lockfile from ${JSON.stringify(locking)}; await lockfile.lock(${JSON.stringify(store.root)}, {lockfilePath:${JSON.stringify(store.lockfile)},stale:60000,update:10000});process.stdout.write('locked');setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await once(child.stdout, 'data');
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  assert.equal(store.read().marker, 'before');
  const stale = new Date(Date.now() - 61000); fs.utimesSync(store.lockfile, stale, stale);
  await store.mutate(data => { data.marker = 'after'; });
  assert.equal(store.read().marker, 'after');
  assert.equal(fs.existsSync(store.lockfile), false);
});

test('failed temporary writes and lost ownership preserve the complete previous board', async t => {
  const store = fixture(t); await store.mutate(data => { data.marker = 'before'; });
  const before = fs.readFileSync(store.filename), original = io.open;
  for (const failure of ['sync', 'ownership', 'replacement']) {
    io.open = async (...args) => {
      const handle = await original(...args);
      if (String(args[0]).includes('.board-')) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (failure === 'sync') throw new Error('Injected write failure');
          await sync(); fs.renameSync(store.lockfile, store.lockfile + '.lost');
          if (failure === 'replacement') fs.mkdirSync(store.lockfile);
        };
      }
      return handle;
    };
    try { await assert.rejects(store.mutate(data => { data.marker = 'after'; })); }
    finally { io.open = original; }
    assert.deepEqual(fs.readFileSync(store.filename), before);
    assert.equal(fs.readdirSync(store.root).some(name => name.startsWith('.board-')), false);
    if (failure === 'replacement') { assert.equal(fs.statSync(store.lockfile).isDirectory(), true); fs.rmdirSync(store.lockfile); }
    if (fs.existsSync(store.lockfile + '.lost')) fs.rmdirSync(store.lockfile + '.lost');
  }
});

test('competing asynchronous saves serialize without losing successful updates', async t => {
  const store = fixture(t), second = new BoardPersistence(store.root);
  await Promise.all([store.mutate(data => { data.count = (data.count || 0) + 1; }), second.mutate(data => { data.count = (data.count || 0) + 1; })]);
  assert.equal(store.read().count, 2);
  assert.equal(fs.statSync(store.filename).mode & 0o777, 0o600);
});
