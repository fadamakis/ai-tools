export function registerReconciliationTools(register, z, store) {
  const source = {
    sourceUrl: z.string().url().max(4096), sourceEventId: z.string().min(1).max(200), sourceEventAt: z.string().datetime(), observedAt: z.string().datetime(),
    taskKey: z.string().min(1).max(100), threadId: z.string().uuid()
  };
  register('workbench.reconcile', 'Check saved delivery state and recover local checkpoints from verified evidence. Bounded, serialized and throttled; force checks now. Reads linked GitHub PRs only. Jira and worker observations require connected tools through observation_record. Never starts workers, retries external writes, publishes, approves or merges.',
    z.object({ taskId: z.string().uuid().optional(), force: z.boolean().default(false) }).strict(), args => store.reconciliation.check(args), { readOnly: false, openWorld: true });
  register('workbench.observation_record', 'Record freshly checked Jira, exact worker and artifact evidence for one task. Read the sources with connected tools first. Jira closure alone cannot complete delivery. Non-PR completion requires a completed worker, accepted scope and passed artifact verification with no pending review. Preserve user pauses and uncertainty; pauseResolution is only for a proven orchestration pause. Does not authorize or execute any external action.',
    z.object({
      taskId: z.string().uuid(), expectedRevision: z.number().int().positive(),
      issue: z.object({ ...source, state: z.enum(['open', 'closed']), summary: z.string().min(1).max(4000) }).strict().optional(),
      worker: z.object({ ...source, state: z.enum(['running', 'completed', 'failed', 'blocked', 'waiting']), pendingReview: z.boolean(), summary: z.string().min(1).max(4000) }).strict().optional(),
      pullRequest: z.object({ ...source, url: z.string().url().max(4096) }).strict().optional(),
      coverage: z.object({ ...source, requirementsDigest: z.string().regex(/^[a-f0-9]{64}$/), deliverables: z.array(z.object({ kind: z.enum(['pr', 'artifact']), url: z.string().url().max(4096) }).strict()).min(1).max(5), remaining: z.array(z.string().min(1).max(2000)).max(20) }).strict().optional(),
      completion: z.object({ ...source, artifactUrl: z.string().url().max(4096), artifactDigest: z.string().regex(/^[a-f0-9]{64}$/), scopeDigest: z.string().regex(/^[a-f0-9]{64}$/), allScopeComplete: z.literal(true), pendingReview: z.literal(false), verification: z.object({ ...source, artifactUrl: z.string().url().max(4096), artifactDigest: z.string().regex(/^[a-f0-9]{64}$/), scopeDigest: z.string().regex(/^[a-f0-9]{64}$/), result: z.literal('passed'), summary: z.string().min(1).max(4000) }).strict() }).strict().optional(),
      pauseResolution: z.object({ ...source, kind: z.literal('orchestration'), originalPauseEventId: z.string().min(1).max(200), previousUpdatedAt: z.string().datetime(), reason: z.string().min(1).max(4000) }).strict().optional()
    }).strict(), args => store.reconciliation.observe(args), { readOnly: false, openWorld: true });
}
