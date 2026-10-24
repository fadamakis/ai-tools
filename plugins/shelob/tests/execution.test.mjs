import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { fixture, beforeDemo, weakenDemo } from './fixtures.mjs';
import { createReport } from '../scripts/shelob.mjs';
import { digest } from '../scripts/lib/git.mjs';
import { renderReport } from '../scripts/lib/report.mjs';
import { reviewExecution } from '../assets/review-execution.mjs';
import { reviewVerdict } from '../assets/report-model.mjs';
import { ReviewStore } from '../server/store.mjs';

function scopedReview(t) {
  const sample = fixture(beforeDemo); t.after(sample.cleanup); weakenDemo(sample);
  const options = { repo: sample.repo, base: 'main', nativeReviewRequired: true };
  const initial = createReport(options);
  const nativeOutput = 'Fixture native review output.';
  const nativeReview = { status: 'completed', snapshotId: initial.snapshot.id, outputDigest: digest(nativeOutput) };
  const assessmentData = { schemaVersion: '1.0.0', snapshotId: initial.snapshot.id,
    codeReview: { outputDigest: nativeReview.outputDigest, status: 'not_assessed', reason: 'Callers are outside the selected PR-only source.' },
    assessments: initial.results.filter(result => result.mode === 'contextual' && result.matchedFiles.length && result.ruleId !== 'DESCRIPTION-001').map(result => ({
      ruleId: result.ruleId, status: result.ruleId === 'VISUAL-001' ? 'not_assessed' : 'assessed', reason: result.ruleId === 'VISUAL-001' ? 'Rendered visual evidence was not supplied.' : 'Scoped evidence inspected.',
    })) };
  const source = { kind: 'github_pr', reviewMode: 'pr_only', url: 'https://github.com/example/repo/pull/1', repository: 'example/repo', number: 1,
    headSha: initial.repository.head, baseSha: initial.repository.baseCommit };
  const finalOptions = { ...options, nativeReview, assessmentData, source };
  const report = createReport(finalOptions); report.freshness = { status: 'current' };
  return { sample, report, assessmentData, nativeReview, nativeOutput, finalOptions };
}

test('completed scoped execution retains unchecked context, visual coverage, findings and blocked approval in exported output', t => {
  const { report } = scopedReview(t), original = JSON.stringify(report);
  assert.equal(report.analysis.execution.label, 'Completed · PR-only');
  const verdict = reviewVerdict(report.results, { report, runState: 'complete' });
  assert.equal(verdict.state, 'incomplete');
  assert.ok(verdict.coverage.percent < 100);
  const dom = new JSDOM(renderReport(report)); t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.match(doc.querySelector('.support-section').textContent, /Completed · PR-only/);
  assert.match(doc.querySelector('.review-summary h2').textContent, /Needs review/);
  assert.match(doc.querySelector('.support-section').textContent, /Callers are outside/);
  assert.match(doc.querySelector('.support-section').textContent, /Rendered visual evidence/);
  assert.equal(doc.querySelector('#approve-pr'), null);
  assert.equal(doc.querySelectorAll('.comment-card').length, report.results.flatMap(item => item.findings).length);
  assert.equal(JSON.stringify(report), original);
});

test('missing required submissions and explicitly stopped scoped work remain incomplete after finalization', t => {
  const { finalOptions } = scopedReview(t);
  for (const missing of ['codeReview', 'rule', 'stopped']) {
    const options = structuredClone(finalOptions);
    if (missing === 'codeReview') delete options.assessmentData.codeReview;
    if (missing === 'rule') options.assessmentData.assessments = [];
    if (missing === 'stopped') options.assessmentData.execution = { status: 'incomplete', reason: 'Caller tracing within the available source stopped early.' };
    const report = createReport(options);
    assert.equal(report.analysis.execution.state, 'incomplete', missing);
    assert.equal(reviewVerdict(report.results, { report, runState: 'complete' }).state, 'incomplete');
  }
  const options = structuredClone(finalOptions);
  options.assessmentData.assessments = [];
  options.assessmentData.execution = { status: 'completed', reason: 'Declared complete.' };
  assert.equal(createReport(options).analysis.execution.state, 'incomplete', 'a declaration cannot finish omitted required steps');
  delete options.nativeReview; delete options.assessmentData.codeReview;
  assert.equal(createReport(options).analysis.execution.state, 'incomplete', 'saving before the required native pass finishes is incomplete');
});

