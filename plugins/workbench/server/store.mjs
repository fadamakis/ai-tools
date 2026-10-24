import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { taskNotes } from './repository-import.mjs';
import { BoardPersistence } from './persistence.mjs';
import { LaunchLifecycle } from './launches.mjs';
export { taskKey } from './launches.mjs';
import { normalizeTaskEvidence, updateEvidence } from '../shared/evidence.mjs';
import { unresolvedLaunchStates } from '../shared/launch-states.mjs';
import { githubPr, readPr } from './pr-observation.mjs';
export { githubPr, readPr } from './pr-observation.mjs';

export const columns = ['backlog', 'plan', 'build', 'verify', 'review', 'pr', 'done'];
export const stageColumn = { prepare: 'plan', plan: 'plan', implement: 'build', verify: 'verify', review: 'review', publish: 'pr', greenlight: 'pr' };
const now = () => new Date().toISOString();
const digest = value => createHash('sha256').update(value).digest('hex');
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const defaultDataRoot = () => process.env.WORKBENCH_PREVIEW_DATA_DIR || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support/Workbench Preview' : '.local/share/workbench-preview');


function checkedNote(filename) {
  if (!filename || !fs.existsSync(filename)) return '';
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) throw new Error('Task note must be a regular Markdown file under 512 KiB.');
  return fs.readFileSync(filename, 'utf8');
}

export class BoardStore {
  constructor({ root = defaultDataRoot(), prReader = readPr } = {}) {
    this.root = path.resolve(root); this.prReader = prReader;
    this.persistence = new BoardPersistence(this.root);
    this.filename = this.persistence.filename;
    this.lockfile = this.persistence.lockfile;
    this.launches = new LaunchLifecycle(this);
  }

  read() { const data = this.persistence.read(); return { ...data, tasks: data.tasks.map(normalizeTaskEvidence) }; }
  mutate(callback) { return this.persistence.mutate(callback); }

  repository(data, id) {
    const repository = data.repositories.find(item => item.id === id);
    if (!repository) throw new Error('Add this repository to Workbench Preview first.');
    return repository;
  }

  task(data, id) {
    const task = data.tasks.find(item => item.id === id);
    if (!task) throw new Error('This task is not on the preview board.');
    return task;
  }

