---
name: start
description: >
  Start or resume the Workbench delivery workflow when the user explicitly says
  "use Workbench", "resume Workbench", or invokes /workbench:start. Identify the
  current stage and load just that skill. Do not take over ordinary implementation,
  Jira, debugging or review requests outside an active Workbench task. Route
  requests to explain Workbench commands to help instead of starting work.
---

# Start or resume Workbench

For `board-request REQUEST_ID`, load [the board launch coordinator](../../references/board-launch.md)
and perform only that native chat handoff. Do not execute delivery in the board chat.

For an explicit autopilot-mode request, use [autopilot](../autopilot/SKILL.md), which defines its publication and PR-maintenance scope. Ordinary start does not imply autopilot mode.

For a help-only request, use [help](../help/SKILL.md) and stop there. For a launch-only request, use [run](../run/SKILL.md); it does not require the delivery stages to be complete.

## Invocation

`/workbench:start TICKET`

`TICKET` can be a ticket ID, URL or task description. Select Local or Worktree and the starting state in Codex before submitting. Workbench uses the checkout assigned to this task; it does not provide its own worktree option, directory policy or setup runner. In other hosts, use the provided checkout.

If an older invocation contains the standalone `worktree` keyword before the ticket, explain that selection now belongs to Codex. If this task already runs in the intended native worktree, continue there; otherwise resolve the requested native handoff before editing. Do not create a shell worktree as a compatibility fallback. On resume, reconcile saved paths with the host's current task environment rather than switching back to a stale path.

Read [the shared contract](../../references/workflow.md). Resolve the user's task, current repository and any task note before proposing work. If the user selected a stage explicitly, use it; otherwise choose the earliest incomplete stage that matters to the request.

| Stage | Purpose | Result |
| --- | --- | --- |
| [prepare](../prepare/SKILL.md) | Establish safe workspace and target | Known branch, base, checkout and environment |
| [plan](../plan/SKILL.md) | Reconcile ticket, design and current implementation | Small implementation slice, criteria and dependencies |
| [implement](../implement/SKILL.md) | Build and simplify | Cohesive change with focused checks |
| [verify](../verify/SKILL.md) | Test behavior and integration | Revision-specific evidence and explicit gaps |
| [review](../review/SKILL.md) | Independently assess correctness and reviewer effort | Actionable findings or no findings |
| [publish](../publish/SKILL.md) | Commit, push and create/update draft PR | Verified remote target and draft PR |
| [greenlight](../greenlight/SKILL.md) | Handle review comments, CI and conflicts | Addressed issues with refreshed evidence |

Load only the selected skill, then [specialist routing](../../references/specialists.md) when needed. Do not preload all stages. Preparation and planning scale to the task: a small fix needs a short scope statement, not a design document. Do not repeat completed stages when resuming; invalidate only evidence affected by changed code, base or requirements.

For an implementation request, continue through local implementation, verification and review when authorized. A plan-only or review-only request stops at that scope. Stop only at a genuine missing decision or an external action outside authorization. Starting Workbench alone does not authorize pushing or posting.

Report the selected stage and next action in a few lines. If the user supplied no task and no matching note exists, ask for the ticket or desired outcome. Keep progress updates concise; do not print the entire workflow after every action.

Finish with the **Next-step handoff** defined in the shared contract, choosing the recommendation from the actual result of this stage.
