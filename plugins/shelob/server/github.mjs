import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { parsePatch } from '../scripts/lib/git.mjs';

export async function command(program, args, options = {}) {
  try {
    const { input, ...settings } = options;
    return await new Promise((resolve, reject) => {
      const child = execFile(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 300_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...settings }, (error, stdout) => error ? reject(error) : resolve(stdout));
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  } catch (error) {
    // Commands can include credential helper diagnostics; never echo their stderr.
    const operation = args.find(arg => ['api', 'init', 'fetch', 'merge-base', 'rev-parse', 'update-ref'].includes(arg)) || args[0];
    throw new Error(`${program} ${operation} failed${error.code === 'ENOENT' ? ': executable not found' : error.killed ? ': timed out' : '. Check access and authentication (gh auth status)'}.`);
  }
}

export function parsePrUrl(value) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !match
      || ['.', '..'].includes(match[1]) || ['.', '..'].includes(match[2]) || !Number.isSafeInteger(Number(match[3]))) {
    throw new Error('Enter a GitHub PR URL such as https://github.com/owner/repository/pull/123.');
  }
  return { repository: `${match[1]}/${match[2]}`, number: Number(match[3]), url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` };
}

export class GitHubSource {
  constructor(runCommand = command) { this.command = runCommand; }
  async postReview(url, payload) {
    const pr = parsePrUrl(url);
    const result = JSON.parse(await this.command('gh', ['api', '--method', 'POST', `repos/${pr.repository}/pulls/${pr.number}/reviews`, '--input', '-'], { input: JSON.stringify(payload), timeout: 30_000 }));
    if (!Number.isSafeInteger(result.id) || !String(result.html_url).startsWith(`${pr.url}#pullrequestreview-`) || result.commit_id !== payload.commit_id || result.state !== (payload.event === 'APPROVE' ? 'APPROVED' : 'COMMENTED')) throw new Error('GitHub did not confirm the submitted review.');
    return { id: result.id, url: result.html_url, state: result.state };
  }
  async postComment(url, body) {
    const pr = parsePrUrl(url);
    const result = JSON.parse(await this.command('gh', ['api', '--method', 'POST', `repos/${pr.repository}/issues/${pr.number}/comments`, '--input', '-'], { input: JSON.stringify({ body }), timeout: 30_000 }));
    if (!Number.isSafeInteger(result.id) || !String(result.html_url).startsWith(`${pr.url}#issuecomment-`)) throw new Error('GitHub did not confirm the posted comment.');
    return { id: result.id, url: result.html_url };
  }
  async metadata(url) {
    const pr = parsePrUrl(url);
    const raw = await this.command('gh', ['api', `repos/${pr.repository}/pulls/${pr.number}`]);
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('GitHub returned an invalid PR response.'); }
    if (!/^[a-f0-9]{40}$/.test(data.head?.sha) || !/^[a-f0-9]{40}$/.test(data.base?.sha)
        || data.base?.repo?.full_name?.toLowerCase() !== pr.repository.toLowerCase()) throw new Error('GitHub returned incomplete PR commit information.');
    if (Buffer.byteLength(data.body || '') > 256 * 1024) throw new Error('The PR description exceeds the 256 KiB review limit.');
    return { source: { kind: 'github_pr', ...pr, title: String(data.title || ''), author: String(data.user?.login || 'Unknown'),
      baseRef: String(data.base.ref), headRef: String(data.head.ref), baseSha: data.base.sha, headSha: data.head.sha }, description: data.body || '',
      changedFiles: data.changed_files, headRepository: data.head.repo?.full_name || pr.repository };
  }
  async preparePrOnly(url, destination) {
    const metadata = await this.metadata(url), { source } = metadata;
    if (!Number.isInteger(metadata.changedFiles) || metadata.changedFiles < 0) throw new Error('GitHub did not return the complete changed-file count.');
    if (metadata.changedFiles > 200) throw new Error('This diff exceeds the 200-file review budget.');
    const api = async endpoint => JSON.parse(await this.command('gh', ['api', endpoint]));
    const comparison = await api(`repos/${source.repository}/compare/${source.baseSha}...${source.headSha}?per_page=1`);
    const mergeBase = comparison.merge_base_commit?.sha;
    if (!/^[a-f0-9]{40}$/.test(mergeBase || '') || !Array.isArray(comparison.files) || comparison.files.length !== metadata.changedFiles) throw new Error('GitHub returned an incomplete PR diff. Try a local copy.');
    const trees = new Map();
    const tree = (repository, sha) => {
      const key = `${repository}:${sha}`;
      if (!trees.has(key)) trees.set(key, api(`repos/${repository}/git/trees/${sha}`));
      return trees.get(key);
    };
    let bytes = 0;
    const read = async (repository, revision, filename) => {
      try {
        let sha = revision;
        const parts = filename.split('/');
        for (const [index, part] of parts.entries()) {
          const listing = await tree(repository, sha);
          if (listing.truncated || !Array.isArray(listing.tree)) throw new Error();
          const entry = listing.tree.find(item => item.path === part);
          if (!entry || !/^[a-f0-9]{40}$/.test(entry.sha)) throw new Error();
          if (index < parts.length - 1) { if (entry.type !== 'tree') throw new Error(); sha = entry.sha; continue; }
          if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) return { content: null, limitation: 'Shelob skips symlinks and special files.' };
          if (entry.size > 1024 * 1024) return { content: null, limitation: 'This file exceeds the 1 MiB scan limit.' };
          const blob = await api(`repos/${repository}/git/blobs/${entry.sha}`);
          if (blob.encoding !== 'base64' || blob.sha !== entry.sha || blob.size > 1024 * 1024) throw new Error();
          const buffer = Buffer.from(blob.content, 'base64'); bytes += buffer.length;
          if (bytes > 16 * 1024 * 1024) throw new Error('budget');
          if (buffer.length !== blob.size) throw new Error();
          if (buffer.includes(0)) return { content: null, binary: true, limitation: 'Binary file. Shelob did not read its contents.' };
          return { content: buffer.toString('utf8'), limitation: null };
        }
      } catch (error) {
        if (error.message === 'budget') throw new Error('PR-only source exceeds the 16 MiB review budget. Try a local copy.');
        return { content: null, limitation: 'GitHub source could not be read at the reviewed commit. Try a local copy.' };
      }
    };
    const entries = comparison.files;
    for (const file of entries) {
      if (typeof file.filename !== 'string' || !file.filename || file.filename.startsWith('/') || file.filename.split('/').some(part => ['.', '..', ''].includes(part)) || file.filename.includes('\0')) throw new Error('GitHub returned an invalid source path.');
      if (file.previous_filename && (file.previous_filename.startsWith('/') || file.previous_filename.split('/').includes('..'))) throw new Error('GitHub returned an invalid previous path.');
      if (!['added', 'removed', 'modified', 'renamed', 'copied', 'changed'].includes(file.status) || !Number.isInteger(file.additions) || file.additions < 0 || !Number.isInteger(file.deletions) || file.deletions < 0) throw new Error('GitHub returned incomplete changed-file metadata.');
    }
    const files = new Array(entries.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (next < entries.length) {
        const index = next++, file = entries[index];
        const before = file.status === 'added' || file.status === 'copied' ? { content: '', limitation: null } : await read(source.repository, mergeBase, file.previous_filename || file.filename);
        const after = file.status === 'removed' ? { content: '', limitation: null } : await read(metadata.headRepository, source.headSha, file.filename);
        const patch = file.patch || '', lines = parsePatch(patch);
        const patchComplete = lines.filter(line => line.side === 'after').length === file.additions && lines.filter(line => line.side === 'before').length === file.deletions;
        let limitation = before.limitation || after.limitation;
        if (!patchComplete) limitation = [limitation, 'GitHub did not provide the complete file diff. Try a local copy.'].filter(Boolean).join(' ');
        // Reject inconsistent source lines, including snapshots GitHub could not supply.
        if (!limitation && lines.some(line => (line.side === 'after' ? after.content : before.content)?.split('\n')[line.line - 1] !== line.text)) limitation = 'GitHub diff and source do not match. Try a local copy.';
        files[index] = { path: file.filename, added: file.additions, deleted: file.deletions, binary: Boolean(before.binary || after.binary), patch,
          before: before.content, after: after.content, limitation, ...(file.previous_filename ? { previousPath: file.previous_filename } : {}) };
      }
    }));
    const current = await this.metadata(url);
    if (current.source.headSha !== source.headSha || current.source.baseSha !== source.baseSha || current.description !== metadata.description) throw new Error('The PR changed while reading it. Start a fresh review.');
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
    const snapshotFile = path.join(destination, 'snapshot.json');
    const context = { root: destination, name: source.repository, branch: source.headRef, head: source.headSha, base: source.baseRef, baseCommit: source.baseSha,
      mergeBase, scope: 'branch', untracked: [], added: files.reduce((n, file) => n + file.added, 0), deleted: files.reduce((n, file) => n + file.deleted, 0) };
    await fs.writeFile(snapshotFile, JSON.stringify({ format: 1, context, files }), { flag: 'wx', mode: 0o600 });
    return { ...metadata, source: { ...source, reviewMode: 'pr_only' }, repo: destination, snapshotFile };
  }
  async prepare(url, destination) {
    const metadata = await this.metadata(url);
    const { source } = metadata;
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
    const settings = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false',
      '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
      GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TEMPLATE_DIR: '' };
    const git = args => this.command(process.env.SHELOB_GIT || 'git', [...settings, '-C', destination, ...args], { env });
    await git(['init', '-b', 'shelob-review']);
    // GitHub exposes fork heads through the base repository's pull refs. No checkout,
    // merge ref, depth limit, project hooks, submodules, or filters are involved.
    await git(['fetch', '--no-tags', '--no-recurse-submodules', `https://github.com/${source.repository}.git`,
      `${source.baseSha}:refs/shelob/base`, `refs/pull/${source.number}/head:refs/shelob/head`]);
    const fetchedHead = (await git(['rev-parse', 'refs/shelob/head'])).trim();
    if (fetchedHead !== source.headSha) throw new Error('The PR changed while fetching. Start a fresh review.');
    if ((await git(['rev-parse', '--is-shallow-repository'])).trim() !== 'false') throw new Error('The PR history is incomplete. Shelob will not review a truncated diff.');
    await git(['merge-base', source.baseSha, source.headSha]);
    await git(['update-ref', 'refs/heads/shelob-review', source.headSha]);
    return { ...metadata, source: { ...source, reviewMode: 'local_copy' }, repo: destination };
  }
}
