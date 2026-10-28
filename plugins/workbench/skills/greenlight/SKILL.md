---
name: greenlight
description: >
  Maintain an existing Workbench PR by triaging review comments, diagnosing CI
  failures and resolving conflicts. Use for /workbench:greenlight or an explicit
  Workbench PR-maintenance request. Make authorized local fixes and refresh evidence;
  push, reply and resolve discussions only when those actions are authorized.
---

# Greenlight the PR

Read [the shared contract](../../references/workflow.md). Resolve the exact PR and worktree; use [specialists](../../references/specialists.md) only within the requested scope.

If this is a scheduled wake-up or an explicit monitoring request, use [read-only monitoring](../../references/monitoring.md) instead of the repair steps below. A timer never inherits earlier permission to edit, push, reply or resolve discussions.

1. Fetch the latest PR head/base, author, reviews, unresolved threads, checks and mergeability. Inspect local dirty state and current remote head. Fetch all relevant pages of comments; a partial result is not a complete triage.
2. Classify each unresolved item as a confirmed defect, clarification, already addressed, duplicate or outside agreed scope. Read the current implementation and existing replies before deciding. Separate reviewer preferences from correctness; do not blindly implement every human or AI suggestion.
3. Group related findings by underlying mechanism and remedy, not just file or author. Keep the mapping from each comment to its group and disposition. For each confirmed group, trace the cause, sweep the task diff and directly related callers for the same defect, and fix the group coherently before moving on. Do not turn that sweep into unrelated cleanup. Use [regression proof](../../references/regression-proof.md) for reproducible bugs when practical. Independent comments can remain separate. For CI, inspect the failing command and logs rather than guessing from the job title. For conflicts, verify the intended base and follow repository history conventions; do not rewrite a published branch or change its PR base without the necessary authorization.
4. Preserve earlier decisions such as frontend-only scope and accepted backend dependencies. If a comment changes product behavior or requires an unknown API contract, explain the concrete decision needed; continue other fixes meanwhile.
5. Before pushing, re-read each group against every comment it addresses and the plan's Acceptance proof table. Run affected checks after fixes and base integration. Review the final diff for accidental conflict artifacts, duplicated copy, stale comments and unrelated edits. Refresh the task note and verification evidence.
6. Finish the actionable groups and their verification before one push per review round when authorized; do not push separately for every comment. Keep unrelated changes in separate coherent commits when useful. If pushing was authorized for this exact target, follow [publish](../publish/SKILL.md) within that scope. If replying/resolving was authorized, post concise evidence-backed replies and resolve only threads whose concerns are actually addressed. Do not claim a local-only fix is pushed; do not resolve disputed or unanswered questions. Read back external actions before reporting success.

Return a compact summary: PR/revision, addressed items, remaining decisions, check results and whether changes are local or pushed. When no action is authorized beyond review, provide triage and draft replies only. Stop when only pending results remain; do not create a watcher or poll unchanged CI. Separate, explicit monitoring requests follow the read-only monitoring contract. When called during an explicitly invoked [autopilot](../autopilot/SKILL.md) run, use its verified target and active-run authorization; standalone greenlight keeps its narrower default scope. After a monitoring handoff, require an explicit user request for the next fix round. Name the PR and findings in the suggested action, and state whether it includes pushing, replies and resolution. Displaying the suggestion or receiving a timer event is not approval.

Finish with the **Next-step handoff** defined in the shared contract, choosing the recommendation from the actual result of this stage.

Record the current preview board checkpoint before handing back control, following **Preview board checkpoints** in the shared contract.

Use Workbench PR refresh to distinguish observed checks from required CI. Treat missing checks as pending and unresolved policy as unknown; neither establishes green status.