test('failures, interruptions and pending runs override a completed report without hiding findings', t => {
  const { report } = scopedReview(t);
  for (const [runState, expected] of [['failed', 'failed'], ['interrupted', 'interrupted'], ['preparing', 'pending'], ['awaiting_review', 'pending']]) {
    assert.equal(reviewExecution(report, { runState }).state, expected);
    assert.notEqual(reviewVerdict(report.results, { report, runState }).state, 'approve');
  }
  const failed = structuredClone(report); failed.analysis.codeReview.status = 'failed';
  assert.equal(reviewExecution(failed, { runState: 'complete' }).state, 'failed');
  const error = structuredClone(report); delete error.analysis.execution;
  error.results[1].status = 'error';
  assert.equal(reviewExecution(error).state, 'incomplete');
});

test('unfinished execution blocks approval even when check coverage is complete', t => {
  const { report } = scopedReview(t);
  report.results = report.results.map(result => ({ ...result, status: 'assessed', findings: [] }));
  report.status = 'no_findings';
  report.analysis.execution = { state: 'incomplete', label: 'Incomplete · PR-only', reason: 'A required scoped step stopped.' };
  const verdict = reviewVerdict(report.results, { report, runState: 'complete' });
  assert.equal(verdict.coverage.percent, 100);
  assert.equal(verdict.state, 'incomplete');
  assert.equal(verdict.reason, 'A required scoped step stopped.');
});

test('completion remains independent of blocking findings and stale source', t => {
  const { report } = scopedReview(t);
  report.results.find(item => item.findings.length).findings[0].severity = 'error';
  assert.equal(reviewExecution(report).state, 'completed');
  assert.equal(reviewVerdict(report.results, { report }).state, 'changes');
  report.freshness.status = 'outdated';
  assert.equal(reviewExecution(report).state, 'completed');
  assert.equal(reviewVerdict(report.results, { report }).state, 'changes');
});

test('local-copy, local changes, and CLI scans name the work actually executed', t => {
  const { report } = scopedReview(t);
  for (const [source, nativeRequired, contextual, label] of [
    [{ ...report.source, reviewMode: 'local_copy' }, true, true, 'Completed · Local copy'],
    [{ kind: 'local' }, true, true, 'Completed · Local changes'],
    [{ kind: 'local' }, false, false, 'Completed · Code scan'],
    [{ kind: 'local' }, false, true, 'Completed · Rule review'],
  ]) {
    const copy = structuredClone(report); copy.source = source; delete copy.analysis.execution;
    if (!nativeRequired) delete copy.analysis.codeReview;
    copy.analysis.contextual = contextual;
    copy.results = copy.results.map(item => ({ ...item, status: 'assessed' }));
    assert.equal(reviewExecution(copy).label, label);
  }
});

test('legacy finalized reports recover execution from saved assessments without rewriting evidence; absent records stay incomplete', t => {
  const { sample, report, nativeReview, nativeOutput, assessmentData } = scopedReview(t);
  delete report.analysis.execution;
  const store = new ReviewStore({ root: path.join(sample.root, 'saved') });
  const id = '12345678-1234-4123-8123-123456789abc', directory = store.directory(id);
  fs.mkdirSync(directory); const json = path.join(directory, 'report.json'), outputFile = path.join(directory, 'native.txt');
  fs.writeFileSync(json, JSON.stringify(report)); fs.writeFileSync(outputFile, nativeOutput);
  const assessmentsFile = path.join(directory, 'assessments.json'); fs.writeFileSync(assessmentsFile, JSON.stringify(assessmentData));
  store.save({ storeVersion: 1, id, state: 'complete', createdAt: report.generatedAt, source: report.source, request: { kind: 'github_pr', url: report.source.url }, final: { json }, nativeReview: { ...nativeReview, outputFile } });
  const before = [json, assessmentsFile, outputFile, path.join(directory, 'run.json')].map(file => fs.readFileSync(file));
  const saved = store.get(id);
  assert.equal(saved.report.analysis.execution.label, 'Completed · PR-only');
  assert.deepEqual(saved.report.results, report.results);
  assert.deepEqual(saved.report.snapshot, report.snapshot);
  const history = store.list();
  assert.equal(history[0].decision.label, 'Needs review');
  assert.equal(history[0].decision.comments.label, '2 optional comments');
  assert.equal(history[0].decision.next, 'Continue review');
  [json, assessmentsFile, outputFile, path.join(directory, 'run.json')].forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index]));
  fs.unlinkSync(assessmentsFile);
  assert.equal(store.get(id).report.analysis.execution.state, 'incomplete');
  const interruptedId = '22345678-1234-4123-8123-123456789abc'; fs.mkdirSync(store.directory(interruptedId));
  store.save({ storeVersion: 1, id: interruptedId, state: 'preparing', ownerPid: 999999999, createdAt: report.generatedAt, source: report.source, request: {} });
  assert.equal(store.get(interruptedId).run.state, 'interrupted');
  assert.equal(store.get(interruptedId).report, null);
});
