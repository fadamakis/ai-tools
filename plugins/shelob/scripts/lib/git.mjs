import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const digest = value => createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 1024 * 1024;

export function git(repo, args, { optional = false, binary = false } = {}) {
  try {
    return execFileSync(process.env.SHELOB_GIT || 'git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '--literal-pathspecs', '-C', repo, ...args], {
      encoding: binary ? undefined : 'utf8', maxBuffer: 16 * MAX_BYTES,
      timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (error) {
    if (optional && error.status !== undefined) return null;
    const detail = error.code === 'ENOENT' ? 'Git was not found. Install Git or set SHELOB_GIT to an installed executable.'
      : String(error.stderr || error.message).trim();
    throw new Error(`Unable to read Git state: ${detail}`);
  }
}

export function parsePatch(patch) {
  let before = 0, after = 0, inHunk = false;
  const lines = [];
  for (const raw of patch.split('\n')) {
    const header = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) { before = Number(header[1]); after = Number(header[2]); inHunk = true; continue; }
    if (!inHunk || raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) lines.push({ side: 'after', line: after++, text: raw.slice(1) });
    else if (raw.startsWith('-')) lines.push({ side: 'before', line: before++, text: raw.slice(1) });
    else if (raw.startsWith(' ')) { before++; after++; }
  }
  return lines;
}

export function readVersion(repo, file, revision) {
  let buffer;
  if (revision === 'working') {
    const absolute = path.join(repo, file);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) return { content: '', limitation: null };
    if (stat.isSymbolicLink() || !stat.isFile()) return { content: null, limitation: 'Shelob skips symlinks and special files.' };
    if (stat.size > MAX_BYTES) return { content: null, limitation: 'This file exceeds the 1 MiB scan limit.' };
    buffer = fs.readFileSync(absolute);
  } else {
    const spec = revision === 'index' ? `:${file}` : `${revision}:${file}`;
    const size = git(repo, ['cat-file', '-s', spec], { optional: true });
    if (size === null) return { content: '', limitation: null };
    if (Number(size.trim()) > MAX_BYTES) return { content: null, limitation: 'This file exceeds the 1 MiB scan limit.' };
    buffer = git(repo, ['show', spec], { binary: true });
  }
  if (buffer.includes(0)) return { content: null, limitation: 'Binary file. Shelob did not read its contents.' };
  return { content: buffer.toString('utf8'), limitation: null };
}

export function collectRepository({ repo = process.cwd(), scope = 'all', base } = {}) {
  if (!['all', 'branch', 'staged', 'unstaged'].includes(scope)) throw new Error('Scope must be all, branch, staged, or unstaged.');
  const root = fs.realpathSync(git(path.resolve(repo), ['rev-parse', '--show-toplevel']).trim());
  const head = git(root, ['rev-parse', '--verify', 'HEAD'], { optional: true })?.trim();
  if (!head) throw new Error('This repository has no HEAD commit. Create an initial commit before reviewing it.');
  let baseCommit = null, mergeBase = null, baseName = base || null;
  if (scope === 'all' || scope === 'branch') {
    if (!baseName) {
      baseName = git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { optional: true })?.trim();
      if (!baseName) baseName = ['main', 'master'].find(ref => git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { optional: true }));
    }
    if (!baseName) throw new Error('Cannot infer a base branch. Supply --base with a local branch or commit. No fetch is performed.');
    baseCommit = git(root, ['rev-parse', '--verify', '--end-of-options', `${baseName}^{commit}`], { optional: true })?.trim();
    if (!baseCommit) throw new Error(`Base ${JSON.stringify(baseName)} is not a local commit. Supply --base with an existing reference.`);
    mergeBase = git(root, ['merge-base', baseCommit, head], { optional: true })?.trim();
    if (!mergeBase) throw new Error('Base and HEAD have no common ancestor. Choose a related local base.');
  }
  const range = scope === 'branch' ? [mergeBase, head] : scope === 'staged' ? ['--cached', head] : scope === 'unstaged' ? [] : [mergeBase];
  const diffFlags = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color'];
  const numstat = git(root, [...diffFlags, '--numstat', '-z', ...range, '--']);
  const entries = numstat.split('\0').filter(Boolean).map(record => {
    const match = record.match(/^([^\t]+)\t([^\t]+)\t([\s\S]+)$/);
    if (!match) throw new Error('Git returned an unrecognized diff record.');
    return { path: match[3], added: match[1] === '-' ? 0 : Number(match[1]), deleted: match[2] === '-' ? 0 : Number(match[2]), binary: match[1] === '-' };
  });
  if (entries.length > 200) throw new Error('This diff exceeds the 200-file review budget. Choose a smaller change or a narrower scope.');
  const files = entries.map(entry => {
    const patch = git(root, [...diffFlags, '--unified=3', ...range, '--', entry.path]);
    const before = patch.includes('--- /dev/null') ? { content: '', limitation: null }
      : readVersion(root, entry.path, scope === 'unstaged' ? 'index' : scope === 'staged' ? head : mergeBase);
    const after = patch.includes('+++ /dev/null') ? { content: '', limitation: null }
      : readVersion(root, entry.path, scope === 'staged' ? 'index' : scope === 'branch' ? head : 'working');
    return { ...entry, patch, lines: parsePatch(patch), before: before.content, after: after.content, limitation: before.limitation || after.limitation };
  });
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const branch = git(root, ['symbolic-ref', '--short', '--quiet', 'HEAD'], { optional: true })?.trim() || '(detached HEAD)';
  const context = { root, name: path.basename(root), branch, head, base: baseName, baseCommit, mergeBase, scope, untracked,
    added: files.reduce((n, file) => n + file.added, 0), deleted: files.reduce((n, file) => n + file.deleted, 0) };
  const contentDigest = digest(JSON.stringify({ head, baseCommit, mergeBase, scope, untracked, files: files.map(f => [f.path, f.patch]) }));
  return { context, files, contentDigest };
}

export function assertOutsideRepository(destination, repo) {
  const absolute = path.resolve(destination);
  let ancestor = absolute;
  const suffix = [];
  while (!fs.existsSync(ancestor)) { suffix.unshift(path.basename(ancestor)); const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent; }
  const resolved = path.join(fs.realpathSync(ancestor), ...suffix);
  const relative = path.relative(fs.realpathSync(repo), resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Report output must be outside the reviewed repository, including through symlinks.');
  }
  return resolved;
}
