import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { fixture, beforeDemo, weakenDemo } from './fixtures.mjs';
import { createReport, writeReport } from '../scripts/shelob.mjs';
import { collectRepository, assertOutsideRepository } from '../scripts/lib/git.mjs';
import { globMatches, loadPack, codeOnly } from '../scripts/lib/rules.mjs';
import { renderReport } from '../scripts/lib/report.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allFindings = report => report.results.flatMap(r => r.findings);
const rule = (report, id) => report.results.find(r => r.ruleId === id);
function useFixture(t, files) { const item = fixture(files); t.after(item.cleanup); return item; }
function scan(item, extra = {}) { return createReport({ repo: item.repo, base: 'main', scope: 'all', ...extra }); }
function assessment(item, report, assessments) {
  const filename = path.join(item.root, 'assessments.json');
  fs.writeFileSync(filename, JSON.stringify({ schemaVersion: '1.0.0', snapshotId: report.snapshot.id, assessments }));
  return filename;
}

test('a clean repository has no findings and no invented contextual pass', t => {
  const item = useFixture(t);
  const report = scan(item);
  assert.equal(allFindings(report).length, 0);
  assert.equal(report.status, 'no_findings');
  assert.ok(report.results.every(r => r.status === 'not_applicable'));
  assert.equal(report.analysis.testsExecuted, false);
});

test('known weakened-test diff reports exact skip, assertion, and gate evidence', t => {
  const item = useFixture(t, beforeDemo); weakenDemo(item);
  const report = scan(item);
  assert.deepEqual(allFindings(report).map(f => f.ruleId).sort(), ['TEST-001', 'TEST-002', 'TEST-004']);
  const marker = rule(report, 'TEST-001').findings[0].evidence[0];
  assert.equal(marker.path, 'src/discount.test.ts'); assert.equal(marker.line, 3); assert.equal(marker.side, 'after');
  assert.match(marker.snippet, /^it\.skip/);
  const removed = rule(report, 'TEST-002').findings[0].evidence[0];
  assert.equal(removed.side, 'before'); assert.equal(removed.line, 5);
  assert.equal(rule(report, 'TEST-003').status, 'not_assessed');
  assert.equal(rule(report, 'DESCRIPTION-001').status, 'not_assessed');
  assert.equal(rule(report, 'VISUAL-001').status, 'not_assessed');
});

test('strings, multiline comments, templates, and regular expressions are not test markers', t => {
  const item = useFixture(t, { 'value.test.ts': 'it("works", () => { expect(1).toBe(1); });\n' });
  item.write('value.test.ts', 'const prose = "it.skip(whatever)";\n/*\nit.only("no", () => {});\n*/\nconst text = `test.skip("template")`;\nconst expression = /test.skip()/;\nit("works", () => { expect(1).toBe(1); });\n');
  assert.equal(rule(scan(item), 'TEST-001').findings.length, 0);
});

test('moving assertions across changed test files does not imply weakened tests', t => {
  const item = useFixture(t, { 'a.test.ts': 'it("works", () => { expect(1).toBe(1); });\n' });
  fs.renameSync(path.join(item.repo, 'a.test.ts'), path.join(item.repo, 'b.test.ts')); item.git('add', '--all');
  assert.equal(rule(scan(item), 'TEST-002').findings.length, 0);
});

test('a harmless assertion rewrite is a counterexample to assertion reduction', t => {
  const item = useFixture(t, { 'a.test.ts': 'it("works", () => { expect(value).toEqual(1); });\n' });
  item.write('a.test.ts', 'it("works", () => { expect(value).toBe(1); });\n');
  assert.equal(rule(scan(item), 'TEST-002').findings.length, 0);
});

test('marker formatting and moving an already-skipped test do not create a new omission', t => {
  const item = useFixture(t, { 'a.test.ts': 'it.skip("works", () => { expect(1).toBe(1); });\n' });
  item.write('a.test.ts', 'it . skip ("works", () => { expect(1).toBe(1); });\n');
  assert.equal(rule(scan(item), 'TEST-001').findings.length, 0);
  fs.renameSync(path.join(item.repo, 'a.test.ts'), path.join(item.repo, 'b.test.ts')); item.git('add', '--all');
  assert.equal(rule(scan(item), 'TEST-001').findings.length, 0);
});