  paths(repository, key) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(key)) throw new Error('Invalid task key.');
    return { notePath: path.join(repository.commonDir, 'workbench-preview', `${key}.md`), legacyNotePath: path.join(repository.commonDir, 'workbench', `${key}.md`) };
  }

  makeTask(data, repositoryId, key, title) {
    const existing = data.tasks.find(item => item.repositoryId === repositoryId && item.key === key);
    if (existing) return existing;
    const repository = this.repository(data, repositoryId);
    const task = { id: randomUUID(), repositoryId, key, title, stage: 'backlog', status: 'paused', revision: 1, createdAt: now(), updatedAt: now(), nextAction: 'Start Workbench', ...this.paths(repository, key) };
    data.tasks.push(task); return task;
  }

  async addRepository(requestedPath, importExisting = true) {
    const expanded = requestedPath.startsWith('~/') ? path.join(os.homedir(), requestedPath.slice(2)) : requestedPath;
    if (!path.isAbsolute(expanded)) throw new Error('Enter an absolute repository path.');
    let checkout, commonDir;
    try {
      if (!fs.statSync(expanded).isDirectory()) throw new Error('Choose a folder containing a Git repository.');
      checkout = fs.realpathSync(git(expanded, 'rev-parse', '--show-toplevel'));
      commonDir = fs.realpathSync(path.resolve(checkout, git(checkout, 'rev-parse', '--git-common-dir')));
    } catch (cause) {
      const message = cause.code === 'ENOENT' ? 'That folder is unavailable. Choose another folder.' : cause.code === 'EACCES' || cause.code === 'EPERM' ? 'Workbench cannot access that folder. Choose an accessible repository.' : 'That folder is not a Git repository. Choose a repository folder.';
      throw Object.assign(new Error(message), { details: String(cause.stderr || cause.message).trim() });
    }
    const id = digest(commonDir).slice(0, 24);
    const notes = importExisting ? taskNotes(commonDir).map(({ key, filename }) => ({ key, note: checkedNote(filename) })) : [];
    return this.mutate(data => {
      let repository = data.repositories.find(item => item.id === id);
      if (!repository) {
        repository = { id, name: path.basename(checkout), path: checkout, commonDir, addedAt: now() };
        data.repositories.push(repository);
      }
      let imported = 0;
      if (importExisting) {
        for (const { key, note } of notes) {
          if (data.tasks.some(item => item.repositoryId === id && item.key === key)) continue;
          const task = this.makeTask(data, id, key, key);
          task.status = 'unverified'; task.nextAction = 'Reconcile the imported note with current code and PR state.';
          task.importedAt = now();
          const pr = note.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/)?.[0];
          if (pr) { task.prUrl = githubPr(pr); task.stage = 'pr'; task.nextAction = 'Check the current pull request state.'; }
          imported++;
        }
      }
      return { repository, imported };
    });
  }

  async reconcileImported(repositoryId) {
    const data = this.read();
    const pending = data.tasks.filter(task => task.repositoryId === repositoryId && task.importedAt && task.status === 'unverified' && task.prUrl && !task.pr && !task.workbenchStage && !task.threadId && !data.launches.some(launch => launch.taskId === task.id && unresolvedLaunchStates.includes(launch.state)));
    let checked = 0;
    const deadline = Date.now() + 45000;
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length && Date.now() < deadline) {
        const task = pending.shift();
        try {
          const pr = await this.prReader(task.prUrl);
          await this.savePr(task, pr); checked++;
        } catch {
          // Import remains useful offline. Keep historical evidence unverified
          // and preserve any checkpoint recorded while GitHub was being read.
          await this.mutate(current => {
            const saved = this.task(current, task.id);
            if (saved.revision === task.revision) {
              saved.importCheck = { checkedAt: now(), error: 'The linked PR could not be verified for this task. Use Check PR now to retry.' };
              saved.nextAction = saved.importCheck.error;
              saved.revision++;
            }
          });
        }
      }
    }));
    return { checked, unverified: this.read().tasks.filter(task => task.repositoryId === repositoryId && task.importedAt && task.status === 'unverified').length };
  }

  list() {
    const data = this.read();
    return { repositories: data.repositories, tasks: [...data.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), launches: data.launches.filter(item => unresolvedLaunchStates.includes(item.state) || item.state === 'failed'), preview: true };
  }

  async archiveTasks(tasks, archived = true) {
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > 500 || new Set(tasks.map(task => task.taskId)).size !== tasks.length) throw new Error('Choose a unique selection of up to 500 completed tasks.');
    return this.mutate(data => {
      const selected = tasks.map(({ taskId, expectedRevision }) => {
        const task = this.task(data, taskId);
        if (task.revision !== expectedRevision) throw new Error('A task changed. Refresh the board before archiving or restoring it.');
        if (task.stage !== 'done' || task.pr?.state !== 'MERGED' || !task.pr.mergedAt) throw new Error('Only tasks with a verified merge can be archived or restored.');
        return task;
      });
      for (const task of selected) {
        if (archived) task.archivedAt ??= now();
        else delete task.archivedAt;
        task.revision++;
      }
      return { tasks: selected, archived };
    });
  }

  async associate(session, taskId) {
    return this.mutate(data => { this.task(data, taskId); data.sessions ??= {}; data.sessions[digest(session)] = taskId; });
  }

  currentSession(session) {
    return typeof session === 'string' ? this.read().sessions?.[digest(session)] : undefined;
  }

  get(id) {
    const data = this.read(), task = this.task(data, id), repository = this.repository(data, task.repositoryId);
    return { task, repository, note: checkedNote(task.notePath) || checkedNote(task.legacyNotePath), noteIsLegacy: !fs.existsSync(task.notePath), launches: data.launches.filter(item => item.taskId === id) };
  }

  async register({ repositoryId, key, title, threadId, checkout, requestId }) {
    const resolved = fs.realpathSync(path.resolve(checkout, git(checkout, 'rev-parse', '--git-common-dir')));
    return this.mutate(data => {
      const repository = this.repository(data, repositoryId);
      if (resolved !== repository.commonDir) throw new Error('The current native checkout belongs to another repository.');
      const task = this.makeTask(data, repositoryId, key, title);
      this.launches.bindWorker(data, task, threadId, requestId);
      task.checkout = checkout; task.updatedAt = now(); task.revision++;
      return task;
    });
  }

  async progress({ taskId, expectedRevision, stage, status, summary, nextAction, branch, head, prUrl, threadId, evidence }) {
    return this.mutate(data => {
      const task = this.task(data, taskId);
      if (task.revision !== expectedRevision) throw new Error('Task changed in another chat. Read it again before updating.');
      if (!stageColumn[stage]) throw new Error('Use a Workbench delivery stage. Done requires a verified merge.');
      if (task.stage === 'done') throw new Error('This task is merged. Start a separate task for further work.');
      if (threadId && task.threadId && threadId !== task.threadId) throw new Error('This task belongs to another chat. Use an explicit continuation launch first.');
      if (prUrl) task.prUrl = githubPr(prUrl);
      Object.assign(task, { stage: stageColumn[stage], workbenchStage: stage, status, summary, nextAction, updatedAt: now(), revision: task.revision + 1 });
      for (const [key, value] of Object.entries({ branch, head, threadId })) if (value !== undefined) task[key] = value;
      if (evidence) updateEvidence(task, evidence);
      this.launches.acceptCheckpoint(data, task, threadId);
      return task;
    });
  }

  async refreshPr(taskId) {
    const task = this.get(taskId).task;
    if (!task.prUrl) throw new Error('This task has no pull request yet.');
    const pr = await this.prReader(task.prUrl);
    return this.savePr(task, pr);
  }

  async savePr(task, pr) {
    if (githubPr(pr.url) !== task.prUrl || !/^[a-f0-9]{40,64}$/.test(pr.headRefOid || '') || !['OPEN', 'CLOSED', 'MERGED'].includes(pr.state)) throw new Error('GitHub returned incomplete or mismatched PR evidence.');
    // Notes can contain dependency PRs. An untouched imported ticket needs its
    // own ticket identifier in live PR evidence before it can be reconciled.
    if (task.importedAt && !task.workbenchStage && /^[A-Z][A-Z0-9]+-\d+$/.test(task.key) && !new RegExp(`\\b${task.key}\\b`, 'i').test(pr.title || '')) throw new Error('The linked PR does not identify this task. Check the task note before continuing.');
    return this.mutate(data => {
      const current = this.task(data, task.id);
      if (current.revision !== task.revision) throw new Error('Task changed during the GitHub check. Refresh again.');
      const checks = pr.statusCheckRollup || [];
      const outcomes = checks.map(check => check.conclusion || check.state || check.status);
      const failed = outcomes.some(value => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(value));
      const pending = outcomes.some(value => !['SUCCESS', 'NEUTRAL', 'SKIPPED', 'FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(value));
      current.pr = { state: pr.state, mergedAt: pr.mergedAt || null, head: pr.headRefOid, reviewDecision: pr.reviewDecision || 'UNKNOWN', mergeable: pr.mergeable || 'UNKNOWN', checks: failed ? 'failed' : pending ? 'pending' : outcomes.includes('SUCCESS') ? 'passed' : 'unverified', checkCount: checks.length, checkedAt: now() };
      current.stage = pr.state === 'MERGED' && pr.mergedAt ? 'done' : 'pr';
      current.status = current.stage === 'done' ? 'complete' : pr.state === 'CLOSED' ? 'paused' : failed ? 'blocked' : 'waiting';
      current.nextAction = current.stage === 'done' ? 'Pull request merged. No further action.' : pr.state === 'CLOSED' ? 'Review the closed pull request before resuming.' : failed ? 'Address the failed pull request checks.' : 'Check pending CI and review feedback.';
      if (current.importedAt && current.title === current.key && pr.title) current.title = pr.title;
      if (current.importedAt && !current.branch && pr.headRefName) current.branch = pr.headRefName;
      delete current.importCheck;
      current.updatedAt = now(); current.revision++;
      return current;
    });
  }

  prepareLaunch(args) { return this.launches.prepareLaunch(args); }
  launchGet(id) { return this.launches.launchGet(id); }
  claimLaunch(id) { return this.launches.claimLaunch(id); }
  finishLaunch(args) { return this.launches.finishLaunch(args); }
  deliveryUncertain(id) { return this.launches.deliveryUncertain(id); }
  resolveLaunch(args) { return this.launches.resolveLaunch(args); }
}
