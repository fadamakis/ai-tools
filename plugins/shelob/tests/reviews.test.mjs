import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReviewPublisher, reviewPayload } from '../server/reviews.mjs';
import { CommentPublisher } from '../server/comments.mjs';
import { GitHubSource } from '../server/github.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-batch-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let time = Date.now(); const writes = [];
  const source = { kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) };
  const run = { id: '12345678-1234-4123-8123-123456789abc', state: 'complete', source };
  const finding = (id, side, line) => ({ id, title: `Finding ${id}`, severity: 'warning', message: 'An advisory improvement.', nextAction: 'Check the behavior.', evidence: [{ path: 'src/value.ts', side, line }] });
  const report = { source, status: 'needs_review', snapshot: { id: 'c'.repeat(64) }, freshness: { status: 'current' }, description: { text: 'Description' },
    results: [{ status: 'findings', findings: [finding('TEST-001:aaa', 'after', 2), finding('TEST-002:bbb', 'before', 2), finding('TEST-003:ccc', 'after', 99)] }],
    files: [{ path: 'src/value.ts', patch: '@@ -1,2 +1,2 @@\n first\n-old\n+new', limitation: null }] };
  const latest = { source: { ...source }, description: 'Description' };
  const store = { directory: id => { if (id !== run.id) throw new Error('Wrong run'); return root; }, get: id => { if (id !== run.id) throw new Error('Wrong run'); return { run, report }; }, github: {
    metadata: async () => latest,
    postReview: async (url, payload) => { writes.push({ url, payload }); return { id: 99, url: `${url}#pullrequestreview-99`, state: payload.event === 'APPROVE' ? 'APPROVED' : 'COMMENTED' }; },
    postComment: async () => { throw new Error('Must not send individual issue comments'); },
  } };
  const publisher = new ReviewPublisher(store, { clock: () => time });
  const comments = report.results[0].findings.map(item => ({ findingId: item.id, draft: `Edited ${item.title}.` }));
  return { root, publisher, store, writes, run, report, latest, comments, advance: ms => { time += ms; } };
}

test('discussed markers survive reload without changing the snapshot, publishing, or approval eligibility', async t => {
  const s = setup(t), findingId = s.report.results[0].findings[0].id;
  s.report.results[0].findings[0].severity = 'error';
  const markedSource = JSON.stringify(s.report);
  assert.throws(() => s.publisher.discuss({ runId: s.run.id, snapshotId: '0'.repeat(64), findingId, discussed: true }), /snapshot changed/);
  assert.throws(() => s.publisher.discuss({ runId: s.run.id, snapshotId: s.report.snapshot.id, findingId: '../../escape', discussed: true }), /not in the saved review/);
  s.publisher.discuss({ runId: s.run.id, snapshotId: s.report.snapshot.id, findingId, discussed: true });
  assert.deepEqual(new ReviewPublisher(s.store).status(s.run.id).discussed, [findingId]);
  assert.equal(JSON.stringify(s.report), markedSource);
  assert.equal(s.writes.length, 0);
  await assert.rejects(s.publisher.preview({ runId: s.run.id, event: 'APPROVE', comments: [] }), /Resolve High findings/);
  s.publisher.discuss({ runId: s.run.id, snapshotId: s.report.snapshot.id, findingId, discussed: false });
  assert.equal(s.publisher.status(s.run.id).discussed, undefined);
});

test('a selected batch becomes one pinned review with valid LEFT/RIGHT anchors and a summary fallback', async t => {
  const s = setup(t), unchanged = JSON.stringify(s.report);
  const preview = await s.publisher.preview({ runId: s.run.id, event: 'COMMENT', comments: s.comments });
  assert.equal(s.writes.length, 0);
  assert.equal(preview.count, 3);
  assert.equal(preview.payload.commit_id, s.run.source.headSha);
  assert.deepEqual(preview.payload.comments.map(({ path, line, side }) => ({ path, line, side })), [{ path: 'src/value.ts', line: 2, side: 'RIGHT' }, { path: 'src/value.ts', line: 2, side: 'LEFT' }]);
  assert.match(preview.payload.body, /Edited Finding TEST-003:ccc/);
  assert.doesNotMatch(preview.payload.body, /TEST-001:aaa/);
  const result = await s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true });
  assert.deepEqual(s.writes, [{ url: preview.url, payload: preview.payload }]);
  assert.equal(result.state, 'COMMENTED');
  assert.equal(JSON.stringify(s.report), unchanged);
  assert.deepEqual(await s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), result);
  assert.equal(s.writes.length, 1);
  assert.equal(s.publisher.status(s.run.id).comments[s.comments[0].findingId].draft, s.comments[0].draft);
  const restarted = new ReviewPublisher(s.store);
  assert.equal(restarted.status(s.run.id).comments[s.comments[0].findingId].state, 'posted');
  await assert.rejects(restarted.preview({ runId: s.run.id, event: 'COMMENT', comments: [s.comments[0]] }), /already sent/);
});

test('approval is separate, explicit, and may include selected nonblocking comments', async t => {
  for (const comments of [[], [setup(t).comments[0]]]) {
    const s = setup(t);
    const preview = await s.publisher.preview({ runId: s.run.id, event: 'APPROVE', comments });
    await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: false }), /Confirm/);
    assert.equal(s.writes.length, 0);
    await s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true });
    assert.equal(s.writes[0].payload.event, 'APPROVE');
    assert.equal(s.writes[0].payload.comments?.length || 0, comments.length);
    assert.equal(s.publisher.status(s.run.id).approval.state, 'posted');
    await assert.rejects(s.publisher.preview({ runId: s.run.id, event: 'APPROVE' }), /Approval was already sent/);
  }
});

