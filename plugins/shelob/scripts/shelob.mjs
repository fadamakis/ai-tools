#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { collectRepository, assertOutsideRepository, digest } from './lib/git.mjs';
import { loadPack, assessRules, mergeAssessments, globMatches, isTestFile } from './lib/rules.mjs';
import { renderReport } from './lib/report.mjs';
import { loadPrSnapshot } from './lib/snapshot.mjs';
import { reviewExecution } from '../assets/review-execution.mjs';
import { combineReview } from './lib/combined-review.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8')).version;
const engineDigest = digest(['scripts/shelob.mjs', 'scripts/lib/git.mjs', 'scripts/lib/rules.mjs', 'scripts/lib/snapshot.mjs', 'scripts/lib/combined-review.mjs', 'server/native-review.mjs', 'assets/finding-policy.mjs'].map(file => fs.readFileSync(path.join(pluginRoot, file), 'utf8')).join('\0'));

export function createReport(options) {
  const repository = options.snapshotFile ? loadPrSnapshot(options.snapshotFile) : collectRepository(options);
  const pack = loadPack(options.rules || path.join(pluginRoot, 'rules/baseline.json'));
  let description = null;
  if (options.descriptionFile) {
    if (fs.statSync(options.descriptionFile).size > 256 * 1024) throw new Error('Description exceeds the 256 KiB input budget.');
    description = fs.readFileSync(options.descriptionFile, 'utf8');
  }
  const snapshot = { id: digest(JSON.stringify([version, engineDigest, repository.contentDigest, pack.digest, digest(description || '')])), engineDigest, gitDigest: repository.contentDigest, rulePackDigest: pack.digest, descriptionDigest: digest(description || '') };
  let results = assessRules(repository, pack, description);
  const assessmentData = options.assessmentData || (options.assessments ? JSON.parse(fs.readFileSync(options.assessments, 'utf8')) : undefined);
  if (assessmentData) results = mergeAssessments(results, assessmentData, snapshot.id, repository, pack, description);
  results = combineReview(results, { required: options.nativeReviewRequired, receipt: options.nativeReview, assessment: assessmentData?.codeReview,
    snapshotId: snapshot.id, repository, description });
  const source = options.source || { kind: 'local' };
  if (source.kind === 'github_pr' && (source.headSha !== repository.context.head || source.baseSha !== repository.context.baseCommit)) throw new Error('PR commits do not match the scanned repository.');
  const notices = [];
  if (options.nativeReview?.status === 'failed') notices.push({ title: 'Codex review could not finish', message: options.nativeReview.error });
  if (repository.context.untracked.length) notices.push({ title: 'Untracked files skipped', message: `Shelob did not read these untracked files: ${repository.context.untracked.join(', ')}.` });
  const limitations = ['The scanner does not run tests, builds, hooks, or installs. It makes no network requests or model calls.', 'The scanner looks for JS, TS, and Python test patterns. It does not parse each language or prove test coverage.', 'The scan can miss template expressions and tests built at runtime. Review assertion helpers and equivalent rewrites in the code.'];
  if (repository.prOnly) limitations.unshift('PR-only review: the diff and changed files came from GitHub. Files outside the PR were not inspected. Use a local copy when more repository context is needed.');
  if (options.nativeReviewRequired) limitations.unshift('The native Codex pass reads an immutable bundle of changed files. The review conversation validates its findings and inspects supporting code when available. Missing context stays unchecked.');
  for (const file of repository.files.filter(f => f.limitation || f.binary)) notices.push({ title: `Shelob could not read ${file.path}`, message: file.limitation || 'Binary file. Open it in a viewer to review it.' });
  const files = repository.files.map(({ before, after, lines, ...file }) => ({ ...file, test: isTestFile(file.path), excluded: (pack.exclude || []).some(pattern => globMatches(file.path, pattern)) }));
  const findings = results.flatMap(r => r.findings);
  const notAssessed = results.filter(r => r.status === 'not_assessed' || r.status === 'error').length;
  const report = { schemaVersion: '1.2.0', source, pluginVersion: version, generatedAt: new Date().toISOString(), status: findings.length ? 'needs_review' : notAssessed || notices.length ? 'incomplete' : 'no_findings',
    repository: repository.context, snapshot, rulePack: { id: pack.id, name: pack.name || pack.id, version: pack.version, source: pack.source, digest: pack.digest, exclude: pack.exclude || [] },
    description: description === null ? null : { source: path.resolve(options.descriptionFile), text: description },
    analysis: { deterministic: true, contextual: Boolean(options.assessments || options.assessmentData), testsExecuted: false, runtime: process.version,
      ...(options.nativeReviewRequired ? { codeReview: { required: true, status: options.nativeReview?.status || 'pending', engine: 'codex exec review',
        ...(options.nativeReview?.outputDigest ? { outputDigest: options.nativeReview.outputDigest } : {}) } } : {}) }, results, files, notices, limitations };
  report.analysis.execution = reviewExecution(report, { assessmentData });
  return report;
}

