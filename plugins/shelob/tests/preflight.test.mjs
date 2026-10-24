import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReviewPreflight, connectionLifetimeMs, storeFingerprint } from '../server/preflight.mjs';
import { ApprovalPolicy } from '../server/auto-approval.mjs';
import { ReviewStore } from '../server/store.mjs';

const target = { repository: 'example/repo', prNumber: 42, headSha: 'a'.repeat(40) };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ReviewStore({ root }), policy = new ApprovalPolicy(root);
  let time = 1_000_000, alive = true;
  const options = { store, policy, version: '0.11.8', runtimeFingerprint: 'b'.repeat(64), clock: () => time, alive: () => alive };
  const ui = new ReviewPreflight(options), worker = new ReviewPreflight(options);
  const connect = (server = ui, extra = {}) => {
    const args = { resourceNonce: server.resource().resourceNonce, connectionId: randomUUID(), appVersion: server.version, visible: true, ...extra };
    return { args, result: server.heartbeat(args) };
  };
  return { root, store, policy, ui, worker, options, connect, tick: ms => { time += ms; }, stop: () => { alive = false; } };
}
function savedRun(f, { headSha = target.headSha, state = 'complete', completed = true, prNumber = 42 } = {}) {
  const id = randomUUID(), directory = f.store.directory(id); fs.mkdirSync(directory);
  const source = { kind: 'github_pr', url: `https://github.com/example/repo/pull/${prNumber}`, ...(headSha ? { headSha } : {}) };
  const run = { storeVersion: 1, id, state, ownerPid: process.pid, createdAt: new Date(1_000_000).toISOString(), source };
  if (state !== 'preparing') {
    const file = path.join(directory, 'report.json');
    const report = { source, snapshot: { id: 'c'.repeat(64) }, analysis: { execution: { state: completed ? 'completed' : 'incomplete' } }, results: [] };
    fs.writeFileSync(file, JSON.stringify(report)); run.initial = { json: file };
  }
  fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify(run));
  return id;
}

