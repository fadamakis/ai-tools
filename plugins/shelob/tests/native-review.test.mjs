import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { NativeReviewer, nativeFailure } from '../server/native-review.mjs';
import { ReviewStore } from '../server/store.mjs';
import { digest, collectRepository } from '../scripts/lib/git.mjs';
import { reviewVerdict, auditOutcome } from '../assets/report-model.mjs';
import { renderReportView } from '../assets/dist/report-server.mjs';
import { fixture } from './fixtures.mjs';

const events = text => ['thread.started', 'turn.started'].map(type => ({ type })).concat([{ type: 'item.completed', item: { type: 'agent_message', text } }, { type: 'turn.completed' }]).map(event => JSON.stringify(event)).join('\n');
function setup(t, command) {
  const sample = fixture({ 'refund.js': 'export function refund(total, paid) {\n  if (!paid) return 0;\n  return total;\n}\n' }); t.after(sample.cleanup);
  sample.write('refund.js', 'export function refund(total, paid) {\n  if (paid) return 0;\n  return total;\n}\n');
  const rules = path.join(sample.root, 'custom.json');
  fs.writeFileSync(rules, JSON.stringify({ schemaVersion: '1.0.0', id: 'fixture', name: 'Fixture', version: '1.0.0', rules: [{ id: 'TEAM-001', title: 'Team policy', category: 'Team', mode: 'contextual', severity: 'warning', scope: ['**'], rationale: 'Keep the selected policy explicit.', instructions: 'Inspect this change against the team policy.' }] }));
  const calls = [];
  const reviewer = new NativeReviewer(async (args, options) => {
    calls.push({ args, options });
    if (args.includes('list')) return { code: 0, stdout: JSON.stringify([{ name: 'shelob' }, { name: 'external' }]) };
    return command ? command(args, options) : { code: 0, stdout: events('Review comment:\n\n- [P1] Keep rejecting unpaid refunds — refund.js:2-2\n  Unpaid purchases now receive a refund.') };
  });
  const store = new ReviewStore({ root: path.join(sample.root, 'data'), nativeReviewer: reviewer });
  return { sample, rules, store, reviewer, calls, start: () => store.start({ kind: 'local', repo: sample.repo, base: 'main', rules }) };
}
const payload = (report, native, findings = [], status = findings.length ? 'findings' : 'assessed') => ({ schemaVersion: '1.0.0', snapshotId: report.snapshot.id,
  assessments: [{ ruleId: 'TEAM-001', status: 'assessed', reason: 'Selected team policy checked against the pinned source.' }],
  ...(native ? { codeReview: { outputDigest: native.outputDigest, status, reason: 'Validated the refund contract against before and after source.', findings } } : {}) });
const candidate = (severity = 'error', extra = {}) => ({ title: 'Unpaid purchases can receive refunds', message: 'For paid=false, the new condition falls through and returns the total rather than zero.', nextAction: 'Restore the unpaid guard.', severity, comment: 'Could we keep the unpaid guard? Unpaid purchases now receive the full refund.', evidence: [{ path: 'refund.js', line: 2 }], ...extra });

