import { randomUUID } from 'node:crypto';
import { assertWorker, sha256, workspaceSnapshot, sameContent } from './workspace.mjs';

export class TaskEvidence {
  constructor(store) { this.store = store; }

  async requirements(args) {
    const content = args.content.trim();
    if (!content || content.length > 64000 || !args.baseRef || args.baseRef.startsWith('-')) throw new Error('Supply accepted requirements and an explicit Git base ref.');
    return this.store.mutate(data => {
      const task = this.store.task(data, args.taskId); assertWorker(task, args);
      const digest = sha256(content);
      if (task.baseRef && task.baseRef !== args.baseRef) task.workspace = { status: 'unavailable', reason: 'The verification base changed. Capture fresh evidence.' };
      task.requirements = { version: 1, revision: (task.requirements?.revision || 0) + (task.requirements?.digest === digest ? 0 : 1), digest, content };
      task.baseRef = args.baseRef; task.updatedAt = new Date().toISOString(); task.revision++;
      return task;
    });
  }

  async capture(args) {
    const { task, repository } = this.store.get(args.taskId); assertWorker(task, args);
    let snapshot, error;
    try { snapshot = { ...await workspaceSnapshot(task, repository), id: randomUUID(), ...(args.kind ? { kind: args.kind } : {}) }; }
    catch (cause) { error = cause.message; }
    return this.store.mutate(data => {
      const current = this.store.task(data, task.id); assertWorker(current, args);
      current.workspace = snapshot ? { status: 'available', snapshot } : { status: 'unavailable', reason: error, checkedAt: new Date().toISOString() };
      if (snapshot && args.kind) current.evidenceSnapshots = { ...current.evidenceSnapshots, [args.kind]: snapshot };
      if (snapshot) current.head = snapshot.head;
      current.revision++; current.updatedAt = new Date().toISOString();
      return { task: current, snapshot, ...(error ? { error } : {}) };
    });
  }

  async validate(task, evidence) {
    if (!evidence.snapshotId) return undefined;
    const kinds = ['verify', 'review'].filter(kind => evidence[kind] !== undefined);
    if (kinds.length !== 1) throw new Error('Record one evidence kind per captured snapshot.');
    const snapshot = task.evidenceSnapshots?.[kinds[0]];
    if (!snapshot || snapshot.id !== evidence.snapshotId) throw new Error('The evidence snapshot is absent or superseded. Capture it before checking.');
    const { repository } = this.store.get(task.id);
    const live = await workspaceSnapshot(task, repository);
    if (!sameContent(snapshot, live)) throw new Error('Evidence is stale: content, base, checkout, HEAD or accepted requirements changed. Recheck the affected behavior.');
    return { ...evidence, head: snapshot.head, snapshot, checkedAt: new Date().toISOString() };
  }
}
