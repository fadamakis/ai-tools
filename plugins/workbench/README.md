# Workbench

A team delivery workflow that coordinates the skills you already use. Start with a ticket, resume an existing task, or jump directly to one stage.

| Command | What it does |
| --- | --- |
| `/workbench:help` | Explain the commands and when to use each stage |
| `/workbench:start` | Pick up the task at the right stage |
| `/workbench:autopilot` | Deliver a draft PR; stop when waiting for CI or reviews |
| `/workbench:prepare` | Check the native checkout, task branch and configured setup |
| `/workbench:plan` | Reconcile ticket, design, code and dependencies |
| `/workbench:implement` | Build a small change with clear ownership and an easy-to-follow diff |
| `/workbench:run` | Start the app or Storybook from the task checkout |
| `/workbench:verify` | Check behavior, real UI and CI-compatible validation |
| `/workbench:review` | Get an independent subagent review of correctness and reviewability |
| `/workbench:publish` | Commit, push and create/update the identified task's draft PR |
| `/workbench:greenlight` | Address comments, CI failures and conflicts |
| `/workbench:translations` | Follow the repository's localization process and verify requested languages |
| `/workbench:improve` | Review one Workbench improvement proposal and apply it only after explicit approval |

Install `workbench@ai-tools` using [getting started](https://github.com/fadamakis/ai-tools/blob/main/docs/getting-started.md), then use the explicit `/workbench:` commands or choose a stage from the native picker.

Reviewability shapes `implement` before coding: choose a small responsibility map, keep the main flow easy to trace, and justify every new layer. Small, cohesive components and presentational UI are encouraged, including one-use components that improve readability. Code should need no explanatory comments except for crucial non-obvious constraints. Simplification and a final reading of the actual diff are required before handoff; moving a large hook into scattered helpers does not count. `greenlight` replaces the vague “follow-up” stage. Verification and PR maintenance do not imply permission to push, post replies, resolve discussions or merge; include the desired actions in your request. Existing authorization for the same target remains valid within its scope; scheduled checks cannot inherit permission to make changes.

Choose Local or Worktree, its starting state and local environment in Codex, then use `/workbench:start TICKET`. `TICKET` can be an ID, URL or task description. Workbench respects the host-selected checkout, setup and actions. Use native Handoff to move an existing task. There is no Workbench worktree option or separate worktree setup policy.

`run` is an optional utility at any stage: use `/workbench:run app` or `/workbench:run storybook`. It discovers the repository launch command, reuses only matching servers, handles port conflicts and leaves the preview running with its URL and stop instructions. Launching is separate from verifying behavior.

`translations` is an explicit-only utility: use `/workbench:translations PR_URL` or an issue/feature. It discovers the target repository localization process, reuses existing requests, verifies requested languages, and tracks the result when required. Missing conventions produce a draft and a concrete setup question; no company-specific command, project, or field is assumed. It is outside autopilot, publish, and greenlight.

## Autopilot mode

Use `/workbench:autopilot TICKET` to continue through prepare, plan, implement/simplify, verify, independent review, publish and greenlight. It reuses the same skills and resumes incomplete work. It uses the native task environment, just like start.

Invoking autopilot authorizes commits, ordinary pushes, a draft PR, and replies/resolution for addressed review threads on the verified task-owned PR during the active run. It pauses for material missing decisions, access or unaccepted verification gaps, and never merges or marks ready. Narrower user instructions still apply.

When only pending CI or future reviews remain, autopilot stops and hands back the PR with the current results. It never schedules future work automatically, including for an “until green” request.

Before its final handoff, autopilot runs a read-only improvement retrospective. It proposes at most one narrow, reusable change when the run provides concrete evidence, and produces no proposal for one-off product or environment details. It never edits Workbench during delivery. `/workbench:improve` applies only the exact proposal you explicitly approve, validates the maintained source, and then synchronizes the active installed copy.

You can separately ask for read-only monitoring, for example: “Watch this PR every ten minutes for up to two hours. Notify me when there is something to address.” Monitoring expires after at most two hours and allows at most 12 scheduled checks. It stops earlier on actionable feedback, green checks, a closed PR or a blocker. It cannot edit, push, retry CI, reply or resolve discussions. An “Address findings” suggestion lets you explicitly request one fix round; the prompt states which remote actions are included. See [monitoring limits](references/monitoring.md).

## Example requests

- `/workbench:autopilot TASK-123`
- `/workbench:improve` after approving a named proposal from a completed run
- “Use Workbench to implement this ticket. Keep the PR frontend-only.”
- “Use Workbench to review this diff and suggest how to make it smaller.”
- “Use Workbench to maintain this PR: fix the comments and failed tests locally.”
- “Push the verified changes to this task's branch, then reply to and resolve the addressed discussions.”

For multi-stage work, one local task note records scope, decisions, dependencies and evidence under the repository's Git metadata. No feature README or workflow scaffolding is added to the source diff. On resume, the agent checks live state before trusting the note.

## How it fits

The [shared contract](references/workflow.md) contains the common rules. [Specialist routing](references/specialists.md) explains when to use existing skills and when overlapping end-to-end workflows would conflict. Each stage remains independently invocable.

The package has no hooks, bundled background jobs or new external services. Read-only monitoring uses the host’s existing automation feature only when separately requested and only when the host can enforce a finite schedule. It uses the tools and repository conventions already available in the task. Installation does not change your existing skills.

Inspired by the ticket-to-PR iteration used to build Learner Plan Selection and [pstack](https://flaviocopes.com/pstack/). Workbench treats 800 changed lines as a hard reviewability limit: reassess the slice at 600 and stop at 800 to propose independently deployable stacked PRs. Frontend and backend changes stay in separate PRs by default.

When more work remains, each skill ends with one clickable next-step suggestion in supported hosts such as Codex. Click to request that action, or type a different direction. The suggestion adapts to failures, blockers and completed work; displaying it does not execute it. Hosts without clickable follow-ups use a written command. Autopilot continues already authorized stages without asking you to click each one.

The review stage uses one read-only reviewer with the requirements and current diff in a separate context. The main agent validates findings, makes authorized fixes and reruns affected checks. If subagents are unavailable, it reports the limitation and reviews locally. Other stages remain with the main agent.

## Evidence built into the workflow

- `plan` maps requirements to user actions and expected results before implementation.
- For visual changes, `implement` captures an available baseline, `verify` saves reviewed Before/After screenshots, and `publish` puts them in the PR’s Visual changes table using the GitHub CLI. Image uploads require `gh` 2.99+ with `--attach` support. Publication confirms each attachment in the final PR body and reports missing images or access.
- `verify` records relevant new/changed and existing Storybook stories. `publish` adds direct PR preview links for reviewers without waiting for the Storybook build, distinguishing local proof from pending or unverified deployment.
- `verify` reuses an application recipe for launch, health/build checks, real interactions, evidence and cleanup. Use the target repository’s maintained application recipe or the [recipe template](assets/verification-recipe.md).
- `implement` and `greenlight` prove a reproducible bug fails before the fix and passes afterward when practical, using a temporary worktree for revision comparisons only when agreed; unavailable before-fix proof is reported explicitly.
- `implement` revisits the design when repeated workarounds show that the structure may be wrong.
- `greenlight` groups related comments, fixes their underlying cause, verifies the group and pushes once per authorized review round.

## Installation, data, and support

The board requires macOS Codex desktop with MCP App support; native chat delivery needs Codex app tools and host messaging. GitHub checks use your authenticated `gh`. Saved schema-1 boards keep the historical `Workbench Preview` data directory and `WORKBENCH_PREVIEW_DATA_DIR` override; repository notes and original chat links remain intact.

See [supported systems](https://github.com/fadamakis/ai-tools/blob/main/docs/supported-systems.md), [updates](https://github.com/fadamakis/ai-tools/blob/main/docs/updates.md), [compatibility](https://github.com/fadamakis/ai-tools/blob/main/docs/compatibility.md), and [privacy and permissions](https://github.com/fadamakis/ai-tools/blob/main/docs/privacy-and-permissions.md). Build/test instructions are in [CONTRIBUTING.md](https://github.com/fadamakis/ai-tools/blob/main/CONTRIBUTING.md).

## Preview

Synthetic data in the browser preview; this image does not establish native-host acceptance.

![Workbench preview](https://raw.githubusercontent.com/fadamakis/ai-tools/main/docs/images/workbench.png)

## Delivery evidence and recovery

Verification and independent review can bind results to server-generated fingerprints of the actual checkout, tested content, base and accepted requirements. Legacy evidence remains readable as historical or unbound. The board displays the last explicit freshness observation; it does not watch the filesystem.

PR checks distinguish observed outcomes from required CI, human review and mergeability. Publication tools validate each requested commit, ordinary push and draft-PR step, then retain receipts for interruption recovery. The existing local Git/GitHub credentials remain in use.

See [delivery evidence and recovery](references/delivery-recovery.md) for tool inputs and capability gaps. Installation starts none of these actions.