test('starting another server and reading a UI resource do not create UI proof or write store data', t => {
  const f = fixture(t), before = fs.readdirSync(f.root);
  f.ui.resource();
  for (const server of [f.ui, f.worker]) {
    const readback = server.read({ target });
    assert.equal(readback.status, 'ui_unverified'); assert.equal(readback.safeToReview, false);
    assert.equal(readback.policy.enabled, false); assert.equal(readback.history.complete, true);
    assert.equal(JSON.stringify(readback).includes(f.root), false);
    assert.equal(JSON.stringify(readback).includes('resourceNonce'), false);
  }
  assert.deepEqual(fs.readdirSync(f.root), before);
});
test('a visible UI handshake lets a different process identity verify the same store and disabled policy', t => {
  const f = fixture(t), { result } = f.connect(), connectionId = result.connection.connectionId;
  const file = path.join(f.root, 'ui-connections', `${connectionId}.json`), before = fs.readFileSync(file, 'utf8');
  const readback = f.worker.read({ target, connectionId, expectedStoreFingerprint: result.connection.storeFingerprint });
  assert.equal(readback.status, 'matched'); assert.equal(readback.decision, 'ready'); assert.equal(readback.safeToReview, true);
  assert.equal(readback.ui.sameServerProcess, false);
  assert.notEqual(readback.ui.serverInstanceId, readback.server.serverInstanceId);
  assert.deepEqual(readback.automaticPublicActions, []); assert.equal(readback.manualPublicationRequiresConfirmation, true);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'preflight is a read-only operation');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
test('arbitrary nonces, a second window reusing a nonce and an older app cannot claim a connection', t => {
  const f = fixture(t), { args } = f.connect();
  assert.throws(() => f.worker.heartbeat(args), /Reopen Shelob/);
  assert.throws(() => f.ui.heartbeat({ ...args, connectionId: randomUUID() }), /another Shelob window/);
  assert.throws(() => f.ui.heartbeat({ ...args, appVersion: '0.11.7' }), /older app/);
});
test('expired, hidden, future-dated and stopped UI connections cannot clear preflight', t => {
  const f = fixture(t), { args } = f.connect();
  f.tick(connectionLifetimeMs); assert.equal(f.worker.read({ connectionId: args.connectionId }).status, 'stale_ui_connection');
  f.ui.heartbeat({ ...args, visible: false }); assert.equal(f.worker.read({ connectionId: args.connectionId }).status, 'stale_ui_connection');
  f.ui.heartbeat(args); f.tick(-1); assert.equal(f.worker.read({ connectionId: args.connectionId }).status, 'stale_ui_connection');
  f.tick(1); f.stop(); assert.equal(f.worker.read({ connectionId: args.connectionId }).status, 'ui_server_stopped');
});
test('a stale server version or changed runtime is distinguished from a matching store', t => {
  const f = fixture(t), { args } = f.connect();
  for (const options of [{ version: '0.11.9' }, { runtimeFingerprint: 'd'.repeat(64) }]) {
    const next = new ReviewPreflight({ ...f.options, ...options });
    assert.equal(next.read({ connectionId: args.connectionId }).status, 'stale_ui_server');
  }
});
test('an expected store mismatch and a copied UI receipt fail, while a store symlink agrees', t => {
  const f = fixture(t), other = fixture(t), { args } = f.connect();
  assert.equal(f.worker.read({ expectedStoreFingerprint: storeFingerprint(other.root) }).status, 'store_mismatch');
  fs.cpSync(path.join(f.root, 'ui-connections'), path.join(other.root, 'ui-connections'), { recursive: true });
  assert.equal(other.worker.read({ connectionId: args.connectionId }).status, 'store_mismatch');
  const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.root, alias);
  assert.equal(storeFingerprint(alias), storeFingerprint(f.root));
});
test('enabled automatic approval blocks and policy changes require a fresh UI acknowledgment', t => {
  const f = fixture(t), { args } = f.connect();
  f.policy.save({ enabled: true, revision: f.policy.get().revision });
  let readback = f.worker.read({ target });
  assert.equal(readback.safeToReview, false); assert.ok(readback.blockers.includes('automatic_approval_enabled'));
  assert.equal(readback.status, 'stale_ui_policy'); assert.deepEqual(readback.automaticPublicActions, ['approve_clean_review']);
  f.ui.heartbeat(args); assert.equal(f.worker.read({ target }).status, 'matched');
  assert.equal(f.worker.read({ target }).safeToReview, false);
  f.policy.save({ enabled: false, revision: f.policy.get().revision });
  assert.equal(f.worker.read({ target }).status, 'stale_ui_policy');
  f.ui.heartbeat(args); assert.equal(f.worker.read({ target }).safeToReview, true);
});
test('multiple visible windows require selecting a connection instead of guessing which UI is current', t => {
  const f = fixture(t), first = f.connect(); f.connect();
  assert.equal(f.worker.read({ target }).status, 'choose_ui_connection');
  assert.equal(f.worker.read({ target, connectionId: first.args.connectionId }).safeToReview, true);
});
test('malformed policy and invalid connection records cannot manufacture safety proof', t => {
  const f = fixture(t), { args } = f.connect();
  fs.writeFileSync(path.join(f.root, 'ui-connections', `${args.connectionId}.json`), '{}');
  assert.equal(f.worker.read({ target }).safeToReview, false);
  fs.writeFileSync(path.join(f.root, 'approval-policy.json'), '{}');
  assert.throws(() => f.worker.read({ target }), /Approval settings are invalid/);
});
test('exact PR/head dedup skips completed work, distinguishes old heads and blocks overlapping active work', t => {
  const f = fixture(t); f.connect();
  savedRun(f, { headSha: 'd'.repeat(40) }); savedRun(f, { prNumber: 43 });
  let readback = f.worker.read({ target });
  assert.equal(readback.decision, 'ready'); assert.equal(readback.history.reviews.length, 1);
  const active = savedRun(f, { state: 'awaiting_review', completed: false });
  readback = f.worker.read({ target }); assert.equal(readback.decision, 'join_active'); assert.equal(readback.safeToReview, false);
  assert.ok(readback.history.reviews.some(run => run.runId === active && run.active));
  savedRun(f); readback = f.worker.read({ target }); assert.equal(readback.decision, 'skip_completed');
  assert.equal(readback.safeToReview, false); assert.equal(readback.history.scope, 'this_store_only');
});
test('unreadable runs and an unpinned head leave deduplication explicitly incomplete', t => {
  const f = fixture(t); f.connect(); const id = savedRun(f);
  fs.writeFileSync(path.join(f.store.directory(id), 'run.json'), '{');
  let readback = f.worker.read({ target }); assert.equal(readback.history.complete, false);
  assert.ok(readback.blockers.includes('history_incomplete')); assert.equal(readback.safeToReview, false);
  fs.rmSync(f.store.directory(id), { recursive: true }); savedRun(f, { headSha: null, state: 'awaiting_review', completed: false });
  readback = f.worker.read({ target }); assert.ok(readback.blockers.includes('review_head_unknown'));
});
test('an empty abandoned directory is reported separately from a nonempty unreadable saved attempt', t => {
  const f = fixture(t); f.connect(); const directory = f.store.directory(randomUUID()); fs.mkdirSync(directory);
  let readback = f.worker.read({ target });
  assert.equal(readback.history.emptyDirectoryCount, 1); assert.equal(readback.history.complete, true);
  assert.equal(readback.safeToReview, true);
  fs.writeFileSync(path.join(directory, 'rules.json'), '{}');
  readback = f.worker.read({ target }); assert.equal(readback.history.complete, false); assert.equal(readback.safeToReview, false);
});