test('High findings, unresolved checks, and source gaps prevent approval without blocking comments', async t => {
  for (const state of ['high', 'unchecked', 'source']) {
    const s = setup(t);
    if (state === 'high') s.report.results[0].findings[0].severity = 'error';
    if (state === 'unchecked') s.report.results.push({ status: 'not_assessed', findings: [] });
    if (state === 'source') s.report.files[0].limitation = 'Source was skipped';
    await assert.rejects(s.publisher.preview({ runId: s.run.id, event: 'APPROVE', comments: [] }), /Resolve High findings and incomplete checks/);
    assert.ok(await s.publisher.preview({ runId: s.run.id, event: 'COMMENT', comments: [s.comments[0]] }));
    assert.equal(s.writes.length, 0);
  }
});

test('approval is validated again after preview, even if a blocker is introduced into the saved data', async t => {
  const s = setup(t);
  const preview = await s.publisher.preview({ runId: s.run.id, event: 'APPROVE' });
  s.report.results[0].findings[0].severity = 'error';
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /Resolve High/);
  assert.equal(s.writes.length, 0);
});

test('batch confirmation rejects expired, stale, changed-snapshot, unknown, and duplicate selections', async t => {
  for (const invalid of ['expired', 'head', 'base', 'description', 'snapshot', 'offline']) {
    const s = setup(t);
    const preview = await s.publisher.preview({ runId: s.run.id, event: 'COMMENT', comments: s.comments });
    if (invalid === 'expired') s.advance(300_001);
    if (invalid === 'head') s.latest.source.headSha = 'd'.repeat(40);
    if (invalid === 'base') s.latest.source.baseSha = 'd'.repeat(40);
    if (invalid === 'description') s.latest.description = 'Changed';
    if (invalid === 'snapshot') s.report.snapshot.id = 'd'.repeat(64);
    if (invalid === 'offline') s.store.github.metadata = async () => { throw new Error('Access failed'); };
    await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /expired|changed|Access failed/);
    assert.equal(s.writes.length, 0);
  }
  const s = setup(t);
  for (const comments of [[], [s.comments[0], s.comments[0]], [{ findingId: 'unknown', draft: 'Text' }], [{ ...s.comments[0], draft: '' }], Array.from({ length: 51 }, (_, i) => ({ findingId: String(i), draft: 'Text' }))]) {
    await assert.rejects(s.publisher.preview({ runId: s.run.id, event: 'COMMENT', comments }), /Select|distinct|saved review|600 characters/);
  }
});

test('unknown batch delivery blocks repeat batches and older individual-comment posting', async t => {
  const s = setup(t);
  s.store.github.postReview = async () => { s.writes.push('attempt'); throw new Error('Timeout'); };
  const individual = new CommentPublisher(s.store);
  const oldPreview = await individual.preview({ runId: s.run.id, findingId: s.comments[0].findingId, draft: 'An older draft.' });
  const preview = await s.publisher.preview({ runId: s.run.id, event: 'COMMENT', comments: s.comments });
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /could not confirm/);
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /uncertain/);
  await assert.rejects(s.publisher.preview({ runId: s.run.id, event: 'COMMENT', comments: s.comments }), /uncertain/);
  await assert.rejects(individual.post({ runId: s.run.id, previewId: oldPreview.id, confirmed: true }), /unavailable/);
  assert.equal(s.writes.length, 1);
  assert.equal(s.publisher.status(s.run.id).comments[s.comments[0].findingId].state, 'unknown');
});

test('concurrent batch, approval, and legacy comment sends share the same publication lock', async t => {
  const s = setup(t); let release;
  const preview = await s.publisher.preview({ runId: s.run.id, event: 'COMMENT', comments: s.comments });
  s.store.github.postReview = async () => { s.writes.push('attempt'); await new Promise(resolve => { release = resolve; }); return { id: 99, url: `${s.run.source.url}#pullrequestreview-99` }; };
  const pending = s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(s.publisher.post({ runId: s.run.id, previewId: preview.id, confirmed: true }), /already being posted/);
  await assert.rejects(s.publisher.preview({ runId: s.run.id, event: 'APPROVE' }), /already being posted/);
  await assert.rejects(new CommentPublisher(s.store).preview({ runId: s.run.id, findingId: s.comments[0].findingId }), /already being prepared or posted/);
  release(); await pending;
  assert.equal(s.writes.length, 1);
});

test('review API sends one exact JSON payload with explicit COMMENT or APPROVE and pinned head', async t => {
  const s = setup(t), calls = [];
  const github = new GitHubSource(async (program, args, options) => { calls.push({ program, args, options }); return JSON.stringify({ id: 99, html_url: `${s.run.source.url}#pullrequestreview-99`, state: 'COMMENTED', commit_id: s.run.source.headSha }); });
  const payload = reviewPayload(s.report, 'COMMENT', s.comments);
  await github.postReview(s.run.source.url, payload);
  assert.deepEqual(calls[0].args, ['api', '--method', 'POST', 'repos/example/repo/pulls/12/reviews', '--input', '-']);
  assert.deepEqual(JSON.parse(calls[0].options.input), payload);
  assert.equal(calls.length, 1);
});
