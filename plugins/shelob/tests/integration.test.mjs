import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ReviewStore } from '../server/store.mjs';
import { GitHubSource, parsePrUrl, command } from '../server/github.mjs';
import { renderReport } from '../scripts/lib/report.mjs';
import { fixture, beforeDemo, weakenDemo } from './fixtures.mjs';

function setup(t) {
  const sample = fixture(beforeDemo); t.after(sample.cleanup);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-store-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { sample, root, store: new ReviewStore({ root }) };
}
const assessments = report => ({ schemaVersion: '1.0.0', snapshotId: report.snapshot.id,
  assessments: report.results.filter(rule => rule.mode === 'contextual' && rule.matchedFiles.length && (rule.ruleId !== 'DESCRIPTION-001' || report.description?.text)).map(rule => ({ ruleId: rule.ruleId, status: 'not_assessed', reason: 'Test fixture: contextual review intentionally unfinished.' })) });

test('managed local reviews persist across restarts, finalize once, and preserve earlier reports', async t => {
  const { sample, root, store } = setup(t); weakenDemo(sample);
  const beforeStatus = sample.git('status', '--porcelain=v1'), beforeIndex = fs.readFileSync(path.join(sample.repo, '.git/index'));
  const first = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  assert.equal(first.run.state, 'awaiting_review');
  assert.equal(new ReviewStore({ root }).list()[0].id, first.run.id);
  assert.equal(fs.statSync(first.run.initial.json).mode & 0o777, 0o600);
  const saved = fs.readFileSync(first.run.initial.json, 'utf8');
  const final = await store.finalize(first.run.id, assessments(first.report));
  assert.equal(final.report.analysis.contextual, true);
  assert.equal(final.report.results.filter(rule => rule.status === 'not_assessed').length, 5, 'includes the required native correctness review');
  assert.equal(fs.readFileSync(first.run.initial.json, 'utf8'), saved);
  assert.deepEqual((await store.finalize(first.run.id, assessments(first.report))).run.final, final.run.final);
  const rerun = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  assert.notEqual(rerun.run.id, first.run.id);
  assert.equal(store.list().length, 2);
  assert.equal(sample.git('status', '--porcelain=v1'), beforeStatus);
  assert.deepEqual(fs.readFileSync(path.join(sample.repo, '.git/index')), beforeIndex);
});

test('managed source reads use staged, unstaged, and committed versions and reject stale local review', async t => {
  const { sample, store } = setup(t);
  sample.write('src/discount.ts', 'export const selected = "committed";\n'); sample.git('add', '--all'); sample.git('commit', '--no-verify', '-m', 'Fixture branch');
  sample.write('src/discount.ts', 'export const selected = "staged";\n'); sample.git('add', '--all');
  sample.write('src/discount.ts', 'export const selected = "working";\n');
  for (const [scope, expected, before] of [['branch', 'committed', 'percent'], ['staged', 'staged', 'committed'], ['unstaged', 'working', 'staged'], ['all', 'working', 'percent']]) {
    const { run } = await store.start({ kind: 'local', repo: sample.repo, scope, base: 'main' });
    assert.match(store.inspect(run.id, { operation: 'read', file: 'src/discount.ts' }).content, new RegExp(expected));
    assert.match(store.inspect(run.id, { operation: 'read', side: 'before', file: 'src/discount.ts' }).content, new RegExp(before));
    assert.match(store.inspect(run.id, { operation: 'diff', file: 'src/discount.ts' }).patch, /@@/);
  }
  const started = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  sample.write('src/discount.ts', 'export const different = true;\n');
  assert.throws(() => store.inspect(started.run.id, { operation: 'read', file: 'src/discount.ts' }), /snapshot changed/);
  await assert.rejects(store.finalize(started.run.id, assessments(started.report)), /snapshot/);
  assert.equal(store.get(started.run.id).run.state, 'awaiting_review');
});