test('test documentation and quoted shell examples are counterexamples to executable markers', t => {
  const item = useFixture(t, { 'tests/README.md': 'Testing guide\n', '.github/workflows/checks.yml': 'steps:\n  - run: pnpm test\n' });
  item.write('tests/README.md', 'Testing guide\nit.skip("example", () => {});\n');
  item.write('.github/workflows/checks.yml', 'steps:\n  - run: pnpm test\n  - run: echo "do not use || true"\n');
  const report = scan(item);
  assert.equal(rule(report, 'TEST-001').findings.length, 0); assert.equal(rule(report, 'TEST-004').findings.length, 0);
});

test('Python comments and docstrings are ignored while a real skip decorator is reported', t => {
  const item = useFixture(t, { 'tests/test_value.py': 'def test_value():\n    assert value == 1\n' });
  item.write('tests/test_value.py', '"""\n@pytest.mark.skip\n"""\n# @pytest.mark.skip\n@pytest.mark.skip(reason="investigate")\ndef test_value():\n    assert value == 1\n');
  const result = rule(scan(item), 'TEST-001');
  assert.equal(result.findings.length, 1); assert.equal(result.findings[0].evidence[0].line, 5);
});

test('configured size and spread thresholds trigger advisories with unrelated test checks quiet', t => {
  const item = useFixture(t, { 'a/value.txt': 'one\n', 'b/value.txt': 'two\n' });
  item.write('a/value.txt', 'one\nextra\n'); item.write('b/value.txt', 'two\nextra\n');
  const pack = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'rules/baseline.json'), 'utf8'));
  pack.rules.find(r => r.id === 'SCOPE-001').options = { maxLines: 1, maxFiles: 1 };
  pack.rules.find(r => r.id === 'SCOPE-002').options.maxAreas = 1;
  const filename = path.join(item.root, 'rules.json'); fs.writeFileSync(filename, JSON.stringify(pack));
  const report = scan(item, { rules: filename });
  assert.equal(rule(report, 'SCOPE-001').findings.length, 1); assert.equal(rule(report, 'SCOPE-002').findings.length, 1);
  assert.equal(rule(report, 'TEST-001').status, 'not_applicable');
});

test('the default thresholds do not reject a small related change', t => {
  const item = useFixture(t); item.write('src/value.ts', 'export const value = 2;\n');
  assert.equal(rule(scan(item), 'SCOPE-001').findings.length, 0);
});

test('lowered coverage thresholds are reported but a raised threshold is a counterexample', t => {
  const item = useFixture(t, { 'jest.config.js': 'export default { coverageThreshold: { global: { lines: 80 } } };\n' });
  item.write('jest.config.js', 'export default { coverageThreshold: { global: { lines: 70 } } };\n');
  assert.equal(rule(scan(item), 'TEST-004').findings.length, 1);
  item.write('jest.config.js', 'export default { coverageThreshold: { global: { lines: 90 } } };\n');
  assert.equal(rule(scan(item), 'TEST-004').findings.length, 0);
});

test('branch, staged, unstaged, and all scopes refer to the correct versions', t => {
  const item = useFixture(t);
  item.write('src/value.ts', 'export const value = 2;\n'); item.git('add', '--all'); item.git('commit', '--no-verify', '-m', 'Committed change');
  item.write('src/value.ts', 'export const value = 3;\n'); item.git('add', '--all');
  item.write('src/value.ts', 'export const value = 4;\n');
  const branch = collectRepository({ repo: item.repo, base: 'main', scope: 'branch' }).files[0];
  const staged = collectRepository({ repo: item.repo, scope: 'staged' }).files[0];
  const unstaged = collectRepository({ repo: item.repo, scope: 'unstaged' }).files[0];
  const combined = collectRepository({ repo: item.repo, base: 'main', scope: 'all' }).files[0];
  assert.equal(branch.before, 'export const value = 1;\n'); assert.equal(branch.after, 'export const value = 2;\n');
  assert.equal(staged.before, branch.after); assert.equal(staged.after, 'export const value = 3;\n');
  assert.equal(unstaged.before, staged.after); assert.equal(unstaged.after, 'export const value = 4;\n');
  assert.equal(combined.before, branch.before); assert.equal(combined.after, unstaged.after);
});

