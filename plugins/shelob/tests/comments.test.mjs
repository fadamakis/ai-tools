import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommentPublisher } from '../server/comments.mjs';
import { GitHubSource, command } from '../server/github.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-comments-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let time = Date.now(); const posts = [];
  const source = { kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) };
  const run = { id: '12345678-1234-4123-8123-123456789abc', state: 'complete', source };
  const finding = { id: 'TEST-003:abcdef', title: 'Later chunks are untested', message: 'The failure path leaves later chunks unsent.', nextAction: 'Add a failure case.', severity: 'warning', evidence: [{ path: 'src/test.ts', side: 'after', line: 12 }], comment: 'Could we cover failure before a later chunk is sent?' };
  const report = { snapshot: { id: 'c'.repeat(64) }, freshness: { status: 'current' }, description: { text: 'Description' }, results: [{ findings: [finding] }] };
  const latest = { source: { ...source }, description: 'Description' };
  const store = { directory: id => { if (id !== run.id) throw new Error('Wrong run'); return root; }, get: id => { if (id !== run.id) throw new Error('Wrong run'); return { run, report }; }, github: {
    metadata: async () => latest,
    postComment: async (url, body) => { posts.push({ url, body }); return { id: 99, url: `${url}#issuecomment-99` }; },
  } };
  const publisher = new CommentPublisher(store, { clock: () => time });
  return { root, publisher, store, posts, run, report, latest, finding, advance: ms => { time += ms; } };
}

test('comment preview is read-only; confirmation posts the exact text once without changing reports', async t => {
  const s = setup(t), before = JSON.stringify(s.report);
  const preview = await s.publisher.preview({ runId: s.run.id, findingId: s.finding.id, draft: 'Short edited comment.' });
  assert.equal(s.posts.length, 0);
  assert.equal(preview.url, s.run.source.url);
  assert.equal(preview.body, '[Medium] Later chunks are untested\n\nShort edited comment.\n\nsrc/test.ts:12 (after change)');
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: false }), /Confirm/);
  const result = await s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true });
  assert.deepEqual(s.posts, [{ url: preview.url, body: preview.body }]);
  assert.deepEqual(await s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), result);
  assert.equal(s.posts.length, 1);
  await assert.rejects(s.publisher.preview({ runId: s.run.id, findingId: s.finding.id }), /already posted/);
  assert.equal(JSON.stringify(s.report), before);
});

test('posting rejects expired, replaced, unknown, and wrong-run previews', async t => {
  const s = setup(t);
  const preview = await s.publisher.preview({ runId: s.run.id, findingId: s.finding.id });
  s.advance(300_001);
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /expired/);
  const newer = await s.publisher.preview({ runId: s.run.id, findingId: s.finding.id, draft: 'New wording.' });
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /unavailable/);
  await assert.rejects(s.publisher.post({ runId: 'other', previewId: newer.id, confirmed: true }), /Wrong run/);
  assert.equal(s.posts.length, 0);
});

test('both preview and posting reject changed PR commits, descriptions, and unavailable freshness', async t => {
  for (const change of ['headSha', 'baseSha', 'description', 'offline']) {
    const s = setup(t);
    const preview = await s.publisher.preview({ runId: s.run.id, findingId: s.finding.id });
    if (change === 'description') s.latest.description = 'Edited';
    else if (change === 'offline') s.store.github.metadata = async () => { throw new Error('Access unavailable'); };
    else s.latest.source[change] = 'd'.repeat(40);
    await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /changed|Access unavailable/);
    await assert.rejects(s.publisher.preview({ runId: s.run.id, findingId: s.finding.id }), /changed|Access unavailable/);
    assert.equal(s.posts.length, 0);
  }
});

test('local, unfinished, stale, or missing-finding reviews cannot prepare comments', async t => {
  for (const invalid of ['local', 'unfinished', 'stale', 'missing']) {
    const s = setup(t);
    if (invalid === 'local') s.run.source.kind = 'local';
    if (invalid === 'unfinished') s.run.state = 'awaiting_review';
    if (invalid === 'stale') s.report.freshness.status = 'outdated';
    await assert.rejects(s.publisher.preview({ runId: s.run.id, findingId: invalid === 'missing' ? 'missing' : s.finding.id }), /current PR review|not in the saved review/);
    assert.equal(s.posts.length, 0);
  }
});

test('uncertain delivery never retries automatically or allows another preview', async t => {
  const s = setup(t);
  s.store.github.postComment = async () => { s.posts.push('attempt'); throw new Error('Network timed out'); };
  const preview = await s.publisher.preview({ runId: s.run.id, findingId: s.finding.id });
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /could not confirm/);
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /uncertain/);
  await assert.rejects(s.publisher.preview({ runId: s.run.id, findingId: s.finding.id }), /delivery could not be confirmed/);
  assert.equal(s.posts.length, 1);
});

test('concurrent clicks cannot publish twice or replace an in-flight confirmation', async t => {
  const s = setup(t);
  let release;
  s.store.github.postComment = async () => { s.posts.push('attempt'); await new Promise(resolve => { release = resolve; }); return { id: 99, url: `${s.run.source.url}#issuecomment-99` }; };
  const preview = await s.publisher.preview({ runId: s.run.id, findingId: s.finding.id });
  const pending = s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /already being posted/);
  await assert.rejects(s.publisher.preview({ runId: s.run.id, findingId: s.finding.id }), /already being prepared or posted/);
  release(); await pending;
  assert.equal(s.posts.length, 1);
});

test('GitHub comments use a JSON stdin payload and cannot execute comment text', async () => {
  const draft = 'Literal `code`, $(do-not-run), "quotes"\nand newlines.';
  const calls = [];
  const github = new GitHubSource(async (program, args, options) => { calls.push({ program, args, options }); return JSON.stringify({ id: 99, html_url: 'https://github.com/example/repo/pull/12#issuecomment-99' }); });
  await github.postComment('https://github.com/example/repo/pull/12', draft);
  assert.deepEqual(calls[0].args, ['api', '--method', 'POST', 'repos/example/repo/issues/12/comments', '--input', '-']);
  assert.deepEqual(JSON.parse(calls[0].options.input), { body: draft });
  assert.equal(await command(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: draft }), draft);
});