test('source tools paginate tracked source, search literally, and reject path escapes and untracked files', async t => {
  const { sample, store } = setup(t); weakenDemo(sample); sample.write('untracked.txt', 'do not read');
  const { run } = await store.start({ kind: 'local', repo: sample.repo, base: 'main', description: 'A pinned description' });
  const page = store.inspect(run.id, { operation: 'list', limit: 1 });
  assert.equal(page.files.length, 1); assert.equal(page.nextOffset, 1);
  const matches = store.inspect(run.id, { operation: 'search', query: 'discount', limit: 1 });
  assert.equal(matches.matches.length, 1); assert.equal(matches.truncated, true);
  assert.match(store.inspect(run.id, { operation: 'read', file: '@description' }).content, /pinned description/);
  for (const file of ['../outside', '/etc/passwd', 'untracked.txt', '.git/config']) assert.throws(() => store.inspect(run.id, { operation: 'read', file }), /tracked file/);
  assert.throws(() => store.inspect(run.id, { operation: 'read', file: 'src/discount.ts', limit: 201 }), /pagination/);
});

test('concurrent runs do not overwrite one another and interrupted preparation remains recoverable', async t => {
  const { sample, store } = setup(t); weakenDemo(sample);
  const runs = await Promise.all(Array.from({ length: 3 }, () => store.start({ kind: 'local', repo: sample.repo, base: 'main' })));
  assert.equal(new Set(runs.map(value => value.run.id)).size, 3);
  assert.equal(store.list().length, 3);
  const run = store.manifest(runs[0].run.id); run.ownerPid = 2147483647; run.state = 'preparing'; store.save(run);
  assert.equal(store.get(run.id).run.state, 'interrupted');
  assert.ok(store.get(run.id).report);
  assert.equal(store.get(runs[1].run.id).run.state, 'awaiting_review');
});

test('invalid repositories, bases and oversized diffs produce failed runs rather than a clean report', async t => {
  const { sample, store } = setup(t);
  await assert.rejects(store.start({ kind: 'local', repo: sample.repo, base: 'missing-branch' }), /Base/);
  assert.equal(store.list()[0].state, 'failed');
  assert.equal(store.get(store.list()[0].id).report, null);
  await assert.rejects(store.start({ kind: 'local', repo: sample.repo, description: 'x'.repeat(256 * 1024 + 1) }), /256 KiB/);
  for (let i = 0; i < 201; i++) sample.write(`large/file-${i}.txt`, 'changed');
  sample.git('add', '--all');
  await assert.rejects(store.start({ kind: 'local', repo: sample.repo, base: 'main' }), /200-file/);
});

test('PR URLs stay scoped to github.com and reject credentials, query strings, and malformed paths', () => {
  assert.deepEqual(parsePrUrl('https://github.com/example/repo/pull/12/'), { repository: 'example/repo', number: 12, url: 'https://github.com/example/repo/pull/12' });
  const credentials = new URL('https://github.com/u/r/pull/2'); credentials.username = 'fixture'; credentials.password = 'fixture';
  const query = new URL('https://github.com/u/r/pull/1'); query.searchParams.set('token', 'fixture');
  for (const url of ['https://example.com/x/y/pull/1', 'https://github.com/u/r/pull/0', credentials.href, query.href, 'https://github.com/u/r/pull/1/files']) assert.throws(() => parsePrUrl(url));
});

function prFixture(sample, { fork = false, changedHead = false, failAuth = false } = {}) {
  const base = sample.git('rev-parse', 'main').trim(), head = sample.git('rev-parse', 'HEAD').trim();
  const pr = { title: 'Fixture PR', body: 'Fix behavior', user: { login: fork ? 'fork-author' : 'author' }, base: { sha: base, ref: 'main', repo: { full_name: 'example/repo', private: true } },
    head: { sha: head, ref: 'feature/example', repo: { full_name: fork ? 'fork/repo' : 'example/repo' } } };
  const calls = [];
  const adapter = new GitHubSource(async (program, args, options) => {
    calls.push({ program, args });
    if (program === 'gh') { if (failAuth) throw new Error('GitHub access denied'); return JSON.stringify(pr); }
    const rewritten = [...args], fetchIndex = rewritten.indexOf('fetch');
    if (fetchIndex !== -1) {
      rewritten[fetchIndex + 3] = sample.repo;
      rewritten[fetchIndex + 5] = `${changedHead ? base : head}:refs/shelob/head`;
    }
    return command(program, rewritten, options);
  });
  return { adapter, calls, pr, base, head };
}

