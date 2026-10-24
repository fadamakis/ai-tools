---
name: prepare
description: >
  Inspect and prepare the host-selected checkout for a Workbench task. Use for /workbench:prepare
  or when the active Workbench coordinator selects preparation. Inspect dirty Git
  state, target ownership, base and local runtime before changing anything. Do not
  trigger for unrelated Git questions or overwrite an existing checkout.
---

# Prepare the workspace

Read [the shared contract](../../references/workflow.md).

1. Inspect the repository root, applicable instructions, current branch, HEAD, upstream, worktree list and staged, unstaged and untracked files. Identify the task branch and the requested base from live evidence; do not assume the current checkout is the right target.
2. Respect the host-selected starting state. Resolve the task/PR base and fetch relevant refs for comparison without changing the checkout. Fetching is not permission to reset/rebase onto the latest default branch or replace the starting state chosen in Codex. Report stale refs if fetching fails.
3. Use Codex's native checkout and lifecycle:
   - Keep this task in its assigned Local checkout or managed worktree. A native worktree may intentionally be detached; do not treat that as broken or force a branch during preparation.
   - Preserve the selected starting commit and any included local changes. Reuse an appropriate task branch. When a named branch is needed, create it at the current task HEAD after checking ownership/collisions and repository naming; do not silently choose a new base.
   - Use native Handoff for an explicitly requested move. Follow the current tool's restrictions: the calling task may not be able to move itself. In that case direct the user to the native control instead of emulating the move with Git commands. Never create another user-owned task unless explicitly requested.
   - Do not create ad hoc worktrees, pick a competing worktree directory, or change native cleanup/configuration. If dirty work or another task makes the selected checkout unsafe, preserve it and resolve the concrete conflict before editing; recommend native isolation where useful.
4. Inspect the selected native local environment and its project configuration when exposed, including applicable `.codex` setup/actions and `.worktreeinclude` rules. Verify setup completion from available logs and actual prerequisites rather than assuming it ran. Do not duplicate or blindly rerun setup, copy ignored files yourself, or generate alternative worktree hooks/config. Keep secret values out of output. For a genuine setup gap, use the repository's documented remedy within scope; ask before changing the user's native environment configuration. If host configuration/status is unavailable, report that limit and inspect pinned runtimes, package scripts and installed dependencies instead.
5. Record the live host mode, repo/checkout, HEAD (including detached state), branch/base, selected environment when known and setup gaps in the task note. Re-resolve these after a handoff. Preserve hooks, lockfiles, unrelated changes and the existing server setup.

Finish when the target is unambiguous and existing work is preserved. If branch ownership or which dirty files belong to the task cannot be established, ask that specific question and continue independent read-only investigation.

Finish with the **Next-step handoff** defined in the shared contract, choosing the recommendation from the actual result of this stage.

Record the current preview board checkpoint before handing back control, following **Preview board checkpoints** in the shared contract.
