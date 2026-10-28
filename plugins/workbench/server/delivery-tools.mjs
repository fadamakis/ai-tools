export function registerDeliveryTools(register, z, store) {
  const id = z.string().uuid();
  const worker = { taskId: id, expectedRevision: z.number().int().positive(), threadId: id };
  const attempt = { ...worker, attemptId: id };
  register('workbench.publication_prepare', 'Prepare only the publication actions explicitly requested for this task and worker. Requires current content-bound verification and review. Does not commit, push or create a PR. Read references/delivery-recovery.md first.',
    z.object({ ...worker, actions: z.array(z.enum(['commit', 'push', 'pr'])).min(1).max(3), files: z.array(z.string().min(1).max(4096)).max(2000), remote: z.string().min(1).max(100).default('origin'), baseBranch: z.string().min(1).max(500), message: z.string().max(10000).optional(), title: z.string().max(500).optional(), body: z.string().max(60000).optional(), attachments: z.array(z.object({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(30).optional() }).strict(), args => store.publication.prepare(args), { readOnly: false, openWorld: true });
  register('workbench.publication_execute', 'Execute the next explicitly authorized commit, ordinary push or draft-PR step for the exact prepared target. Saved attempts do not grant authorization. Reconcile uncertainty before retrying. Never merges or marks ready.',
    z.object(attempt).strict(), args => store.publication.execute(args), { readOnly: false, openWorld: true });
  register('workbench.publication_reconcile', 'Read Git and GitHub to reconcile an interrupted publication. May save an exact receipt or prove an unperformed step; never commits, pushes, creates or updates a PR.',
    z.object(attempt).strict(), args => store.publication.reconcile(args), { readOnly: false, openWorld: true });
  register('workbench.publication_close', 'Close a local publication attempt only after the user reviews its outcome. Preserves all receipts and never rolls back Git or GitHub. Does not authorize another publication.',
    z.object({ ...attempt, confirmedReviewed: z.literal(true) }).strict(), args => store.publication.close(args), { readOnly: false });
  const remote = { taskId: id, expectedRevision: z.number().int().positive() };
  register('workbench.remote_bind', 'Link an existing GitHub Actions run after an explicit user request. Configure its workflow and trusted bot ID. Reads GitHub and saves only local observations; never launches or resumes work.',
    z.object({ ...remote, runUrl: z.string().url(), workflowPath: z.string().min(1).max(500), botId: z.number().int().positive(), prUrl: z.string().url().optional() }).strict(), args => store.remoteRuns.bind(args), { readOnly: false, openWorld: true });
  register('workbench.remote_refresh', 'Explicitly read a linked remote run and save its timestamped observation. Never dispatches, retries, cancels or repairs a run; remote results never replace local verification.',
    z.object(remote).strict(), args => store.remoteRuns.refresh(args), { readOnly: false, openWorld: true });
  register('workbench.remote_unbind', 'Remove only the local link to a remote run. Does not modify GitHub, task progress, local evidence or chat ownership.',
    z.object(remote).strict(), args => store.remoteRuns.unbind(args), { readOnly: false });
}
