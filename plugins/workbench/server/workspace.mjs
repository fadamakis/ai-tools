import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export async function git(cwd, ...args) {
  const { stdout } = await promisify(execFile)('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return stdout.trimEnd();
}

async function inventory(checkout) {
  return [...new Set((await git(checkout, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')).split('\0').filter(Boolean))].sort();
}

export async function workspaceSnapshot(task, repository) {
  if (!task.requirements?.digest || !task.baseRef) throw new Error('Record accepted requirements and an explicit base ref before capturing evidence.');
  const checkout = fs.realpathSync(task.checkout);
  const commonDir = fs.realpathSync(path.resolve(checkout, await git(checkout, 'rev-parse', '--git-common-dir')));
  if (commonDir !== repository.commonDir) throw new Error('The assigned checkout belongs to another repository.');
  const head = await git(checkout, 'rev-parse', '--verify', 'HEAD');
  const branch = await git(checkout, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => null);
  const base = await git(checkout, 'rev-parse', '--verify', `${task.baseRef}^{commit}`);
  const files = await inventory(checkout), hash = createHash('sha256');
  for (const name of files) {
    const filename = path.resolve(checkout, name);
    if (!filename.startsWith(checkout + path.sep) || name.split('/').includes('.git')) throw new Error('Unsupported workspace path.');
    // Refuse symlink parents, including paths introduced by a concurrent filesystem edit.
    for (let parent = path.dirname(filename); parent !== checkout; parent = path.dirname(parent)) {
      try { if (fs.lstatSync(parent).isSymbolicLink()) throw new Error('A workspace parent is a symlink.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let stat;
    try { stat = fs.lstatSync(filename, { bigint: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const mode = stat ? stat.isSymbolicLink() ? 'link' : String(stat.mode & 0o111n) : 'deleted';
    const content = createHash('sha256');
    if (!stat) { hash.update(JSON.stringify([name, mode]) + '\n'); continue; }
    if (stat.isSymbolicLink()) content.update(fs.readlinkSync(filename));
    else if (stat.isFile()) {
      const handle = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const before = await handle.stat({ bigint: true });
        if (before.ino !== stat.ino || before.dev !== stat.dev) throw new Error('Workspace changed during capture.');
        for await (const chunk of handle.createReadStream({ autoClose: false })) content.update(chunk);
        const after = await handle.stat({ bigint: true });
        if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('Workspace changed during capture.');
      } finally { await handle.close(); }
    } else throw new Error('Submodules and special files require separate verification; evidence is unavailable.');
    const after = fs.lstatSync(filename, { bigint: true });
    if (after.ino !== stat.ino || after.mode !== stat.mode || after.ctimeNs !== stat.ctimeNs) throw new Error('Workspace changed during capture.');
    hash.update(JSON.stringify([name, mode, content.digest('hex')]) + '\n');
  }
  if (JSON.stringify(files) !== JSON.stringify(await inventory(checkout)) || head !== await git(checkout, 'rev-parse', 'HEAD') || base !== await git(checkout, 'rev-parse', `${task.baseRef}^{commit}`)) throw new Error('Workspace changed during capture.');
  return { version: 1, repositoryId: repository.id, checkout, branch, head, base, tree: hash.digest('hex'), requirementsDigest: task.requirements.digest, checkedAt: new Date().toISOString() };
}

export function sameContent(a, b, { allowCommit = false } = {}) {
  return Boolean(a && b && a.version === 1 && b.version === 1 && ['repositoryId', 'checkout', 'branch', 'base', 'tree', 'requirementsDigest', ...(allowCommit ? [] : ['head'])].every(key => a[key] === b[key]));
}

export function assertWorker(task, { expectedRevision, threadId }) {
  if (task.revision !== expectedRevision) throw new Error('Task changed. Read it again before continuing.');
  if (!threadId || task.threadId !== threadId) throw new Error('This task belongs to another worker chat.');
  if (task.stage === 'done' || task.archivedAt) throw new Error('This task is merged or archived.');
}