test('native review uses the real review command, pinned JSON source, read-only sandbox and isolated tools', async t => {
  const { sample, store, calls, start } = setup(t);
  const status = sample.git('status', '--porcelain=v1'), index = fs.readFileSync(path.join(sample.repo, '.git/index'));
  const { run, report } = await start();
  assert.equal(report.results[0].ruleId, 'CODEX-REVIEW');
  assert.equal(report.results[0].status, 'not_assessed');
  const reviewed = await store.codeReview(run.id);
  const call = calls.at(-1), input = JSON.parse(fs.readFileSync(path.join(call.options.cwd, 'input.json')));
  assert.ok(call.args.includes('review') && call.args.includes('exec'));
  assert.deepEqual(call.args.slice(call.args.indexOf('exec'), call.args.indexOf('exec') + 3), ['exec', '-s', 'read-only']);
  assert.ok(call.args.includes('features.plugins=false') && call.args.includes('features.apps=false') && call.args.includes('features.hooks=false'));
  for (const name of ['shelob', 'external']) assert.ok(call.args.includes(`mcp_servers."${name}".enabled=false`));
  assert.equal(call.args.includes('--model'), false, 'default uses the configured model');
  assert.equal(call.args.includes('--uncommitted'), false, 'native uncommitted would include untracked and the wrong scope');
  assert.equal(call.options.cwd.startsWith(store.directory(run.id)), true);
  assert.equal(input.snapshotId, report.snapshot.id);
  assert.equal(input.files[0].after.includes('if (paid)'), true);
  assert.equal(input.selectedRules.rules[0].id, 'TEAM-001');
  assert.equal(reviewed.nativeReview.outputDigest, digest(reviewed.nativeReview.output));
  assert.equal(sample.git('status', '--porcelain=v1'), status);
  assert.deepEqual(fs.readFileSync(path.join(sample.repo, '.git/index')), index);
  assert.deepEqual(fs.readdirSync(call.options.cwd).sort(), ['input.json', 'output.txt']);
  assert.equal((await store.codeReview(run.id)).nativeReview.outputDigest, reviewed.nativeReview.outputDigest);
  assert.equal(calls.length, 2, 'no second model invocation on follow-up');
});

test('native review cannot be fabricated, bound to stale output, or use invalid source evidence', async t => {
  const { store, start } = setup(t);
  const { run, report } = await start();
  await assert.rejects(store.finalize(run.id, payload(report, { outputDigest: 'a'.repeat(64) }, [candidate()])), /Native review is missing/);
  const { nativeReview } = await store.codeReview(run.id);
  await assert.rejects(store.finalize(run.id, payload(report, { outputDigest: 'b'.repeat(64) }, [candidate()])), /different source\/output/);
  await assert.rejects(store.finalize(run.id, payload(report, nativeReview, [candidate('error', { evidence: [{ path: '../escape', line: 1 }] })])), /inside the reviewed/);
  await assert.rejects(store.finalize(run.id, payload(report, nativeReview, [candidate('error', { evidence: [{ path: 'refund.js', line: 200 }] })])), /line does not exist/);
  assert.equal(store.get(run.id).run.state, 'awaiting_review');
});

test('general bugs outside the selected rules block approval and have native provenance and comment drafts', async t => {
  const { store, start } = setup(t); const { run, report } = await start();
  const { nativeReview } = await store.codeReview(run.id);
  const final = await store.finalize(run.id, payload(report, nativeReview, [candidate()]));
  assert.equal(reviewVerdict(final.report.results, { report: final.report }).state, 'changes');
  const finding = final.report.results[0].findings[0];
  assert.equal(finding.origin, 'codex'); assert.deepEqual(finding.sources, ['Codex review']); assert.ok(finding.comment.length <= 600);
  assert.equal(final.report.results[1].status, 'assessed', 'general bug is independent of custom policy');
  assert.match(renderReportView(final.report), /Codex review and Shelob rules/);
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  const validate = ajv.compile(JSON.parse(fs.readFileSync(new URL('../schemas/report.schema.json', import.meta.url))));
  assert.equal(validate(final.report), true, JSON.stringify(validate.errors));
  const restarted = new ReviewStore({ root: store.root });
  assert.equal(restarted.get(run.id).nativeReview.outputDigest, nativeReview.outputDigest);
  assert.equal(restarted.get(run.id).report.results[0].findings[0].id, finding.id);
});

test('clean and nonblocking reviews turn green only after native output and selected rules are validated', async t => {
  for (const findings of [[], [candidate('warning')], [candidate('info')]]) {
    const { store, start } = setup(t); const { run, report } = await start();
    const { nativeReview } = await store.codeReview(run.id);
    assert.equal(reviewVerdict(store.get(run.id).report.results, { report: store.get(run.id).report }).state, 'incomplete');
    const final = await store.finalize(run.id, payload(report, nativeReview, findings));
    assert.equal(reviewVerdict(final.report.results, { report: final.report }).state, findings.length ? 'notes' : 'approve');
  }
});

