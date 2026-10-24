import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { commentBody } from '../assets/finding-policy.mjs';

export async function publicationLock(store, runId, callback, message = 'A GitHub action is already being posted. Check the PR before retrying.') {
  const filename = path.join(store.directory(runId), '.github-posting');
  try { fs.writeFileSync(filename, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch { throw new Error(message); }
  try { return await callback(); } finally { fs.rmSync(filename, { force: true }); }
}

export const commentReceipt = (directory, findingId) => path.join(directory, `${findingId.replace(/[^a-zA-Z0-9-]/g, '_')}.json`);

export class CommentPublisher {
  constructor(store, { clock = Date.now } = {}) { this.store = store; this.clock = clock; }
  async current(run, report) {
    if (run.state !== 'complete' || run.source.kind !== 'github_pr' || report?.freshness?.status !== 'current') throw new Error('Finish a current PR review before posting a comment.');
    const latest = await this.store.github.metadata(run.source.url);
    if (latest.source.headSha !== run.source.headSha || latest.source.baseSha !== run.source.baseSha || latest.description !== (report.description?.text || '')) throw new Error('The PR changed. Review the new snapshot before posting.');
  }
  async preview({ runId, findingId, draft }) {
    return publicationLock(this.store, runId, () => this.previewLocked({ runId, findingId, draft }), 'This comment is already being prepared or posted.');
  }
  async previewLocked({ runId, findingId, draft }) {
    const { run, report } = this.store.get(runId);
    await this.current(run, report);
    const finding = report.results.flatMap(result => result.findings).find(item => item.id === findingId);
    if (!finding) throw new Error('This finding is not in the saved review.');
    if (draft !== undefined && (typeof draft !== 'string' || !draft.trim() || draft.length > 600)) throw new Error('Use a comment of 1 to 600 characters.');
    const directory = path.join(this.store.directory(runId), 'comments');
    fs.mkdirSync(directory, { mode: 0o700, recursive: true });
    const preview = { id: randomUUID(), runId, findingId, snapshotId: report.snapshot.id, url: run.source.url,
      body: commentBody(finding, draft), expiresAt: this.clock() + 5 * 60_000, state: 'draft' };
    // One receipt per finding/snapshot prevents duplicate clicks and repeat drafts.
    const filename = commentReceipt(directory, finding.id);
    const lock = `${filename}.posting`;
    try { fs.writeFileSync(lock, preview.id, { flag: 'wx', mode: 0o600 }); }
    catch { throw new Error('This comment is already being prepared or posted.'); }
    try {
    if (fs.existsSync(filename)) {
      const previous = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (previous.state === 'posted') throw new Error(`This finding was already posted: ${previous.result.url}`);
      if (previous.state === 'posting' || previous.state === 'unknown') throw new Error('Check this PR for the previous comment before posting again. Its delivery could not be confirmed.');
    }
    const temporary = `${filename}.${randomUUID()}`;
    fs.writeFileSync(temporary, JSON.stringify(preview), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, filename);
    } finally { fs.rmSync(lock, { force: true }); }
    return { id: preview.id, runId, url: preview.url, body: preview.body, expiresAt: preview.expiresAt };
  }
  async post({ runId, previewId, confirmed }) {
    return publicationLock(this.store, runId, () => this.postLocked({ runId, previewId, confirmed }));
  }
  async postLocked({ runId, previewId, confirmed }) {
    if (confirmed !== true) throw new Error('Confirm the exact PR and comment before posting.');
    const directory = path.join(this.store.directory(runId), 'comments');
    const filename = fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => path.join(directory, name))
      .find(file => JSON.parse(fs.readFileSync(file, 'utf8')).id === previewId);
    if (!filename) throw new Error('Comment preview was replaced or is unavailable. Preview it again.');
    const lock = `${filename}.posting`;
    try { fs.writeFileSync(lock, previewId, { flag: 'wx', mode: 0o600 }); }
    catch { throw new Error('This comment is already being posted. Check the PR before retrying.'); }
    try {
      const preview = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (preview.id !== previewId) throw new Error('This preview was replaced. Preview the comment again.');
      if (preview.state === 'posted') return preview.result;
      if (preview.state !== 'draft') throw new Error('Comment delivery is uncertain. Check the PR before trying again.');
      if (preview.expiresAt <= this.clock()) throw new Error('This preview expired. Preview the comment again.');
      const { run, report } = this.store.get(runId);
      if (report?.snapshot.id !== preview.snapshotId) throw new Error('The review snapshot changed. Preview the comment again.');
      await this.current(run, report);
      preview.state = 'posting'; fs.writeFileSync(filename, JSON.stringify(preview), { mode: 0o600 });
      try {
        preview.result = await this.store.github.postComment(preview.url, preview.body);
        preview.state = 'posted'; fs.writeFileSync(filename, JSON.stringify(preview), { mode: 0o600 });
        return preview.result;
      } catch {
        preview.state = 'unknown'; fs.writeFileSync(filename, JSON.stringify(preview), { mode: 0o600 });
        throw new Error('Shelob could not confirm comment delivery. Check the PR before posting again.');
      }
    } finally { fs.rmSync(lock, { force: true }); }
  }
}
