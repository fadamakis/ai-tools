import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { BoardStore } from '../server/store.mjs';

export const threadId = '12345678-1234-4123-8123-123456789abc';
export const otherThread = '22345678-1234-4123-8123-123456789abc';
export function fixture({ legacy = true, prReader } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-preview-test-'));
  const repo = path.join(directory, 'project'); fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main'); fs.writeFileSync(path.join(repo, 'readme.txt'), 'fixture\n'); git('add', 'readme.txt');
  git('-c', 'user.name=Workbench Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
  const legacyNote = path.join(repo, '.git/workbench/EX-123.md');
  if (legacy) { fs.mkdirSync(path.dirname(legacyNote), { recursive: true }); fs.writeFileSync(legacyNote, '# Workbench EX-123\n\nOld evidence, not current authorization.\nhttps://github.com/example/repository/pull/123\n'); }
  const root = path.join(directory, 'data'); const store = new BoardStore({ root, prReader });
  return { directory, repo, root, store, legacyNote, git, cleanup: () => fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) };
}
export async function registered(sample, key = 'EX-123', id = threadId) {
  const { repository } = (await sample.store.addRepository(sample.repo, true));
  return (await sample.store.register({ repositoryId: repository.id, key, title: key, threadId: id, checkout: sample.repo }));
}
export async function checkpoint(store, task, values = {}) {
  return (await store.progress({ taskId: task.id, expectedRevision: task.revision, stage: 'implement', status: 'paused', summary: 'Focused implementation complete.', nextAction: 'Verify behavior.', threadId, ...values }));
}
export async function seedBoard(sample) {
  const { repository } = (await sample.store.addRepository(sample.repo, false));
  const rows = [
    ['WEB-104', 'Clarify the first-run setup', 'plan', 'paused', 'Scope agreed. Ready for the smallest useful slice.'],
    ['WEB-108', 'Keep filters when switching tabs', 'implement', 'active', 'Preserving the selected filters across navigation.'],
    ['WEB-112', 'Show a useful empty state', 'verify', 'blocked', 'Waiting for the seeded staging account.'],
    ['WEB-115', 'Make the review summary easier to scan', 'review', 'paused', 'Behavior checks passed. Independent review is next.'],
    ['WEB-118', 'Fix keyboard navigation in the editor', 'greenlight', 'waiting', 'Draft PR published. Waiting for CI and review.'],
  ];
  for (const [key, title, stage, status, summary] of rows) {
    const id = randomUUID();
    let task = (await sample.store.register({ repositoryId: repository.id, key, title, threadId: id, checkout: sample.repo }));
    task = (await checkpoint(sample.store, task, { stage, status, summary, nextAction: status === 'blocked' ? 'Make the test account available, then rerun verification.' : 'Resume the next incomplete Workbench stage.', threadId: id, branch: key.toLowerCase(), ...(stage === 'greenlight' ? { prUrl: 'https://github.com/example/repository/pull/118' } : {}), evidence: { verify: stage === 'review' ? 'passed' : 'unverified', review: 'unverified', checkedAt: new Date().toISOString() } }));
    fs.mkdirSync(path.dirname(task.notePath), { recursive: true });
    fs.writeFileSync(task.notePath, `# ${title}\n\n## Scope\n\nA disposable preview task. No company repository is used.\n\n## Decisions\n\nKeep the change focused and preserve existing behavior.\n\n## Evidence\n\n${summary}\n\n## Remaining work\n\n${task.nextAction}\n`);
  }
  (await sample.store.mutate(data => sample.store.makeTask(data, repository.id, 'WEB-121', 'Add a clearer save confirmation')));
  let merged = (await sample.store.register({ repositoryId: repository.id, key: 'WEB-101', title: 'Improve the invitation confirmation', threadId: randomUUID(), checkout: sample.repo }));
  merged = (await checkpoint(sample.store, merged, { stage: 'greenlight', threadId: merged.threadId, prUrl: 'https://github.com/example/repository/pull/117', summary: 'Pull request merged.', nextAction: 'Complete.' }));
  (await sample.store.refreshPr(merged.id));
  return repository;
}
