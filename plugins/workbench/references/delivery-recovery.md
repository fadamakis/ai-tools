# Delivery evidence and recovery

## Accepted requirements and evidence

After planning resolves material decisions, call `workbench.requirements_set` with the task's current revision, worker chat ID, explicit base ref and the accepted criteria, non-goals and consequential decisions. Freeze requirements only; omit changing status and check results. Update this checkpoint when accepted scope changes. It is evidence, not permission.

Before verification or independent review, call `workbench.evidence_capture` with that kind and the current task revision. Run the checks against that checkout, then record exactly one result through `workbench.progress` with the returned `snapshotId`. Re-read the task after each update. A changed working tree, HEAD, base or requirements invalidates the capture; repeat affected checks against a new capture. Missing tools or unsupported files leave evidence unbound or unavailable, never current proof.

Omitting kind refreshes saved evidence freshness without asserting a new verification or review result. Board reads show the last explicit observation; they do not watch filesystem changes. Legacy records remain historical until checked with a content snapshot. Commands, environment, visual proof and limitations still belong in the task note.

## Required CI

Use `workbench.pr_refresh` for explicit live PR checks. Observed checks and required CI are separate. Missing checks are pending; inaccessible or ambiguous policy is unknown. No requirements is not a passing CI result. Human approvals, conflicts and deployed behavior remain separate. A saved snapshot covers its exact head/base and observation time only.
