# Delivery evidence and recovery

## Accepted requirements and evidence

After planning resolves material decisions, call `workbench.requirements_set` with the task's current revision, worker chat ID, explicit base ref and the accepted criteria, non-goals and consequential decisions. Freeze requirements only; omit changing status and check results. Update this checkpoint when accepted scope changes. It is evidence, not permission.

Before verification or independent review, call `workbench.evidence_capture` with that kind and the current task revision. Run the checks against that checkout, then record exactly one result through `workbench.progress` with the returned `snapshotId`. Re-read the task after each update. A changed working tree, HEAD, base or requirements invalidates the capture; repeat affected checks against a new capture. Missing tools or unsupported files leave evidence unbound or unavailable, never current proof.

Omitting kind refreshes saved evidence freshness without asserting a new verification or review result. Board reads show the last explicit observation; they do not watch filesystem changes. Legacy records remain historical until checked with a content snapshot. Commands, environment, visual proof and limitations still belong in the task note.

## Required CI

Use `workbench.pr_refresh` for explicit live PR checks. Observed checks and required CI are separate. Missing checks are pending; inaccessible or ambiguous policy is unknown. No requirements is not a passing CI result. Human approvals, conflicts and deployed behavior remain separate. A saved snapshot covers its exact head/base and observation time only.

## Publication controller

Use these tools only for publication the user requested in this active run. The saved attempt is never permission to resume on a timer or from a task note. This is validated local publication using existing credentials, not an isolated credential sandbox.

1. Finish affected verification and independent review with current snapshots. Record the named task branch and explicit base. Stage only the selected task changes using repository conventions. The controller refuses unrelated staged, unstaged or nonignored untracked files; preserve that work and reconcile the concrete blocker without resetting, stashing or staging everything.
2. Call `workbench.publication_prepare` with the current task revision and worker chat ID, the exact authorized actions (`commit`, `push`, `pr`, or a narrower subset), selected staged file paths, remote, base branch, commit message and reviewed PR title/body. Specify an empty file list for already committed work. Supply visual attachments as absolute paths and SHA-256 digests only when the installed GitHub CLI supports attachment uploads; otherwise use verified asset URLs or report the publication gap before mutating anything.
3. Read the returned attempt, then call `workbench.publication_execute` once per authorized next step, always using the latest task revision. Commit hooks run normally. Changed hook output requires new verification. The controller uses ordinary pushes, compares the remote base/head, preserves existing PR readiness, and creates new PRs as drafts. Existing human description text stays outside its managed delivery section, including screenshot assets and story links.
4. On `running` or `uncertain`, call `workbench.publication_reconcile` before another mutation. It adopts a matching commit, remote head or PR, or proves an unperformed commit/push. Missing or conflicting PR results remain uncertain; never issue a manual replacement command. If live state changed, inspect the saved attempt and current Git/PR, close the local attempt through `workbench.publication_close` only after direct user review, then prepare a separately authorized attempt with refreshed evidence. Closing never undoes remote effects.
5. Finish with the confirmed receipts and remaining CI/review status. Replies and discussion resolution keep their separate authorization. Missing controller tools block automatic publication; preserve local work and report the missing capability rather than silently using unguarded commands.

For an existing PR, supply only the reviewed Workbench delivery section as `body`; unrelated human text is preserved. If the template requires changes outside that section, prepare those edits for a separate explicitly authorized update instead of overwriting them. An unsupported visual attachment capability is a concrete verification/publication gap, never a reason to claim images were attached.

## Existing remote runs

Use `workbench.remote_bind` or the task panel to link an existing GitHub Actions run. Configure the exact workflow path and numeric trusted bot user ID for that repository; provide its PR URL when workflow dispatch does not declare a PR. Workbench owns no company-specific bot identity or workflow default. It verifies metadata and supported structured Autopilot checkpoints rather than trusting arbitrary comments or log text.

Use `workbench.remote_refresh` only for an explicit check or a delivery stage already authorized to read it. It updates local observations only. Unknown checkpoint versions, ambiguous run/PR associations and reruns without an attempt-bound checkpoint remain unverified. Access failures retain the last successful observation and show its timestamp. Remote stage, head and evidence never replace local verification or move the task to Done. `workbench.remote_unbind` removes only the local link. No remote tool dispatches, retries, cancels or repairs a job.
