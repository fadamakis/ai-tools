import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parsePatch } from '../scripts/lib/git.mjs';
import { reviewVerdict } from '../assets/report-model.mjs';
import { commentBody } from '../assets/finding-policy.mjs';
import { CommentPublisher, publicationLock, commentReceipt } from './comments.mjs';
import { atomicJson } from './settings.mjs';
import { digest } from '../scripts/lib/git.mjs';

const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));

export function reviewPayload(report, event, comments, body = '') {
  const findings = report.results.flatMap(result => result.findings);
  const inline = [], general = [];
  for (const selected of comments) {
    const finding = findings.find(item => item.id === selected.findingId);
    if (!finding) throw new Error('A selected finding is not in this saved review.');
    if (typeof selected.draft !== 'string' || !selected.draft.trim() || selected.draft.length > 600) throw new Error('Each comment needs 1 to 600 characters.');
    const anchor = finding.evidence.find(evidence => report.files.some(file => file.path === evidence.path && !file.limitation && parsePatch(file.patch || '').some(line => line.side === evidence.side && line.line === evidence.line)));
    const text = commentBody(finding, selected.draft);
    if (anchor) inline.push({ path: anchor.path, line: anchor.line, side: anchor.side === 'before' ? 'LEFT' : 'RIGHT', body: text });
    else general.push(text);
  }
  return { commit_id: report.source.headSha, event, body: [body.trim() || (event === 'APPROVE' ? 'Reviewed with Shelob.' : 'Review comments from Shelob.'), ...general].join('\n\n---\n\n'), ...(inline.length ? { comments: inline } : {}) };
}

export class ReviewPublisher {
  constructor(store, { clock = Date.now } = {}) { this.store = store; this.clock = clock; this.comments = new CommentPublisher(store); }
  directories(runId) {
    const root = this.store.directory(runId);
    return { actions: path.join(root, 'review-actions'), comments: path.join(root, 'comments') };
  }
  status(runId) {
    const dirs = this.directories(runId), comments = {};
    if (fs.existsSync(dirs.comments)) for (const name of fs.readdirSync(dirs.comments).filter(name => name.endsWith('.json'))) {
      const receipt = read(path.join(dirs.comments, name));
      if (receipt.findingId && receipt.state !== 'draft') comments[receipt.findingId] = { state: receipt.state, url: receipt.result?.url, draft: receipt.draft || receipt.body };
    }
    const approval = path.join(dirs.actions, 'approval.json');
    const discussedDir = path.join(this.store.directory(runId), 'discussed');
    const discussed = fs.existsSync(discussedDir) ? fs.readdirSync(discussedDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => read(path.join(discussedDir, name)).findingId) : [];
    return { comments, ...(discussed.length ? { discussed } : {}), ...(fs.existsSync(approval) ? { approval: read(approval) } : {}) };
  }
  discuss({ runId, snapshotId, findingId, discussed }) {
    const { report } = this.store.get(runId);
    if (!report || report.snapshot.id !== snapshotId) throw new Error('The review snapshot changed. Reload the report before marking a comment.');
    if (!report.results.some(result => result.findings.some(finding => finding.id === findingId))) throw new Error('This finding is not in the saved review.');
    if (typeof discussed !== 'boolean') throw new Error('Choose whether the comment is already discussed.');
    const file = path.join(this.store.directory(runId), 'discussed', `${digest(findingId)}.json`);
    if (discussed) atomicJson(file, { findingId, snapshotId }); else fs.rmSync(file, { force: true });
    return this.status(runId);
  }
  async validate(run, report, event) {
    await this.comments.current(run, report);
    if (event === 'APPROVE' && !['approve', 'notes'].includes(reviewVerdict(report.results, { report, runState: run.state }).state)) throw new Error('Resolve High findings and incomplete checks before approving this PR.');
  }
  ensureAvailable(runId, event, comments) {
    const status = this.status(runId);
    if (comments.some(item => status.comments[item.findingId])) throw new Error('A selected comment was already sent or its delivery is uncertain. Check the PR before sending it again.');
    if (event === 'APPROVE' && status.approval) throw new Error('Approval was already sent or its delivery is uncertain. Check the PR.');
  }
  async preview({ runId, event, comments = [], body = '' }) {
    return publicationLock(this.store, runId, async () => {
      if (!['COMMENT', 'APPROVE'].includes(event) || !Array.isArray(comments) || comments.length > 50 || new Set(comments.map(item => item.findingId)).size !== comments.length) throw new Error('Choose up to 50 distinct comments and a supported review action.');
      if (typeof body !== 'string' || body.length > 2000 || event === 'COMMENT' && !comments.length) throw new Error('Select at least one comment to send.');
      const { run, report } = this.store.get(runId);
      await this.validate(run, report, event);
      this.ensureAvailable(runId, event, comments);
      const payload = reviewPayload(report, event, comments, body);
      const dirs = this.directories(runId); fs.mkdirSync(dirs.actions, { recursive: true, mode: 0o700 });
      const preview = { id: randomUUID(), runId, snapshotId: report.snapshot.id, url: run.source.url, event, comments,
        payload, expiresAt: this.clock() + 5 * 60_000, state: 'draft' };
      atomicJson(path.join(dirs.actions, `${preview.id}.json`), preview);
      return { id: preview.id, runId, url: preview.url, event, count: comments.length, payload, expiresAt: preview.expiresAt };
    });
  }
  async post({ runId, previewId, confirmed }) {
    if (confirmed !== true) throw new Error('Confirm this exact review before sending.');
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(previewId)) throw new Error('Invalid review preview.');
    return publicationLock(this.store, runId, async () => {
      const dirs = this.directories(runId), filename = path.join(dirs.actions, `${previewId}.json`);
      if (!fs.existsSync(filename)) throw new Error('Preview this review before sending.');
      const preview = read(filename);
      if (preview.state === 'posted') return preview.result;
      if (preview.state !== 'draft') throw new Error('Review delivery is uncertain. Check the PR before sending again.');
      if (preview.expiresAt <= this.clock()) throw new Error('This preview expired. Review the batch again.');
      const { run, report } = this.store.get(runId);
      if (report?.snapshot.id !== preview.snapshotId || run.source.url !== preview.url) throw new Error('The review snapshot changed. Preview it again.');
      await this.validate(run, report, preview.event);
      this.ensureAvailable(runId, preview.event, preview.comments);
      fs.mkdirSync(dirs.comments, { recursive: true, mode: 0o700 });
      const persistReceipts = () => {
        for (const item of preview.comments) atomicJson(commentReceipt(dirs.comments, item.findingId), { id: preview.id, findingId: item.findingId, draft: item.draft, state: preview.state, result: preview.result });
        if (preview.event === 'APPROVE') atomicJson(path.join(dirs.actions, 'approval.json'), { state: preview.state, result: preview.result });
      };
      preview.state = 'posting'; atomicJson(filename, preview); persistReceipts();
      try {
        preview.result = await this.store.github.postReview(preview.url, preview.payload);
        preview.state = 'posted'; atomicJson(filename, preview); persistReceipts();
        return preview.result;
      } catch {
        preview.state = 'unknown'; atomicJson(filename, preview); persistReceipts();
        throw new Error('Shelob could not confirm review delivery. Check the PR before sending again; no automatic retry was made.');
      }
    });
  }
}