test('Git status, tracked files, and index remain unchanged; outputs stay outside the repository', t => {
  const item = useFixture(t, beforeDemo); weakenDemo(item); item.write('untracked.ts', 'throw new Error("must not execute");\n');
  const before = item.git('status', '--porcelain=v1', '-z');
  const index = fs.readFileSync(path.join(item.repo, '.git/index'));
  const output = writeReport(scan(item), path.join(item.root, 'report'));
  assert.equal(item.git('status', '--porcelain=v1', '-z'), before);
  assert.deepEqual(fs.readFileSync(path.join(item.repo, '.git/index')), index);
  assert.ok(fs.existsSync(output.json)); assert.ok(fs.existsSync(output.html));
  const report = JSON.parse(fs.readFileSync(output.json, 'utf8'));
  assert.deepEqual(report.repository.untracked, ['untracked.ts']); assert.equal(report.files.some(f => f.path === 'untracked.ts'), false);
  assert.match(report.notices[0].message, /untracked\.ts/);
  assert.throws(() => writeReport(report, path.join(item.repo, 'report')), /outside/);
  assert.throws(() => writeReport(report, path.join(item.root, 'report')), /already exist/);
});

test('output cannot enter the reviewed repository through a symlink', t => {
  const item = useFixture(t);
  const link = path.join(item.root, 'alias'); fs.symlinkSync(item.repo, link, 'dir');
  assert.throws(() => assertOutsideRepository(path.join(link, 'new/output'), item.repo), /outside/);
});

test('literal unusual filenames retain correct evidence without HTML injection', t => {
  const filename = 'src/<script>oops</script> [tab]\t.test.ts';
  const item = useFixture(t, { [filename]: 'it("works", () => { expect(1).toBe(1); });\n' });
  item.write(filename, 'it.skip("works", () => { expect(1).toBe(1); });\n');
  const report = scan(item); assert.equal(report.files[0].path, filename);
  const html = renderReport(report);
  assert.equal(html.includes('<script>oops</script>'), false); assert.match(html, /&lt;script&gt;oops&lt;\/script&gt;/);
  assert.equal((html.match(/<script /g) || []).length, 2); // Report data plus the nonce-protected enhancement bundle. assert.match(html, /Content-Security-Policy/);
});

test('binary sources are explicitly uninspected', t => {
  const item = useFixture(t, { 'src/image.png': Buffer.from([0, 1, 2]) });
  item.write('src/image.png', Buffer.from([0, 2, 3]));
  const report = scan(item); assert.equal(report.files[0].binary, true); assert.ok(report.notices.some(n => /Binary/.test(n.message)));
});

test('a no-description outcome is not a violation and can be reviewed when supplied', t => {
  const item = useFixture(t); item.write('src/value.ts', 'export const value = 2;\n');
  assert.equal(rule(scan(item), 'DESCRIPTION-001').status, 'not_assessed');
  const descriptionFile = path.join(item.root, 'description.md'); fs.writeFileSync(descriptionFile, 'What: update value.\nWhy: change the default.\nVerification: inspected; tests not run.\n');
  const initial = scan(item, { descriptionFile });
  const assessments = assessment(item, initial, [{ ruleId: 'DESCRIPTION-001', status: 'assessed', reason: 'The draft explains the changed default and accurately labels source-only verification.' }]);
  const reviewed = scan(item, { descriptionFile, assessments });
  assert.equal(rule(reviewed, 'DESCRIPTION-001').status, 'assessed');
});

test('contextual findings require valid evidence and preserve deterministic outcomes', t => {
  const item = useFixture(t, beforeDemo); weakenDemo(item);
  const initial = scan(item);
  const assessments = assessment(item, initial, [{ ruleId: 'TEST-003', status: 'findings', reason: 'Validation was removed while the rejection test is skipped.', findings: [{ title: 'Invalid percentages are no longer rejected', message: 'For percent -10 the function now increases the total, while the prior API rejected the input. The rejection test is skipped.', nextAction: 'Restore the agreed input contract and keep its rejection tests active.', evidence: [{ path: 'src/discount.ts', line: 2 }, { path: 'src/discount.test.ts', line: 3 }] }] }]);
  const reviewed = scan(item, { assessments });
  assert.equal(rule(reviewed, 'TEST-003').findings[0].evidence[0].snippet, '  return total * (1 - percent / 100);');
  assert.equal(rule(reviewed, 'TEST-003').findings[0].origin, 'contextual');
  assert.deepEqual(rule(reviewed, 'TEST-001'), rule(initial, 'TEST-001'));
});