test('explicit duplicate causes become one comment with both sources and the strongest severity', async t => {
  const { store, start } = setup(t); const { run, report } = await start(); const { nativeReview } = await store.codeReview(run.id);
  const assessment = payload(report, nativeReview, [candidate('warning')]);
  assessment.assessments[0] = { ruleId: 'TEAM-001', status: 'findings', reason: 'The same refund regression violates the team contract.', findings: [candidate('error', { duplicateOf: 'CODEX-REVIEW#1' })] };
  const final = await store.finalize(run.id, assessment), [general, custom] = final.report.results;
  assert.equal(final.report.results.flatMap(result => result.findings).length, 1);
  assert.equal(general.findings[0].severity, 'error');
  assert.deepEqual(general.findings[0].sources, ['Codex review', 'Rule: TEAM-001']);
  assert.deepEqual(custom.findingRefs, [general.findings[0].id]); assert.equal(auditOutcome(custom), 'attention');
  const html = renderReportView(final.report);
  assert.equal((html.match(/class="comment-card"/g) || []).length, 1);
  assert.match(html, /Shared finding:/);
});

test('different causes on the same line are kept, and unknown duplicate references are rejected', async t => {
  const { store, start } = setup(t); const { run, report } = await start(); const { nativeReview } = await store.codeReview(run.id);
  const invalid = payload(report, nativeReview, [candidate('warning', { duplicateOf: 'MISSING:123' })]);
  await assert.rejects(store.finalize(run.id, invalid), /duplicate must reference/);
  const assessment = payload(report, nativeReview, [candidate()]);
  assessment.assessments[0] = { ruleId: 'TEAM-001', status: 'findings', reason: 'Separate team issue.', findings: [candidate('warning', { title: 'A separate cause on this line' })] };
  assert.equal((await store.finalize(run.id, assessment)).report.results.flatMap(result => result.findings).length, 2);
});

test('failed and interrupted native reviews remain visible and cannot approve', async t => {
  const { store, start } = setup(t, async () => ({ code: 1, stdout: JSON.stringify({ type: 'turn.failed', error: { message: "The 'fixture-model' model is not supported when using Codex with a ChatGPT account." } }) }));
  const { run, report } = await start(); const failed = await store.codeReview(run.id);
  assert.equal(failed.nativeReview.status, 'failed'); assert.match(failed.nativeReview.error, /fixture-model/);
  const final = await store.finalize(run.id, payload(report));
  assert.equal(reviewVerdict(final.report.results, { report: final.report }).state, 'incomplete');
  assert.match(final.report.results[0].reason, /fixture-model/);
  assert.ok(final.report.notices.some(notice => notice.title === 'Codex review could not finish'));
  const second = await start(), interrupted = store.manifest(second.run.id);
  interrupted.nativeReview = { status: 'running', ownerPid: 2147483647, startedAt: new Date().toISOString() }; store.save(interrupted);
  assert.match(store.get(second.run.id).nativeReview.error, /interrupted/);
  assert.equal(nativeFailure([], { code: 'TIMEOUT' }), 'Native Codex review timed out. Start a fresh review.');
});

test('concurrent calls run once; edits during native review invalidate its output', async t => {
  let finish;
  const { store, start, sample, calls } = setup(t, () => new Promise(resolve => { finish = resolve; }));
  const { run, report } = await start(); await store.codeReview(run.id, { wait: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await store.codeReview(run.id)).nativeReview.status, 'running');
  await assert.rejects(store.finalize(run.id, payload(report)), /still running/);
  sample.write('refund.js', 'export const changedAgain = true;\n');
  finish({ code: 0, stdout: events('No findings.') });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(calls.length, 2);
  assert.equal(store.get(run.id).nativeReview.status, 'failed');
  assert.match(store.get(run.id).nativeReview.error, /Source changed/);
});

