import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createReport, writeReport } from '../scripts/shelob.mjs';
import { git, readVersion, assertOutsideRepository, digest, collectRepository } from '../scripts/lib/git.mjs';
import { GitHubSource, parsePrUrl } from './github.mjs';
import { loadPrSnapshot } from '../scripts/lib/snapshot.mjs';
import { reviewExecution } from '../assets/review-execution.mjs';
import { reviewVerdict } from '../assets/report-model.mjs';
import { RuleLibrary } from './rules.mjs';
import { NativeReviewer } from './native-review.mjs';
import { ReviewSettings, atomicJson } from './settings.mjs';
import { ReviewPublisher } from './reviews.mjs';
import { reviewDecision } from '../assets/review-decision.mjs';

const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const json = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const now = () => new Date().toISOString();
export const defaultDataRoot = () => process.env.SHELOB_DATA_DIR || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support/Shelob' : '.local/share/shelob');

export class ReviewStore {
  constructor({ root = defaultDataRoot(), github = new GitHubSource(), nativeReviewer = new NativeReviewer() } = {}) {
    this.root = path.resolve(root); this.github = github; this.nativeReviewer = nativeReviewer; this.rules = new RuleLibrary(this.root); this.settings = new ReviewSettings(this.root);
    fs.mkdirSync(path.join(this.root, 'runs'), { recursive: true, mode: 0o700 });
  }
  directory(id) {
    if (!idPattern.test(id)) throw new Error('Invalid review ID.');
    return path.join(this.root, 'runs', id);
  }
  save(run) {
    run.updatedAt = now();
    atomicJson(path.join(this.directory(run.id), 'run.json'), run);
  }
  manifest(id) {
    const run = json(path.join(this.directory(id), 'run.json'));
    if (run.storeVersion !== 1) throw new Error('This review needs a newer Shelob version.');
    return run;
  }
  associate(session, id) {
    atomicJson(path.join(this.root, 'conversations', `${digest(session)}.json`), { runId: id });
  }
  currentRun(session) {
    const filename = path.join(this.root, 'conversations', `${digest(session)}.json`);
    if (!fs.existsSync(filename)) return undefined;
    return json(filename).runId;
  }
  get(id) {
    const run = this.manifest(id);
    if (run.state === 'preparing' && (!alive(run.ownerPid) || Date.now() - Date.parse(run.createdAt) > 10 * 60_000)) { run.state = 'interrupted'; run.error = 'Preparation stopped before a report was saved. Start a fresh review.'; }
    const output = run.final || run.initial;
    const report = output ? json(output.json) : null;
    const nativeReview = run.nativeReview ? { ...run.nativeReview } : null;
    if (nativeReview?.status === 'running' && (!alive(nativeReview.ownerPid) || Date.now() - Date.parse(nativeReview.startedAt) > 6 * 60_000)) {
      nativeReview.status = 'failed'; nativeReview.error = 'Native Codex review was interrupted. Start a fresh review.';
    }
    if (report && !run.final && nativeReview) {
      report.analysis.codeReview = { required: true, engine: 'codex exec review', status: nativeReview.status };
      const check = report.results.find(result => result.ruleId === 'CODEX-REVIEW');
      if (check) check.reason = nativeReview.status === 'failed' ? nativeReview.error : nativeReview.status === 'completed' ? 'Native review finished. Validate its findings and missing context in this conversation.' : 'Native Codex review is running.';
      if (nativeReview.status === 'failed') report.notices.unshift({ title: 'Codex review could not finish', message: nativeReview.error });
    }
    if (nativeReview?.status === 'completed') {
      nativeReview.output = fs.readFileSync(nativeReview.outputFile, 'utf8');
      if (digest(nativeReview.output) !== nativeReview.outputDigest) throw new Error('Native review output changed. Start a fresh review.');
    }
    if (nativeReview) delete nativeReview.outputFile;
    if (report) {
      const assessmentsFile = run.final && path.join(path.dirname(run.final.json), 'assessments.json');
      const assessmentData = !report.analysis.execution && assessmentsFile && fs.existsSync(assessmentsFile) ? json(assessmentsFile) : undefined;
      report.analysis.execution = reviewExecution(report, { runState: run.state, assessmentData });
    }
    return { run, report, nativeReview };
  }
  list() {
    return fs.readdirSync(path.join(this.root, 'runs')).filter(id => idPattern.test(id)).flatMap(id => {
      try {
        const { run, report } = this.get(id);
        const pr = run.source.kind === 'github_pr' ? { ...parsePrUrl(run.source.url), ...run.source } : null;
        return [{ id, createdAt: run.createdAt, state: run.state, source: run.source, snapshotId: report?.snapshot.id,
          reviewKey: run.source.kind === 'local' ? digest(JSON.stringify([run.request.repo, report?.repository.branch, run.request.scope || 'all'])) : pr.url.toLowerCase(),
          ...(report ? { execution: report.analysis.execution, verdict: reviewVerdict(report.results, { report, runState: run.state }),
            decision: reviewDecision(report, { execution: report.analysis.execution, verdict: reviewVerdict(report.results, { report, runState: run.state }), publishing: new ReviewPublisher(this).status(id) }) } : {}),
          title: pr ? `${pr.repository} #${pr.number}` : path.basename(run.request.repo),
          findings: report?.results.reduce((count, rule) => count + rule.findings.length, 0), error: run.error || null }];
      } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  history({ repository, prNumber, headSha }) {
    const reviews = [], unreadableRunIds = [];
    let emptyDirectoryCount = 0;
    for (const id of fs.readdirSync(path.join(this.root, 'runs')).filter(id => idPattern.test(id))) {
      try {
        if (!fs.existsSync(path.join(this.directory(id), 'run.json')) && fs.readdirSync(this.directory(id)).length === 0) {
          emptyDirectoryCount++; continue;
        }
        const manifest = this.manifest(id);
        if (manifest.source.kind !== 'github_pr') continue;
        const pr = parsePrUrl(manifest.source.url);
        if (pr.repository.toLowerCase() !== repository.toLowerCase() || pr.number !== prNumber) continue;
        const { run, report, nativeReview } = this.get(id);
        const sourceHead = run.source.headSha || report?.source?.headSha;
        if (run.source.headSha && report?.source?.headSha && run.source.headSha !== report.source.headSha) throw Error('Saved head mismatch.');
        const reviewedHead = /^[a-f0-9]{40}$/.test(sourceHead || '') ? sourceHead : null;
        reviews.push({ runId: id, createdAt: run.createdAt, state: run.state, headSha: reviewedHead,
          headMatches: reviewedHead ? reviewedHead === headSha : null, snapshotId: report?.snapshot.id || null,
          execution: report?.analysis.execution || null, nativeReviewStatus: nativeReview?.status || null,
          active: run.state === 'preparing' || run.state === 'awaiting_review' && nativeReview?.status !== 'failed',
          requester: run.source.requester || null });
      } catch { unreadableRunIds.push(id); }
    }
    return { scope: 'this_store_only', repository: repository.toLowerCase(), prNumber, headSha,
      complete: unreadableRunIds.length === 0, unreadableRunIds, emptyDirectoryCount, reviews: reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }
  async start(request, { wait = true } = {}) {
    if (!['local', 'github_pr'].includes(request.kind)) throw new Error('Choose local changes or a GitHub PR.');
    if (request.kind === 'github_pr') {
      parsePrUrl(request.url);
      if (request.reviewMode !== undefined && !['pr_only', 'local_copy'].includes(request.reviewMode)) throw new Error('Choose PR only or a local copy.');
      // Normalize new requests only. Saved legacy runs retain their original mode.
      request = { ...request, reviewMode: request.reviewMode ?? 'pr_only' };
    }
    if (request.kind === 'local') {
      if (!path.isAbsolute(request.repo || '')) throw new Error('A local review needs an absolute repository path.');
      const repositoryRoot = git(request.repo, ['rev-parse', '--show-toplevel']).trim();
      assertOutsideRepository(this.root, repositoryRoot);
    }
    if (request.rules && !path.isAbsolute(request.rules)) throw new Error('A rule pack needs an absolute path.');
    if (request.description && Buffer.byteLength(request.description) > 256 * 1024) throw new Error('Description exceeds the 256 KiB input budget.');
    if (request.requester !== undefined) {
      const { name, url } = request.requester || {};
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) throw new Error('The requester needs a name of 1–160 characters.');
      if (url !== undefined) {
        let link;
        try { link = new URL(url); } catch { throw new Error('The request link must be an HTTPS URL.'); }
        if (typeof url !== 'string' || url.length > 2048 || link.protocol !== 'https:' || link.username || link.password) throw new Error('The request link must be an HTTPS URL without credentials.');
      }
      request = { ...request, requester: { name: name.trim(), ...(url !== undefined ? { url } : {}) } };
    }
    const id = randomUUID(), dir = this.directory(id);
    fs.mkdirSync(dir, { mode: 0o700 });
    // Pin the selected rules before asynchronous source preparation starts.
    this.rules.snapshot(path.join(dir, 'rules.json'), request.rules);
    const run = { storeVersion: 1, id, createdAt: now(), state: 'preparing', ownerPid: process.pid, request, reviewModel: this.settings.get().model,
      source: { ...(request.kind === 'local' ? { kind: 'local' } : { kind: 'github_pr', url: request.url, reviewMode: request.reviewMode }), ...(request.requester ? { requester: request.requester } : {}) } };
    this.save(run);
    const prepare = this.prepare(run);
    if (wait) { await prepare; return this.get(id); }
    // Preparation is a bounded I/O job. Contextual review always stays in chat.
    prepare.catch(() => {});
    return this.get(id);
  }
  async prepare(run) {
    const dir = this.directory(run.id), request = run.request;
    try {
      let repo = request.repo, description = request.description, snapshotFile;
      if (request.kind === 'github_pr') {
        const prOnly = request.reviewMode === 'pr_only';
        const prepared = prOnly ? await this.github.preparePrOnly(request.url, path.join(dir, 'pr-source')) : await this.github.prepare(request.url, path.join(dir, 'source'));
        repo = prepared.repo; description = prepared.description; run.source = { ...prepared.source, ...(request.requester ? { requester: request.requester } : {}) }; snapshotFile = prepared.snapshotFile;
      }
      let descriptionFile;
      if (description !== undefined) {
        descriptionFile = path.join(dir, 'description.md');
        fs.writeFileSync(descriptionFile, description, { mode: 0o600, flag: 'wx' });
      }
      run.options = { repo, scope: request.kind === 'github_pr' ? 'branch' : request.scope || 'all',
        base: request.kind === 'github_pr' ? run.source.baseSha : request.base, rules: path.join(dir, 'rules.json'), descriptionFile, source: run.source, nativeReviewRequired: true, ...(snapshotFile ? { snapshotFile } : {}) };
      const report = createReport(run.options);
      run.initial = writeReport(report, path.join(dir, 'initial'));
      run.state = 'awaiting_review'; this.save(run);
    } catch (error) { run.state = 'failed'; run.error = error.message; this.save(run); throw error; }
  }
  async codeReview(id, { model, wait = true } = {}) {
    const dir = this.directory(id), lock = path.join(dir, '.native-review');
    const current = this.get(id);
    if (current.run.state !== 'awaiting_review') throw new Error('Start a fresh review before running native Codex review.');
    if (!current.run.options.nativeReviewRequired) throw new Error('This older run needs a fresh review with the current Shelob version.');
    if (current.nativeReview) return current; // Idempotent: follow-ups never bill twice.
    const selectedModel = model ?? current.run.reviewModel ?? undefined;
    const setupSignature = this.settings.signature(selectedModel);
    const rejected = this.settings.rejected(setupSignature);
    if (rejected) throw new Error(`${rejected.message} Shelob stopped this repeat attempt before invoking Codex. Choose a different review model in Settings or update the CLI configuration.`);
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') return this.get(id); throw error; }
    const run = this.manifest(id);
    run.nativeReview = { status: 'running', engine: 'codex exec review', snapshotId: current.report.snapshot.id, ownerPid: process.pid, startedAt: now() };
    this.save(run);
    const work = (async () => {
      try {
        if (createReport(run.options).snapshot.id !== current.report.snapshot.id) throw new Error('The local snapshot changed. Start a fresh review.');
        const repository = run.options.snapshotFile ? loadPrSnapshot(run.options.snapshotFile) : collectRepository(run.options);
        if (repository.contentDigest !== current.report.snapshot.gitDigest) throw new Error('Source changed while collecting native review input. Start a fresh review.');
        const receipt = await this.nativeReviewer.review({ directory: path.join(dir, 'codex-review'), report: current.report, repository, pack: json(run.options.rules), model: selectedModel });
        if (createReport(run.options).snapshot.id !== current.report.snapshot.id) throw new Error('Source changed during native review. Start a fresh review.');
        run.nativeReview = receipt;
      } catch (error) { this.settings.recordFailure(setupSignature, error.message); run.nativeReview = { ...run.nativeReview, ...(selectedModel ? { requestedModel: selectedModel } : {}), status: 'failed', error: error.message, finishedAt: now() }; }
      finally { this.save(run); fs.rmSync(lock, { force: true }); }
    })();
    if (wait) await work; else work.catch(() => {});
    return this.get(id);
  }
  async finalize(id, assessmentData) {
    const dir = this.directory(id), lock = path.join(dir, '.finalizing');
    try { fs.writeFileSync(lock, String(process.pid), { mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0 || alive(pid)) throw new Error('This review is already being finalized.');
      fs.unlinkSync(lock); return this.finalize(id, assessmentData);
    }
    try {
      const run = this.manifest(id);
      if (run.state === 'complete') return this.get(id);
      if (run.state !== 'awaiting_review') throw new Error('This run is not ready for contextual review.');
      if (run.nativeReview?.status === 'running' && this.get(id).nativeReview.status === 'running') throw new Error('Native Codex review is still running. Wait before finalizing.');
      const initial = json(run.initial.json);
      if (assessmentData.snapshotId !== initial.snapshot.id) throw new Error('Assessment snapshot does not match this run.');
      if (run.nativeReview?.status === 'completed') this.get(id); // Verify saved output digest before accepting normalization.
      const report = createReport({ ...run.options, nativeReview: this.get(id).nativeReview, assessmentData });
      if (report.snapshot.id !== initial.snapshot.id) throw new Error('The local snapshot changed. Start a new run and reassess it.');
      if (run.source.kind === 'github_pr') {
        let freshness;
        try {
          const current = await this.github.metadata(run.source.url);
          const unchanged = current.source.headSha === run.source.headSha && current.source.baseSha === run.source.baseSha
            && current.description === (initial.description?.text || '');
          freshness = { status: unchanged ? 'current' : 'outdated', checkedAt: now(),
            message: unchanged ? 'PR commits and description match this review.' : 'The PR changed after this review started. Rerun it before relying on this report.' };
        } catch {
          freshness = { status: 'unknown', checkedAt: now(), message: 'Shelob could not check whether the PR changed. Check GitHub access and rerun.' };
        }
        report.freshness = freshness;
        if (freshness.status !== 'current') {
          report.notices.push({ title: freshness.status === 'outdated' ? 'PR changed' : 'PR freshness unknown', message: freshness.message });
          if (report.status === 'no_findings') report.status = 'incomplete';
        }
      }
      const attempt = path.join(dir, `final-${randomUUID()}`);
      run.final = writeReport(report, attempt);
      fs.writeFileSync(path.join(attempt, 'assessments.json'), JSON.stringify(assessmentData, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      run.state = 'complete'; this.save(run); return this.get(id);
    } finally { fs.rmSync(lock, { force: true }); }
  }
  inspect(id, { operation, side = 'after', file, query, offset = 0, limit = 100, line = 1 } = {}) {
    const { run, report } = this.get(id);
    if (!report) throw new Error('Source is not ready.');
    if (!['before', 'after'].includes(side)) throw new Error('Side must be before or after.');
    const repo = report.repository.root, scope = report.repository.scope;
    const revision = side === 'before' ? scope === 'unstaged' ? 'index' : scope === 'staged' ? report.repository.head : report.repository.mergeBase
      : scope === 'branch' ? report.repository.head : scope === 'staged' ? 'index' : 'working';
    if (run.source.kind === 'local' && createReport(run.options).snapshot.id !== report.snapshot.id) throw new Error('The local snapshot changed. Start a new review.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(line) || line < 1) throw new Error('Invalid source pagination.');
    const snapshot = run.options.snapshotFile ? loadPrSnapshot(run.options.snapshotFile) : null;
    if (snapshot && snapshot.contentDigest !== report.snapshot.gitDigest) throw new Error('The PR-only source snapshot changed. Start a new review.');
    const files = snapshot ? snapshot.files.map(file => file.path) : (revision === 'working' || revision === 'index' ? git(repo, ['ls-files', '-z']) : git(repo, ['ls-tree', '-r', '--name-only', '-z', revision])).split('\0').filter(Boolean);
    if (operation === 'diff') {
      const changed = report.files.find(item => item.path === file);
      if (!changed) throw new Error('Choose a changed file from this review.');
      const lines = changed.patch.split('\n');
      return { path: file, patch: lines.slice(offset, offset + limit).join('\n'), totalLines: lines.length, nextOffset: offset + limit < lines.length ? offset + limit : null };
    }
    const safeRead = filename => {
      if (filename === '@description') return { content: report.description?.text || '', limitation: null };
      if (!files.includes(filename)) throw new Error(snapshot ? 'PR-only review includes changed files only. Use a local copy for related files.' : 'Choose a tracked file from this review snapshot.');
      if (snapshot) { const file = snapshot.files.find(item => item.path === filename); return { content: file[side], limitation: file.limitation }; }
      if (revision === 'working') {
        const absolute = path.join(repo, filename);
        if (fs.existsSync(absolute)) {
          const relative = path.relative(fs.realpathSync(repo), fs.realpathSync(absolute));
          if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Source path escapes the repository.');
        }
      }
      return readVersion(repo, filename, revision);
    };
    if (operation === 'list') {
      const matches = files.filter(name => !query || name.toLowerCase().includes(query.toLowerCase()));
      return { files: matches.slice(offset, offset + limit), total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null };
    }
    if (operation === 'read') {
      const result = safeRead(file);
      const lines = (result.content || '').split('\n');
      const content = lines.slice(line - 1, line - 1 + limit).map((text, i) => `${line + i}: ${text}`).join('\n');
      return { path: file, side, revision, line, totalLines: lines.length, limitation: result.limitation, truncated: content.length > 64_000,
        content: content.slice(0, 64_000), nextLine: line + limit <= lines.length ? line + limit : null };
    }
    if (operation === 'search') {
      if (!query || query.length > 200) throw new Error('Search needs 1 to 200 characters.');
      const candidates = file ? [file] : files.slice(offset, offset + 100);
      const matches = []; let truncated = false;
      let nextOffset = !file && offset + candidates.length < files.length ? offset + candidates.length : null;
      let nextLine = nextOffset === null ? null : 1;
      for (const [index, filename] of candidates.entries()) {
        const result = safeRead(filename);
        if (result.content === null) continue;
        for (const [i, text] of result.content.split('\n').entries()) {
          if (index === 0 && i + 1 < line) continue;
          if (text.toLowerCase().includes(query.toLowerCase())) {
            if (matches.length >= limit) {
              truncated = true; nextOffset = file ? 0 : offset + index; nextLine = i + 1; break;
            }
            matches.push({ path: filename, line: i + 1, text: text.slice(0, 1000) });
          }
        }
        if (truncated) break;
      }
      return { matches, truncated, nextOffset, nextLine };
    }
    throw new Error('Source operation must be list, read, or search.');
  }
}