test('stale contextual results are rejected after an edit', t => {
  const item = useFixture(t); item.write('src/value.ts', 'export const value = 2;\n');
  const initial = scan(item);
  const assessments = assessment(item, initial, [{ ruleId: 'INDEPENDENCE-001', status: 'assessed', reason: 'One default changes without dependencies.' }]);
  item.write('src/value.ts', 'export const value = 3;\n');
  assert.throws(() => scan(item, { assessments }), /snapshot mismatch/);
});

test('changing the selected rule pack or description invalidates contextual evidence', t => {
  const item = useFixture(t); item.write('src/value.ts', 'export const value = 2;\n');
  const rules = path.join(item.root, 'pack.json'), descriptionFile = path.join(item.root, 'description.md');
  fs.copyFileSync(path.join(pluginRoot, 'rules/baseline.json'), rules); fs.writeFileSync(descriptionFile, 'What: update the default.\n');
  const initial = scan(item, { rules, descriptionFile });
  const supplied = assessment(item, initial, [{ ruleId: 'INDEPENDENCE-001', status: 'assessed', reason: 'One default changes.' }]);
  fs.appendFileSync(descriptionFile, 'Why: a changed requirement.\n');
  assert.throws(() => scan(item, { rules, descriptionFile, assessments: supplied }), /snapshot mismatch/);
  fs.writeFileSync(descriptionFile, 'What: update the default.\n');
  const pack = JSON.parse(fs.readFileSync(rules, 'utf8')); pack.rules.find(r => r.id === 'INDEPENDENCE-001').instructions += ' Check callers.'; fs.writeFileSync(rules, JSON.stringify(pack));
  assert.throws(() => scan(item, { rules, descriptionFile, assessments: supplied }), /snapshot mismatch/);
});

test('deterministic results, duplicate rules, invalid lines, and fabricated snippets cannot be imported', t => {
  const item = useFixture(t); item.write('src/value.ts', 'export const value = 2;\n'); const initial = scan(item);
  const candidate = { ruleId: 'INDEPENDENCE-001', status: 'findings', reason: 'Inspect this change.', findings: [{ title: 'Candidate', message: 'Example evidence validation case.', nextAction: 'Inspect.', evidence: [{ path: 'src/value.ts', line: 99 }] }] };
  assert.throws(() => scan(item, { assessments: assessment(item, initial, [candidate]) }), /line does not exist/);
  candidate.findings[0].evidence[0] = { path: 'src/value.ts', line: 1, snippet: 'fabricated' };
  assert.throws(() => scan(item, { assessments: assessment(item, initial, [candidate]) }), /snippet does not match/);
  assert.throws(() => scan(item, { assessments: assessment(item, initial, [{ ruleId: 'TEST-001', status: 'assessed', reason: 'Override.' }]) }), /cannot be overridden/);
  const clean = { ruleId: 'INDEPENDENCE-001', status: 'assessed', reason: 'One default changes.' };
  assert.throws(() => scan(item, { assessments: assessment(item, initial, [clean, clean]) }), /uniquely/);
});

test('related evidence uses the selected staged snapshot rather than unstaged edits', t => {
  const item = useFixture(t, { 'src/value.ts': 'export const value = 1;\n', 'src/consumer.ts': 'export const expected = 1;\n' });
  item.write('src/value.ts', 'export const value = 2;\n'); item.git('add', 'src/value.ts');
  item.write('src/consumer.ts', 'export const expected = 3;\n');
  const initial = scan(item, { scope: 'staged' });
  const supplied = assessment(item, initial, [{ ruleId: 'INDEPENDENCE-001', status: 'findings', reason: 'Consumer mismatch.', findings: [{ title: 'Contract needs a consumer update', message: 'The staged default changed without the staged consumer.', nextAction: 'Check the caller contract.', evidence: [{ path: 'src/value.ts', line: 1 }, { path: 'src/consumer.ts', line: 1, snippet: 'export const expected = 1;' }] }] }]);
  assert.equal(rule(scan(item, { scope: 'staged', assessments: supplied }), 'INDEPENDENCE-001').findings[0].evidence[1].snippet, 'export const expected = 1;');
});