test('native output tampering and missing terminal completion never produce a pass', async t => {
  const { store, start } = setup(t); const { run, report } = await start(); const { nativeReview } = await store.codeReview(run.id);
  fs.writeFileSync(store.manifest(run.id).nativeReview.outputFile, 'modified');
  await assert.rejects(store.finalize(run.id, payload(report, nativeReview)), /output changed/);
  const incomplete = setup(t, async () => ({ code: 0, stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'No issues' } }) }));
  const attempt = await incomplete.start();
  assert.equal((await incomplete.store.codeReview(attempt.run.id)).nativeReview.status, 'failed');
});

test('native local scopes pin staged, unstaged, branch and tracked combined changes without including untracked content', async t => {
  const { sample, store, rules, calls } = setup(t);
  sample.git('add', '--all'); sample.git('commit', '--no-verify', '-m', 'Committed');
  sample.write('refund.js', 'export const selected = "staged";\n'); sample.git('add', 'refund.js');
  sample.write('refund.js', 'export const selected = "unstaged";\n'); sample.write('untracked.js', 'Never inspect me');
  for (const [scope, expected] of [['branch', 'if (paid)'], ['staged', 'staged'], ['unstaged', 'unstaged'], ['all', 'unstaged']]) {
    const { run } = await store.start({ kind: 'local', repo: sample.repo, base: 'main', rules, scope }); await store.codeReview(run.id);
    const input = JSON.parse(fs.readFileSync(path.join(calls.at(-1).options.cwd, 'input.json')));
    assert.equal(input.scope, scope); assert.ok(input.files[0].after.includes(expected)); assert.equal(input.files.some(file => file.path === 'untracked.js'), false);
  }
});

test('PR-only native review uses cached changed files with no repository download and retains pinned PR commits', async t => {
  const { sample, rules, reviewer } = setup(t); sample.git('add', '--all'); sample.git('commit', '--no-verify', '-m', 'PR');
  const repository = collectRepository({ repo: sample.repo, base: 'main', scope: 'branch' });
  const source = { kind: 'github_pr', url: 'https://github.com/example/repo/pull/12', repository: 'example/repo', number: 12, title: 'Refund change', author: 'author', baseRef: 'main', headRef: 'feature', baseSha: repository.context.baseCommit, headSha: repository.context.head, reviewMode: 'pr_only' };
  const github = { async preparePrOnly(url, destination) { fs.mkdirSync(destination, { recursive: true }); const snapshotFile = path.join(destination, 'snapshot.json'); fs.writeFileSync(snapshotFile, JSON.stringify({ format: 1, context: repository.context, files: repository.files.map(({ lines, ...file }) => file) })); return { source, description: 'Refund change', repo: destination, snapshotFile }; }, async prepare() { assert.fail('Must not download a repository'); }, async metadata() { return { source, description: 'Refund change' }; } };
  const store = new ReviewStore({ root: path.join(sample.root, 'pr-data'), github, nativeReviewer: reviewer });
  const { run, report } = await store.start({ kind: 'github_pr', url: source.url, rules }); const { nativeReview } = await store.codeReview(run.id);
  assert.equal(fs.existsSync(path.join(store.directory(run.id), 'pr-source/.git')), false);
  const final = await store.finalize(run.id, payload(report, nativeReview, [candidate()]));
  assert.equal(final.report.source.headSha, source.headSha); assert.equal(final.report.freshness.status, 'current');
  assert.equal(final.report.results[0].findings[0].origin, 'codex');
});

test('unresolved context can retain a supported bug while keeping the general review incomplete', async t => {
  const { store, start } = setup(t); const { run, report } = await start(); const { nativeReview } = await store.codeReview(run.id);
  const final = await store.finalize(run.id, payload(report, nativeReview, [candidate('warning')], 'not_assessed'));
  assert.equal(final.report.results[0].findings.length, 1);
  assert.equal(final.report.results[0].status, 'not_assessed');
  assert.equal(reviewVerdict(final.report.results, { report: final.report }).state, 'incomplete');
});