test('ordinary and fork/private PRs use full isolated Git objects without touching the active checkout', async t => {
  const { sample, root } = setup(t); weakenDemo(sample); sample.git('add', '--all'); sample.git('commit', '--no-verify', '-m', 'Fixture PR');
  sample.write('scratch.txt', 'Unrelated working changes');
  const status = sample.git('status', '--porcelain=v1'), index = fs.readFileSync(path.join(sample.repo, '.git/index'));
  for (const fork of [false, true]) {
    const { adapter, calls, head, base } = prFixture(sample, { fork });
    const store = new ReviewStore({ root: path.join(root, fork ? 'fork' : 'normal'), github: adapter });
    const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'local_copy' });
    assert.equal(report.repository.head, head); assert.equal(report.repository.baseCommit, base);
    assert.equal(report.source.author, fork ? 'fork-author' : 'author');
    assert.equal(report.source.repository, 'example/repo');
    assert.equal(report.files.length, 4); assert.equal(report.description.text, 'Fix behavior');
    assert.equal(fs.existsSync(path.join(report.repository.root, 'src')), false);
    assert.match(store.inspect(run.id, { operation: 'read', file: 'src/discount.test.ts' }).content, /it.skip/);
    assert.ok(calls.find(call => call.args.some(arg => arg === 'refs/pull/12/head:refs/shelob/head')));
    assert.equal(calls.some(call => call.args.some(arg => /checkout|--depth|--filter/.test(arg))), false);
    const final = await store.finalize(run.id, assessments(report)); assert.equal(final.report.freshness.status, 'current');
  }
  assert.equal(sample.git('status', '--porcelain=v1'), status); assert.deepEqual(fs.readFileSync(path.join(sample.repo, '.git/index')), index);
});

test('PR authentication errors and heads changed during fetch fail explicitly', async t => {
  const { sample, root } = setup(t); sample.write('new.txt', 'new'); sample.git('add', '--all'); sample.git('commit', '--no-verify', '-m', 'Fixture PR');
  for (const flags of [{ failAuth: true }, { changedHead: true }]) {
    const { adapter } = prFixture(sample, flags);
    const store = new ReviewStore({ root: path.join(root, flags.failAuth ? 'auth' : 'changed'), github: adapter });
    await assert.rejects(store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'local_copy' }), /access denied|changed while fetching/);
    assert.equal(store.list()[0].state, 'failed'); assert.equal(store.get(store.list()[0].id).report, null);
  }
});

test('finalizing a changed or unverifiable PR preserves the reviewed commits and prevents green approval', async t => {
  const { sample, root } = setup(t); sample.write('new.txt', 'new'); sample.git('add', '--all'); sample.git('commit', '--no-verify', '-m', 'Fixture PR');
  for (const status of ['outdated', 'unknown']) {
    const { adapter, head } = prFixture(sample);
    const store = new ReviewStore({ root: path.join(root, status), github: adapter });
    const { run, report } = await store.start({ kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', reviewMode: 'local_copy' });
    adapter.metadata = async () => { if (status === 'unknown') throw new Error('no access'); return { source: { headSha: 'a'.repeat(40), baseSha: report.source.baseSha }, description: 'Fix behavior' }; };
    const final = await store.finalize(run.id, assessments(report));
    assert.equal(final.report.freshness.status, status); assert.equal(final.report.source.headSha, head);
    const clean = { ...final.report, results: final.report.results.map(rule => ({ ...rule, status: 'assessed', findings: [] })) };
    assert.doesNotMatch(renderReport(clean), /data-verdict="approve"/);
  }
});

test('report schema accepts new provenance and old 1.0.0 reports, rejects incomplete PR metadata', async t => {
  const { sample, store } = setup(t);
  const { report } = await store.start({ kind: 'local', repo: sample.repo, base: 'main' });
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  const validate = ajv.compile(JSON.parse(fs.readFileSync(new URL('../schemas/report.schema.json', import.meta.url), 'utf8')));
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  const old = { ...report, schemaVersion: '1.0.0' }; delete old.source;
  assert.equal(validate(old), true); assert.match(renderReport(old), /Shelob/);
  assert.equal(validate({ ...report, source: { kind: 'github_pr', url: 'https://github.com/example/repo/pull/12' } }), false);
});
