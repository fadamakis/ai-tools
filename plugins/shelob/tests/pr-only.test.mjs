import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture, beforeDemo, weakenDemo } from './fixtures.mjs';
import { collectRepository } from '../scripts/lib/git.mjs';
import { GitHubSource } from '../server/github.mjs';
import { ReviewStore } from '../server/store.mjs';
import { renderReport } from '../scripts/lib/report.mjs';

function setup(t, { fork = false, partialPatch = false, inaccessible = false, oversized = false, baseAdvance = false, transform } = {}) {
  const sample = fixture(beforeDemo); t.after(sample.cleanup); if (transform) transform(sample); else weakenDemo(sample);
  sample.git('add', '--all'); sample.git('commit', '--no-verify', '-m', 'Fixture PR');
  if (baseAdvance) { sample.git('checkout', 'main'); sample.write('src/discount.ts', 'export const baseOnly = true;\n'); sample.git('add', '--all'); sample.git('commit', '--no-verify', '-m', 'Advance base fixture'); sample.git('checkout', 'feature/example'); }
  const repository = collectRepository({ repo: sample.repo, scope: 'branch', base: 'main' });
  const { head, baseCommit: base, mergeBase } = repository.context;
  const metadata = { title: 'Review a fixture PR', body: 'Fix validation', changed_files: repository.files.length, user: { login: 'fixture' },
    base: { sha: base, ref: 'main', repo: { full_name: 'example/repo' } }, head: { sha: head, ref: 'feature/example', repo: { full_name: fork ? 'fork/repo' : 'example/repo' } } };
  const comparison = { merge_base_commit: { sha: mergeBase }, files: repository.files.map(file => ({ filename: file.path,
    status: !file.before ? 'added' : !file.after ? 'removed' : 'modified', additions: file.added, deletions: file.deleted, patch: file.patch })) };
  if (partialPatch) comparison.files.find(file => file.filename.endsWith('.test.ts')).patch = '';
  const calls = [];
  const adapter = new GitHubSource(async (program, args) => {
    calls.push({ program, args }); assert.equal(program, 'gh', 'PR-only mode must never invoke Git');
    const endpoint = args[1];
    if (endpoint === 'repos/example/repo/pulls/12') return JSON.stringify(metadata);
    if (endpoint.includes('/compare/')) return JSON.stringify(comparison);
    const tree = endpoint.match(/\/git\/trees\/([a-f0-9]{40})$/);
    if (tree) {
      if (inaccessible) throw new Error('No access');
      const entries = sample.git('ls-tree', '-z', tree[1]).split('\0').filter(Boolean).map(record => {
        const match = record.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);
        return { mode: match[1], type: match[2], sha: match[3], path: match[4], size: match[2] === 'blob' ? oversized ? 1024 * 1024 + 1 : Number(sample.git('cat-file', '-s', match[3]).trim()) : undefined };
      });
      return JSON.stringify({ sha: tree[1], tree: entries, truncated: false });
    }
    const blob = endpoint.match(/\/git\/blobs\/([a-f0-9]{40})$/);
    if (blob) { const content = Buffer.from(sample.git('cat-file', 'blob', blob[1])); return JSON.stringify({ sha: blob[1], encoding: 'base64', size: content.length, content: content.toString('base64') }); }
    throw new Error(`Unexpected fixture endpoint: ${endpoint}`);
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-pr-only-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ReviewStore({ root, github: adapter });
  return { sample, root, store, adapter, calls, metadata, comparison };
}
const pending = report => ({ schemaVersion: '1.0.0', snapshotId: report.snapshot.id, assessments: [] });

test('new PR requests without a mode default to PR-only without changing the caller request', async t => {
  const { store, calls } = setup(t);
  const request = Object.freeze({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12' });
  const { run, report } = await store.start(request);
  assert.equal(run.request.reviewMode, 'pr_only');
  assert.equal(report.source.reviewMode, 'pr_only');
  assert.equal(request.reviewMode, undefined);
  assert.ok(calls.length > 0 && calls.every(call => call.program === 'gh'));
});

test('a timed-out local copy can be retried PR-only while the legacy failed run stays unchanged', async t => {
  const { store, calls } = setup(t);
  store.github.prepare = async () => { throw new Error('git fetch failed: timed out.'); };
  await assert.rejects(store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'local_copy' }), /timed out/);
  const failed = store.list()[0], filename = path.join(store.directory(failed.id), 'run.json');
  // Old failed runs predate mode selection and have only the PR URL as source.
  const legacy = store.manifest(failed.id); delete legacy.request.reviewMode; delete legacy.source.reviewMode; store.save(legacy);
  const saved = fs.readFileSync(filename, 'utf8');
  assert.equal(store.list()[0].title, 'example/repo #12');
  assert.equal(store.get(failed.id).report, null);
  const recovered = await store.start({ ...legacy.request, reviewMode: 'pr_only' });
  assert.equal(recovered.run.state, 'awaiting_review');
  assert.equal(recovered.report.source.reviewMode, 'pr_only');
  assert.notEqual(recovered.run.id, failed.id);
  assert.equal(fs.readFileSync(filename, 'utf8'), saved);
  assert.ok(calls.length > 0 && calls.every(call => call.program === 'gh'));
});
test('requester metadata remains distinct from the PR author and survives saved history and report rendering', async t => {
  const { store, root } = setup(t);
  const requester = { name: 'Example Reviewer', url: 'https://example.com/review-request' };
  const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', requester });
  assert.deepEqual(report.source.requester, requester);
  assert.equal(report.source.author, 'fixture');
  const reopened = new ReviewStore({ root });
  assert.deepEqual(reopened.get(run.id).report.source.requester, requester);
  assert.deepEqual(reopened.list().find(item => item.id === run.id).source.requester, requester);
  const html = renderReport(report);
  assert.match(html, /Requested by/);
  assert.match(html, /Example Reviewer/);
  assert.ok(html.includes(requester.url));
});
test('invalid requester names or unsafe request links fail before saving a review', async t => {
  const { store } = setup(t);
  for (const requester of [{ name: ' ' }, { name: 'Requester', url: 'javascript:alert(1)' }, { name: 'Requester', url: 'https://user:secret@example.com' }]) {
    await assert.rejects(store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', requester }), /requester|request link/);
  }
  assert.deepEqual(store.list(), []);
});

test('PR-only review runs the same checks without Git, persists its mode, and validates changed-file evidence', async t => {
  const { store, calls, root, sample } = setup(t);
  const beforeStatus = sample.git('status', '--porcelain=v1'), beforeIndex = fs.readFileSync(path.join(sample.repo, '.git/index'));
  const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' });
  assert.equal(report.source.reviewMode, 'pr_only'); assert.equal(run.request.reviewMode, 'pr_only');
  assert.equal(report.results.reduce((n, rule) => n + rule.findings.length, 0), 3);
  assert.ok(calls.every(call => call.program === 'gh'));
  assert.equal(fs.existsSync(path.join(root, 'runs', run.id, 'source')), false);
  assert.equal(fs.existsSync(path.join(report.repository.root, '.git')), false);
  assert.match(renderReport(report), /PR only · Changed files from GitHub/);
  assert.match(store.inspect(run.id, { operation: 'read', file: 'src/discount.test.ts' }).content, /it.skip/);
  assert.match(store.inspect(run.id, { operation: 'read', side: 'before', file: 'src/discount.test.ts' }).content, /discount\(100, 110\)/);
  assert.match(store.inspect(run.id, { operation: 'diff', file: 'src/discount.test.ts' }).patch, /@@/);
  assert.equal(store.inspect(run.id, { operation: 'list', limit: 1 }).nextOffset, 1);
  assert.ok(store.inspect(run.id, { operation: 'search', query: 'discount' }).matches.length);
  assert.throws(() => store.inspect(run.id, { operation: 'read', file: 'package.json' }), /changed files only/);
  const assessment = { schemaVersion: '1.0.0', snapshotId: report.snapshot.id, assessments: [{ ruleId: 'TEST-003', status: 'findings', reason: 'The implementation removed validation.',
    findings: [{ title: 'Invalid percentages are accepted', message: 'The removed range check permits invalid discounts.', nextAction: 'Restore the range check.', evidence: [{ path: 'src/discount.ts', side: 'after', line: 2 }] }] }] };
  const final = await store.finalize(run.id, assessment);
  assert.equal(final.report.freshness.status, 'current'); assert.equal(final.report.results.find(rule => rule.ruleId === 'TEST-003').findings.length, 1);
  assert.equal(sample.git('status', '--porcelain=v1'), beforeStatus); assert.deepEqual(fs.readFileSync(path.join(sample.repo, '.git/index')), beforeIndex);
  assert.equal(new ReviewStore({ root }).get(run.id).report.source.reviewMode, 'pr_only');
});

test('PR-only fork sources use the fork head and base repository merge base', async t => {
  const { store, calls } = setup(t, { fork: true });
  const { report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' });
  assert.ok(calls.some(call => call.args[1].startsWith('repos/fork/repo/git/trees/')));
  assert.ok(calls.some(call => call.args[1] === `repos/example/repo/git/trees/${report.repository.mergeBase}`));
  assert.equal(report.files.length, 4);
});

test('PR-only before-side source comes from the merge base even when the base branch advances', async t => {
  const { store } = setup(t, { baseAdvance: true });
  const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' });
  assert.notEqual(report.repository.mergeBase, report.repository.baseCommit);
  const before = store.inspect(run.id, { operation: 'read', side: 'before', file: 'src/discount.ts' }).content;
  assert.match(before, /Invalid percentage/); assert.doesNotMatch(before, /baseOnly/);
  assert.equal(report.notices.length, 0);
});

test('PR-only reads renamed files from the previous path at the merge base', async t => {
  const { store, comparison, metadata } = setup(t, { transform: sample => {
    sample.git('mv', 'src/discount.ts', 'src/coupon.ts'); sample.write('src/coupon.ts', beforeDemo['src/discount.ts'] + '// Renamed fixture\n');
  } });
  comparison.files = [{ filename: 'src/coupon.ts', previous_filename: 'src/discount.ts', status: 'renamed', additions: 1, deletions: 0, patch: '@@ -4,0 +5 @@\n+// Renamed fixture' }]; metadata.changed_files = 1;
  const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' });
  assert.equal(report.files.length, 1); assert.equal(report.files[0].previousPath, 'src/discount.ts');
  assert.match(store.inspect(run.id, { operation: 'read', side: 'before', file: 'src/coupon.ts' }).content, /Invalid percentage/);
  assert.equal(report.notices.length, 0);
});

test('PR-only preserves added and removed source and skips binary files and symlinks', async t => {
  const { store } = setup(t, { transform: sample => {
    fs.unlinkSync(path.join(sample.repo, 'src/discount.ts')); sample.write('src/new.ts', 'export const added = true;\n');
    sample.write('binary.dat', Buffer.from([0, 1, 2])); fs.symlinkSync('discount.test.ts', path.join(sample.repo, 'src/link.ts'));
  } });
  const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' });
  assert.equal(report.files.find(file => file.path === 'binary.dat').binary, true);
  assert.match(report.files.find(file => file.path === 'src/link.ts').limitation, /symlinks/);
  assert.match(store.inspect(run.id, { operation: 'read', side: 'before', file: 'src/discount.ts' }).content, /Invalid percentage/);
  assert.equal(store.inspect(run.id, { operation: 'read', side: 'after', file: 'src/discount.ts' }).content, '1: ');
  assert.match(store.inspect(run.id, { operation: 'read', side: 'after', file: 'src/new.ts' }).content, /added = true/);
});

test('partial patches, inaccessible source, and oversized files stay visibly incomplete', async t => {
  for (const options of [{ partialPatch: true }, { inaccessible: true }, { oversized: true }]) {
    const { store } = setup(t, options);
    const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' });
    assert.ok(report.notices.length);
    assert.ok(report.results.some(rule => rule.mode === 'deterministic' && rule.status === 'not_assessed'));
    assert.doesNotMatch(renderReport((await store.finalize(run.id, pending(report))).report), /data-verdict="approve"/);
  }
});

test('PR-only rejects incomplete file lists and a PR that moves during API reads without falling back to Git', async t => {
  const first = setup(t); first.comparison.files.pop();
  await assert.rejects(first.store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' }), /incomplete PR diff/);
  const second = setup(t);
  const original = second.adapter.metadata.bind(second.adapter); let count = 0;
  second.adapter.metadata = async url => { const result = await original(url); if (count++) result.source.headSha = 'b'.repeat(40); return result; };
  await assert.rejects(second.store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' }), /changed while reading/);
  assert.ok([...first.calls, ...second.calls].every(call => call.program === 'gh'));
});

test('PR-only rejects modified cached source and evidence outside the PR', async t => {
  const { store } = setup(t);
  const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' });
  const invalid = { ...pending(report), assessments: [{ ruleId: 'TEST-003', status: 'findings', reason: 'Fixture', findings: [{ title: 'Fixture', message: 'Fixture', nextAction: 'Fixture', evidence: [{ path: 'not-in-pr.ts', line: 1 }] }] }] };
  await assert.rejects(store.finalize(run.id, invalid), /changed files only/);
  const snapshot = JSON.parse(fs.readFileSync(run.options.snapshotFile, 'utf8')); snapshot.files[0].after += '\nchanged'; fs.writeFileSync(run.options.snapshotFile, JSON.stringify(snapshot));
  assert.throws(() => store.inspect(run.id, { operation: 'list' }), /snapshot changed/);
  await assert.rejects(store.finalize(run.id, pending(report)), /snapshot/);
});

test('PR-only enforces the review budget and preserves the reviewed SHA when the PR changes later', async t => {
  const oversized = setup(t); oversized.metadata.changed_files = 201;
  await assert.rejects(oversized.store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' }), /200-file/);
  const { store, metadata } = setup(t);
  const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'pr_only' });
  metadata.head.sha = 'c'.repeat(40);
  const final = await store.finalize(run.id, pending(report));
  assert.equal(final.report.freshness.status, 'outdated'); assert.equal(final.report.source.headSha, report.source.headSha);
});
