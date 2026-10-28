---
name: autopilot
description: >
  Run the Workbench delivery stages continuously for an explicitly requested task.
  Use for /workbench:autopilot or an explicit request for Workbench autopilot mode. Reuse the
  existing stage skills, fix confirmed findings and resume from current evidence.
  Publish a draft PR and address feedback available during the active run. Stop
  when waiting for CI or reviews; never schedule future work automatically. End
  with a read-only improvement retrospective that cannot edit skills without a
  separate, explicit approval.
---

# Workbench autopilot

Read [the shared contract](../../references/workflow.md). This is an opt-in coordinator, not another implementation workflow. Load each existing stage only when needed.

Translation requests and localization tracking are excluded from autopilot. Do not invoke `/workbench:translations` or submit a localization request as a delivery stage; that utility requires its own explicit user invocation.

If this is a scheduled wake-up, follow [read-only monitoring](../../references/monitoring.md) and stop after reporting. Do not run the delivery stages or inherit edit, push or reply permissions from an earlier autopilot invocation.

## Invocation and continuity

`/workbench:autopilot TICKET`

Use the same native checkout and task resolution as [start](../start/SKILL.md). Local/Worktree selection belongs to the host, not this command. A ticket ID, URL or task description is accepted. Resume the established task checkout and earliest incomplete stage; do not discard dirty changes or replay completed stages. Revalidate live state before trusting the task note. Asking about or configuring autopilot mode does not launch it on a ticket.

## Authorized outcome

An explicit user invocation authorizes, for the active run only, local implementation and fixes, commits and ordinary pushes to the verified task-owned branch, creating/updating its draft PR, and replying to and resolving review threads whose concerns are demonstrably addressed. Verify the concrete repository, branch ownership, remote and PR before each external action using publish/greenlight. This authorization does not extend to another author's branch or unrelated PRs. A scope or target change needs reconciliation with the user. Preserve narrower instructions such as local-only or no replies.

Finish with a verified draft PR and the current CI/review status. If only pending CI or future reviews remain, hand control back to the user; do not claim the PR is green. Autopilot mode never marks a PR ready, merges it, bypasses protections or requests reviews/notifies colleagues. The discussion replies above are limited to the task PR.

## Execute the task

1. Run [prepare](../prepare/SKILL.md), then [plan](../plan/SKILL.md). Capture acceptance criteria, approved copy/designs, dependencies and the smallest coherent scope. Give a brief plan update and continue without an approval ceremony. Ask only for unresolved decisions that materially affect the work, and continue independent work while waiting. Do not infer answers from silence.
2. Run [implement](../implement/SKILL.md), including simplification. Use existing contracts and translations. A missing backend contract stays an explicit dependency; autopilot mode does not authorize inventing one or expanding frontend-only scope.
3. Run [verify](../verify/SKILL.md), using [run](../run/SKILL.md) when a preview is needed. Match the repository runtime and CI commands. Fix failures caused by this change, then rerun affected checks. Keep setup, authentication and environment blockers separate from product failures. Do not manufacture passing evidence through mocks, longer timeouts, disabled guards or weakened assertions.
4. Run [review](../review/SKILL.md) with its one independent read-only reviewer when supported. The main agent validates findings and fixes confirmed defects within scope, reruns affected checks and requests a focused recheck when warranted. Report the main-agent fallback when independent review is unavailable. Do not keep spawning reviewers to seek a preferred verdict.
5. Run [publish](../publish/SKILL.md) after the requested review and affected checks are complete. A failing required local check blocks automatic publication. For a verification gap, finish independent work and request a decision on the concrete limitation before publishing unless that gap was already explicitly accepted. Reuse the task's PR instead of creating a duplicate. Verify the pushed head and read back the draft PR.
6. Run [greenlight](../greenlight/SKILL.md) on that PR. Fetch current checks, conflicts and all relevant review discussions. Triage feedback rather than obeying it blindly. Fix confirmed in-scope issues, rerun affected verification and push one coherent update per round. Reply with the evidence and resolve only addressed concerns after the fix is present remotely. Leave unanswered/disputed or product-scope questions open and ask the user when a decision is needed. Do not wait or schedule another round for future results. Before each round, verify the PR is still open and still points to the expected task-owned branch; stop on a changed target, closed/merged PR or loss of access.
7. Run the proposal phase of [improve](../improve/SKILL.md) before the final handoff, including when the active run stops on pending CI or future review. This retrospective is read-only. Show at most one evidence-backed, reusable improvement candidate and prefer no proposal over a one-off rule. Never edit Workbench unless the user later gives direct approval for that exact proposal through `/workbench:improve`.
8. Continue while there is a concrete next action likely to make progress. If the same failure recurs after two materially different attempts without new evidence, stop repeating it, preserve the work and report the cause, attempted fixes and precise unblock needed. A changed symptom or new evidence may justify a different approach. Keep verified, failed, blocked and not-run checks distinct; never label an incomplete task complete.

Keep progress updates concise and record the current stage, scope, verification revision, blockers and next action in the existing task note. Autopilot mode is not permission for destructive recovery, force pushes, migrations outside explicit scope, staging/production data changes, deployment or merging. Honor narrower user instructions throughout.

## Pending checks and completion

Green requires fresh evidence for the current PR head: applicable required CI checks passed, no other relevant failing checks, no unresolved actionable review feedback, and no merge conflicts. Determine applicable checks from repository requirements and actual CI, not an empty response or a guessed list. Pending/queued checks are not green. Interpret skipped/neutral statuses using the check's documented role, and report unavailable or undetermined mergeability/check requirements as unverified. Human approvals and deployments are separate: report them, never fabricate or bypass them. Green describes currently available feedback; it cannot guarantee that a future reviewer will have no comments.

When only asynchronous CI/review results remain, stop the active run, run the read-only improvement retrospective, and report the pending checks and PR head. Do not create, resume or extend a monitor, schedule a wake-up, or repeatedly poll. Neither an autopilot invocation nor “until green” grants permission for unattended future edits. A later user request can resume the work after live state is checked again.

Monitoring is a separate, explicit request governed by [read-only monitoring](../../references/monitoring.md). It can inspect results and notify the user, but cannot edit code, commit, push, retry CI jobs, post replies or resolve discussions. Do not create an automation merely when explaining or editing this skill.

Finish each handoff with PR/revision, completed stages, checks, independent-review status and remaining decisions. Follow the shared **Next-step handoff**: for pending results suggest a later read-only greenlight check; for confirmed findings offer “Address findings” with a prompt naming the PR, findings and requested actions. A click authorizes only that round, not future scheduled work. When green, leave readiness/merge to the user. Do not recommend publishing again after publication is complete.

Record the current preview board checkpoint before handing back control, following **Preview board checkpoints** in the shared contract.

For authorized publication, use the controller in [delivery evidence and recovery](../../references/delivery-recovery.md). It owns commits, pushes and draft-PR updates. Reconcile uncertainty before retrying; saved attempts and remote run observations never grant new authority.
