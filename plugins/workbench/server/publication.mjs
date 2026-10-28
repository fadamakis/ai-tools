import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, sha256, workspaceSnapshot, sameContent, assertWorker } from './workspace.mjs';
import { gh } from './github.mjs';
import { githubPr } from './pr-observation.mjs';
import { evidenceChecks } from '../shared/evidence.mjs';

const fields = 'url,state,isDraft,headRefOid,headRefName,baseRefName,author,body,title,isCrossRepository';
const openStates = ['prepared', 'running', 'uncertain', 'blocked'];
const marker = '<!-- workbench:delivery:start -->', endMarker = '<!-- workbench:delivery:end -->';
const now = () => new Date().toISOString();
const samePr = (a, b) => !a && !b || Boolean(a && b && ['url', 'body', 'title', 'state', 'isDraft', 'baseRefName', 'headRefName'].every(key => a[key] === b[key]));
const assetUrls = body => [...new Set([...(body || '').matchAll(/https:\/\/(?:github\.com\/user-attachments\/assets\/|user-images\.githubusercontent\.com\/)[^\s)"<>]+/g)].map(match => match[0]))];

function managedBody(original, content) {
  if (content.includes(marker) || content.includes(endMarker)) throw new Error('Supply delivery content without managed-section markers.');
  const section = `${marker}\n${content}\n${endMarker}`;
  if (!original) return section;
  const start = original.indexOf(marker), end = original.indexOf(endMarker);
  if (start < 0 && end < 0) return `${original}\n\n${section}`;
  if (start < 0 || end < start || original.indexOf(marker, start + marker.length) >= 0 || original.indexOf(endMarker, end + endMarker.length) >= 0) throw new Error('The PR has ambiguous Workbench body markers. Reconcile its description first.');
  return original.slice(0, start) + section + original.slice(end + endMarker.length);
}

export async function remoteIdentity(checkout, remote) {
  const value = await git(checkout, 'remote', 'get-url', '--all', '--push', remote);
  if (value.split('\n').length !== 1) throw new Error('Publication requires exactly one push URL for the selected remote.');
  if (await git(checkout, 'remote', 'get-url', '--all', remote) !== value) throw new Error('The fetch and push destinations differ. Reconcile the remote before publication.');
  const match = value.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (!match) throw new Error('Publication requires a canonical GitHub remote without embedded credentials.');
  return match[1];
}

export class Publication {
  constructor(store, { gitRunner = git, ghRunner = gh, identity = remoteIdentity } = {}) {
    this.store = store; this.git = gitRunner; this.gh = ghRunner; this.identity = identity;
  }

  async remoteHead(attempt) {
    const line = await this.git(attempt.checkout, 'ls-remote', '--heads', attempt.remote, `refs/heads/${attempt.branch}`);
    if (!line) return null;
    const parts = line.split(/\s+/);
    if (parts.length !== 2 || !/^[a-f0-9]{40,64}$/.test(parts[0]) || parts[1] !== `refs/heads/${attempt.branch}`) throw new Error('Could not establish the exact remote head.');
    return parts[0];
  }

  async discover(attempt) {
    const prs = JSON.parse(await this.gh(['pr', 'list', '--repo', attempt.repository, '--head', attempt.branch, '--state', 'all', '--json', fields]));
    if (!Array.isArray(prs) || prs.length > 1) throw new Error('The task branch does not identify exactly one PR.');
    const pr = prs[0];
    if (pr && (pr.isCrossRepository || pr.headRefName !== attempt.branch || pr.baseRefName !== attempt.baseBranch || pr.state !== 'OPEN' || pr.author?.login !== attempt.ownerLogin)) throw new Error('PR ownership, state, head or base does not match the task-owned target.');
    if (pr && !githubPr(pr.url).startsWith(`https://github.com/${attempt.repository}/pull/`)) throw new Error('The PR belongs to another repository.');
    return pr;
  }

  async inspect(task, repository, { allowCommit = false, expected } = {}) {
    const snapshot = await workspaceSnapshot(task, repository);
    if (!task.branch || snapshot.branch !== task.branch) throw new Error('Record and verify the named task-owned branch before publication.');
    if (expected && !sameContent(expected, snapshot, { allowCommit })) throw new Error('Publication evidence is stale. Reverify content, base and accepted requirements.');
    for (const kind of ['verify', 'review']) {
      const check = evidenceChecks(task)[kind];
      if (check?.result !== 'passed' || !sameContent(check.snapshot, snapshot, { allowCommit })) throw new Error(`Current content-bound ${kind} evidence is required before publication.`);
    }
    return snapshot;
  }

  async prepare(args) {
    const { task, repository } = this.store.get(args.taskId); assertWorker(task, args);
    if (task.publications?.some(item => openStates.includes(item.state))) throw new Error('Reconcile the existing publication attempt before preparing another.');
    const actions = ['commit', 'push', 'pr'].filter(action => args.actions.includes(action));
    if (!actions.length || new Set(args.actions).size !== args.actions.length || actions.length !== args.actions.length) throw new Error('Choose explicit publication actions.');
    if (!/^[A-Za-z0-9_.-]+$/.test(args.remote || 'origin') || (args.remote || '').startsWith('-')) throw new Error('Use a named Git remote.');
    const snapshot = await this.inspect(task, repository);
    await this.git(task.checkout, 'check-ref-format', `refs/heads/${args.baseBranch}`);
    if (snapshot.branch === args.baseBranch) throw new Error('Publish from a task branch, not its base.');
    if (await this.git(task.checkout, 'diff', '--name-only') || await this.git(task.checkout, 'ls-files', '--others', '--exclude-standard')) throw new Error('Unstaged or untracked files are outside the selected publication. Preserve them and isolate or reconcile the task before publishing.');
    const staged = (await this.git(task.checkout, 'diff', '--cached', '--name-only', '-z')).split('\0').filter(Boolean).sort();
    if (JSON.stringify(staged) !== JSON.stringify([...new Set(args.files || [])].sort())) throw new Error('The staged changes differ from the explicitly selected task files.');
    if (staged.length && !actions.includes('commit')) throw new Error('Commit the selected changes before pushing or publishing a PR.');
    const attempt = { version: 1, id: randomUUID(), taskId: task.id, threadId: args.threadId, checkout: task.checkout, branch: task.branch, baseBranch: args.baseBranch, remote: args.remote || 'origin', snapshot, actions, files: staged, expectedHead: snapshot.head, expectedTree: await this.git(task.checkout, 'write-tree'), message: args.message || '', title: args.title || '', attachments: args.attachments || [], state: 'prepared', completed: [], createdAt: now(), updatedAt: now() };
    if (actions.includes('commit') && staged.length && !attempt.message.trim()) throw new Error('Supply the intended commit message.');
    attempt.repository = await this.identity(task.checkout, attempt.remote);
    if (await this.remoteHead({ ...attempt, branch: attempt.baseBranch }) !== snapshot.base) throw new Error('The remote base moved beyond the tested base. Fetch and reverify before publication.');
    attempt.expectedRemoteHead = await this.remoteHead(attempt);
    if (attempt.expectedRemoteHead) await this.git(task.checkout, 'merge-base', '--is-ancestor', attempt.expectedRemoteHead, snapshot.head);
    if (actions.some(action => action !== 'commit')) {
      const metadata = JSON.parse(await this.gh(['api', `repos/${attempt.repository}`]));
      if (metadata.full_name !== attempt.repository || metadata.permissions?.push !== true) throw new Error('GitHub did not confirm write access to the task repository.');
      const user = JSON.parse(await this.gh(['api', 'user']));
      attempt.ownerLogin = user?.login;
      if (!attempt.ownerLogin) throw new Error('Could not establish the publishing account.');
      attempt.originalPr = await this.discover(attempt) || null;
      if (task.prUrl && attempt.originalPr?.url !== task.prUrl) throw new Error('The task PR does not match the selected branch.');
    }
    if (actions.includes('pr')) {
      if (!attempt.title.trim() || !args.body?.trim()) throw new Error('Supply the reviewed PR title and Markdown body.');
      if (/!\[[^\]]*\]\((?:\/|file:|\.\.?\/)/.test(args.body)) throw new Error('Upload visual evidence first or supply supported attachments; local image paths cannot be published.');
      attempt.body = managedBody(attempt.originalPr?.body, args.body);
      if (Buffer.byteLength(attempt.body) > 65000) throw new Error('The complete PR description exceeds the GitHub limit.');
      for (const attachment of attempt.attachments) this.validateAttachment(attachment);
      if (attempt.attachments.length && !(await this.gh(['pr', attempt.originalPr ? 'edit' : 'create', '--help'])).includes('--attach')) throw new Error('This GitHub CLI cannot attach images. Use a supported CLI or provide already uploaded asset URLs; nothing was published.');
    }
    return this.store.mutate(data => {
      const current = this.store.task(data, task.id); assertWorker(current, args);
      if (current.publications?.some(item => openStates.includes(item.state))) throw new Error('Another publication attempt already exists.');
      current.publications = [...(current.publications || []), attempt]; current.revision++; current.updatedAt = now();
      return { task: current, attempt };
    });
  }

  validateAttachment(attachment) {
    if (!path.isAbsolute(attachment.path)) throw new Error('Visual attachments require absolute paths.');
    const stat = fs.lstatSync(attachment.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024 || sha256(fs.readFileSync(attachment.path)) !== attachment.sha256) throw new Error('A visual attachment is unavailable or changed since verification.');
  }

  selected(args) {
    const detail = this.store.get(args.taskId); assertWorker(detail.task, args);
    const attempt = detail.task.publications?.find(item => item.id === args.attemptId);
    if (!attempt || attempt.threadId !== args.threadId) throw new Error('This worker does not own the publication attempt.');
    return { ...detail, attempt };
  }

  async save(task, attemptId, change) {
    return this.store.mutate(data => {
      const current = this.store.task(data, task.id);
      if (current.revision !== task.revision || current.threadId !== task.threadId) throw new Error('Task changed during publication. Reconcile its saved attempt.');
      const attempt = current.publications.find(item => item.id === attemptId);
      change(attempt, current); attempt.updatedAt = now(); current.updatedAt = now(); current.revision++;
      return { task: current, attempt };
    });
  }

  async validateTarget(task, repository, attempt) {
    if (task.checkout !== attempt.checkout || task.branch !== attempt.branch || await this.identity(task.checkout, attempt.remote) !== attempt.repository) throw new Error('The publication target changed.');
    await this.inspect(task, repository, { expected: attempt.snapshot });
    if (await this.remoteHead({ ...attempt, branch: attempt.baseBranch }) !== attempt.snapshot.base) throw new Error('The remote base changed. Reverify against its current revision.');
  }

  async validateAccount(attempt) {
    if (!attempt.ownerLogin) return;
    const user = JSON.parse(await this.gh(['api', 'user']));
    const repo = JSON.parse(await this.gh(['api', `repos/${attempt.repository}`]));
    if (user.login !== attempt.ownerLogin || repo.full_name !== attempt.repository || repo.permissions?.push !== true) throw new Error('The publishing account or repository permission changed.');
    return this.discover(attempt);
  }

  async execute(args) {
    let { task, repository, attempt } = this.selected(args);
    if (!['prepared'].includes(attempt.state)) throw new Error('Reconcile this publication before executing another step.');
    await this.validateTarget(task, repository, attempt);
    const action = attempt.actions.find(item => !attempt.completed.includes(item));
    if (!action) throw new Error('This publication is already complete.');
    if (await this.remoteHead(attempt) !== attempt.expectedRemoteHead) throw new Error('The remote head advanced. Reconcile and reverify before publication.');
    const currentPr = await this.validateAccount(attempt);
    if (action !== 'commit' && !samePr(currentPr, attempt.originalPr)) throw new Error('The PR changed since preparation. Preserve its edits and prepare a reconciled publication.');
    if (action === 'pr') {
      if (attempt.expectedRemoteHead !== attempt.expectedHead) throw new Error('Push and verify the exact task head before creating or updating its PR.');
      for (const attachment of attempt.attachments) this.validateAttachment(attachment);
    }
    ({ task, attempt } = await this.save(task, attempt.id, record => { record.state = 'running'; record.inFlight = action; }));
    try {
      if (action === 'commit') {
        if (await this.git(task.checkout, 'write-tree') !== attempt.expectedTree) throw new Error('Staged content changed before the commit.');
        if (attempt.files.length) await this.git(task.checkout, 'commit', '-m', attempt.message);
      } else if (action === 'push') {
        await this.git(task.checkout, 'push', '--', attempt.remote, `${attempt.expectedHead}:refs/heads/${attempt.branch}`);
      } else {
        const attach = attempt.attachments.flatMap(item => ['--attach', item.path]);
        await this.gh(attempt.originalPr
          ? ['pr', 'edit', attempt.originalPr.url, '--repo', attempt.repository, '--body-file', '-', ...attach]
          : ['pr', 'create', '--repo', attempt.repository, '--head', attempt.branch, '--base', attempt.baseBranch, '--draft', '--title', attempt.title, '--body-file', '-', ...attach], { cwd: task.checkout, input: attempt.body });
      }
      return await this.reconcile({ ...args, expectedRevision: task.revision });
    } catch (error) {
      return this.save(task, attempt.id, record => { record.state = 'uncertain'; record.error = `${action} did not produce a verified receipt. Reconcile before retrying.`; });
    }
  }

  async reconcile(args) {
    const { task, repository, attempt } = this.selected(args);
    if (!attempt.inFlight || !['running', 'uncertain', 'blocked'].includes(attempt.state)) return { task, attempt };
    if (task.checkout !== attempt.checkout || task.branch !== attempt.branch || await this.identity(task.checkout, attempt.remote) !== attempt.repository) throw new Error('The publication target changed; retained evidence was preserved.');
    const action = attempt.inFlight;
    let result, snapshot, retry = false, reason;
    try {
      if (action !== 'commit') await this.validateAccount(attempt);
      if (action === 'commit') {
        const head = await this.git(task.checkout, 'rev-parse', 'HEAD');
        if (head === attempt.expectedHead) {
          if (!attempt.files.length) { result = head; snapshot = await this.inspect(task, repository); }
          else if (await this.git(task.checkout, 'write-tree') === attempt.expectedTree && sameContent(attempt.snapshot, await workspaceSnapshot(task, repository))) retry = true;
        } else if (await this.git(task.checkout, 'rev-parse', 'HEAD^') === attempt.expectedHead && await this.git(task.checkout, 'show', '-s', '--format=%T', 'HEAD') === attempt.expectedTree && (await this.git(task.checkout, 'show', '-s', '--format=%B', 'HEAD')).trim() === attempt.message.trim()) {
          snapshot = await this.inspect(task, repository, { allowCommit: true, expected: attempt.snapshot }); result = head;
        }
      } else if (action === 'push') {
        await this.validateTarget(task, repository, attempt);
        const remote = await this.remoteHead(attempt);
        if (remote === attempt.expectedHead) result = remote;
        else if (remote === attempt.expectedRemoteHead) retry = true;
      } else {
        await this.validateTarget(task, repository, attempt);
        const pr = await this.discover(attempt);
        const containsBody = attempt.attachments.length ? pr?.body?.includes(attempt.body) : pr?.body === attempt.body;
        if (pr && pr.headRefOid === attempt.expectedHead && containsBody && (attempt.originalPr ? pr.isDraft === attempt.originalPr.isDraft && pr.title === attempt.originalPr.title : pr.isDraft === true && pr.title === attempt.title)) {
          const assets = assetUrls(pr.body), existing = new Set([...assetUrls(attempt.originalPr?.body), ...assetUrls(attempt.body)]);
          if (attempt.attachments.length && assets.filter(url => !existing.has(url)).length < attempt.attachments.length) throw new Error('New visual attachments were not confirmed in PR readback.');
          result = { url: pr.url, assets };
        }
      }
    } catch { reason = 'The target or result could not be verified. Preserve the attempt and inspect it before retrying.'; }
    return this.save(task, attempt.id, (record, current) => {
      if (result !== undefined) {
        record.receipts = { ...record.receipts, [action]: { result, checkedAt: now() } };
        record.completed.push(action); delete record.inFlight; delete record.error;
        record.state = record.completed.length === record.actions.length ? 'complete' : 'prepared';
        if (action === 'commit') {
          record.expectedHead = result; record.snapshot = snapshot; current.head = result; current.workspace = { status: 'available', snapshot };
          for (const check of Object.values(current.evidenceChecks || {})) if (sameContent(check.snapshot, snapshot, { allowCommit: true })) { check.originalHead ??= check.head; check.head = result; check.snapshot = { ...check.snapshot, head: result }; }
          if (current.evidence && Object.values(current.evidenceChecks || {}).every(check => check.head === result)) current.evidence.head = result;
        }
        if (action === 'push') record.expectedRemoteHead = result;
        if (action === 'pr') current.prUrl = result.url;
      } else if (retry) { record.state = 'prepared'; delete record.inFlight; record.error = 'The prior mutation was not performed; an explicitly authorized next step may retry it.'; }
      else { record.state = 'uncertain'; record.error = reason || 'The observed result differs from the intended operation. No automatic retry is allowed.'; }
    });
  }

  async close(args) {
    const { task, attempt } = this.selected(args);
    if (!args.confirmedReviewed) throw new Error('Review the retained outcome before closing this local publication attempt.');
    if (attempt.state === 'running') throw new Error('Do not close an operation that may still be running. Reconcile it first.');
    return this.save(task, attempt.id, record => { record.state = 'closed'; record.closedAt = now(); });
  }
}