export function writeReport(report, destination) {
  const output = assertOutsideRepository(destination, report.repository.root);
  const jsonPath = path.join(output, 'report.json'), htmlPath = path.join(output, 'report.html');
  if (fs.existsSync(jsonPath) || fs.existsSync(htmlPath)) throw new Error('Report files already exist. Choose a new output directory to preserve previous evidence.');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try { fs.writeFileSync(htmlPath, renderReport(report), { flag: 'wx', mode: 0o600 }); }
  catch (error) { fs.unlinkSync(jsonPath); throw error; }
  return { json: jsonPath, html: htmlPath };
}

const help = `Shelob ${version} — local review against explicit rules

  node scripts/shelob.mjs check --repo PATH --output OUTSIDE_REPO [options]

  --scope all|branch|staged|unstaged  Default: all tracked changes from merge-base
  --base REF                       Local base for all/branch; inferred main/master
  --rules FILE                     External versioned rule pack (JSON)
  --description-file FILE          Optional draft PR description
  --assessments FILE               Contextual results bound to the current snapshot
  --format json|html               JSON prints report; html prints report paths
  --open                           Open the generated HTML report
  --help                           Show help

Git is read without optional locks, external diff drivers, or text conversion.
The scanner never runs project code. Untracked files are listed, not inspected.
Outputs must be outside the reviewed repository. Existing reports are preserved.
Set SHELOB_GIT only when selecting an alternative installed Git executable.
`;

export function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help') || argv[0] === 'help') { console.log(help); return; }
  if (argv.shift() !== 'check') throw new Error('Expected the check command. Use --help for usage.');
  const options = { scope: 'all', format: 'html' };
  const fields = { '--repo': 'repo', '--scope': 'scope', '--base': 'base', '--rules': 'rules', '--output': 'output', '--description-file': 'descriptionFile', '--assessments': 'assessments', '--format': 'format' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--open') options.open = true;
    else {
      if (!fields[arg] || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${arg}`);
      options[fields[arg]] = argv[++i];
    }
  }
  if (!options.output) throw new Error('An explicit --output directory outside the reviewed repository is required.');
  if (!['json', 'html'].includes(options.format)) throw new Error('Format must be json or html.');
  const report = createReport(options);
  const outputs = writeReport(report, options.output);
  if (options.format === 'json') console.log(JSON.stringify(report, null, 2));
  else console.log(JSON.stringify({ status: report.status, scope: report.repository.scope, findings: report.results.reduce((n, r) => n + r.findings.length, 0), notAssessed: report.results.filter(r => r.status === 'not_assessed').length, snapshotId: report.snapshot.id, outputs }, null, 2));
  if (options.open) {
    try {
      if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Open this report using its saved path.');
      execFileSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [outputs.html], { stdio: 'ignore', timeout: 10_000 });
    } catch (error) { console.error(`Report saved; automatic opening was unavailable: ${error.message}`); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(`Shelob: ${error.message}`); process.exitCode = 2; }
}