test('rule packs cannot register executable checks or silently reuse IDs', t => {
  const item = useFixture(t); const original = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'rules/baseline.json'), 'utf8'));
  const filename = path.join(item.root, 'rules.json'); original.rules[0].check = 'shell-command'; fs.writeFileSync(filename, JSON.stringify(original));
  assert.throws(() => loadPack(filename), /cannot execute/);
  original.rules[0].check = 'change-size'; original.rules.push(original.rules[0]); fs.writeFileSync(filename, JSON.stringify(original));
  assert.throws(() => loadPack(filename), /unique/);
});

test('invalid bases and nonrepositories give actionable errors; staged review needs no base', t => {
  const item = useFixture(t);
  assert.throws(() => scan(item, { base: 'does-not-exist' }), /not a local commit/);
  assert.throws(() => createReport({ repo: item.root }), /Unable to read Git state/);
  assert.equal(createReport({ repo: item.repo, scope: 'staged' }).repository.base, null);
});

test('CLI exits successfully for advisory findings and fails for missing output', t => {
  const item = useFixture(t, beforeDemo); weakenDemo(item);
  const cli = path.join(pluginRoot, 'scripts/shelob.mjs');
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'check', '--repo', item.repo, '--output', path.join(item.root, 'cli-output')], { encoding: 'utf8' }));
  assert.equal(result.findings, 3); assert.equal(result.status, 'needs_review');
  const invalid = spawnSync(process.execPath, [cli, 'check', '--repo', item.repo], { encoding: 'utf8' });
  assert.equal(invalid.status, 2); assert.match(invalid.stderr, /explicit --output/);
});

test('glob scopes include root files and exclusions do not hide an ordinary clock module', t => {
  assert.equal(globMatches('file.ts', '**/*.ts'), true); assert.equal(globMatches('src/file.ts', '**/*.ts'), true);
  assert.equal(globMatches('src/file.py', '**/*.ts'), false);
  const item = useFixture(t, { 'src/clock.ts': 'export const now = 1;\n', 'pnpm-lock.yaml': 'lockfileVersion: 9\n' });
  item.write('src/clock.ts', 'export const now = 2;\n'); item.write('pnpm-lock.yaml', 'lockfileVersion: 10\n');
  const report = scan(item); assert.equal(report.files.find(f => f.path === 'src/clock.ts').excluded, false); assert.equal(report.files.find(f => f.path === 'pnpm-lock.yaml').excluded, true);
});

test('Python and JS lexical masking preserves line positions', () => {
  assert.equal(codeOnly('"a"\n// test.skip()\nexpect(x);').split('\n')[2], 'expect(x);');
  assert.equal(codeOnly('"""a\nassert False\n"""\nassert value', true).split('\n')[3], 'assert value');
});

test('contextual findings carry individual severity and a short PR comment, with a blocking rule floor', t => {
  const item = fixture(beforeDemo); t.after(item.cleanup); weakenDemo(item);
  const initial = scan(item);
  const candidate = severity => ({ ruleId: 'TEST-003', status: 'findings', reason: 'A specific invalid input is no longer rejected.', findings: [{ title: 'Invalid input is accepted', message: 'Negative percentages increase the total instead of rejecting the input.', nextAction: 'Restore input validation.', severity, comment: 'Could we restore rejection of negative percentages? They currently increase the total.', evidence: [{ path: 'src/discount.ts', line: 2 }] }] });
  for (const severity of ['error', 'warning', 'info']) {
    const report = scan(item, { assessments: assessment(item, initial, [candidate(severity)]) });
    assert.equal(rule(report, 'TEST-003').findings[0].severity, severity);
    assert.match(rule(report, 'TEST-003').findings[0].comment, /restore rejection/);
    assert.ok(report.results.flatMap(result => result.findings).every(finding => finding.comment.length <= 600));
  }
  assert.throws(() => scan(item, { assessments: assessment(item, initial, [candidate('critical')]) }), /severity/);
  const long = candidate('warning'); long.findings[0].comment = 'x'.repeat(601);
  assert.throws(() => scan(item, { assessments: assessment(item, initial, [long]) }), /600 characters/);
  const pack = JSON.parse(fs.readFileSync(new URL('../rules/baseline.json', import.meta.url)));
  pack.rules.find(rule => rule.id === 'TEST-003').severity = 'error';
  const rules = path.join(item.root, 'blocking-rules.json'); fs.writeFileSync(rules, JSON.stringify(pack));
  const strict = scan(item, { rules });
  assert.throws(() => scan(item, { rules, assessments: assessment(item, strict, [candidate('warning')]) }), /cannot weaken/);
});
