---
name: review
description: >
  Review a Workbench diff through one independent, read-only reviewer subagent. Use
  for /workbench:review or the active Workbench review stage. Check concrete defects
  and reviewer effort; the main agent validates findings and owns authorized fixes.
  Do not trigger for all PR reviews or post comments automatically.
---

# Review before publishing

Read [the shared contract](../../references/workflow.md) and applicable repository review instructions. This stage is read-only unless the user also requested fixes. Delegate the review, not ownership of the change.

1. Establish the exact repository, worktree, branch, base and HEAD, including staged, unstaged and untracked task files. For a PR review, fetch current metadata, commits, checks and every open discussion. Record the reviewed diff/content so concurrent changes can be detected; a HEAD alone does not identify uncommitted work. If there is no task diff, say so without spawning a reviewer.
2. Start exactly one reviewer with the host's native subagent tool and the [reviewer brief](../../references/reviewer.md). Use a fresh context rather than forking the implementation conversation when supported. Supply the factual requirements, accepted scope/dependencies, source links, target, instruction paths and current discussion context. Do not supply the implementing agent's defense of its solution, prior self-review conclusions or desired verdict. Inherit the current model unless the user or applicable instructions specify another.
3. While the reviewer works, collect verification evidence and reconcile acceptance criteria with test coverage without changing the reviewed files or doing a second full review. The reviewer must not edit files, commit, push, post comments, resolve threads or delegate further. Keep user-facing GitHub actions with the main agent. Do not create a separate user-owned task as a substitute for a subagent.
4. Wait for the review to finish; do not publish or call the review complete before receiving it. If the tool is unavailable, fails, or cannot provide a separate context, report that limitation and perform the checklist locally. Label that as a main-agent review, not independent review. If reviewed content changes during review, invalidate findings affected by the change and ask the same reviewer to inspect the updated scope before relying on its verdict.
5. Validate returned findings against the current code and requirements. Reproduce when feasible, deduplicate against existing discussions, and reject speculative or unsupported feedback with a concrete reason. Do not dismiss a finding merely because it conflicts with the implementation rationale. Check that copy and visual behavior match the approved design and that feature-specific work does not alter shared components or their copy without tracing all consumers. Flag invented copy, translations, filters, refactors or other unrelated behavior as scope defects. Distinguish behavior caused by this PR from pre-existing behavior; create or recommend a separate ticket for the latter. Return concise findings with file/line, scenario, impact and remedy; keep reviewability suggestions separate from defects. Use the host's inline-comment directive only when supported. Cite repository rules only when they materially support a finding. State no actionable issues when none remain.
6. Under an end-to-end implementation request, the main agent fixes confirmed issues and reruns affected checks. Use the same reviewer for a focused recheck of those changes when needed; do not spawn a new review panel or loop until a preferred verdict appears. Under review-only scope, stop after reporting findings. State what revision was reviewed, whether review was independent, and any remaining verification or deployment dependencies.

Distinguish whether the change can merge safely from whether the feature can be enabled. Do not claim clean CI or readiness without current evidence.

Finish with the **Next-step handoff** defined in the shared contract, choosing the recommendation from the actual result of this stage.

Record the current preview board checkpoint before handing back control, following **Preview board checkpoints** in the shared contract.

In the structured checkpoint, submit only the `review` evidence actually checked, with its check time and tested HEAD when known. Preserve the other stage's independently recorded evidence. Detailed commands and working-tree context remain in the Markdown note.

Follow [delivery evidence and recovery](../../references/delivery-recovery.md) to capture content before checking and bind the result to its snapshot.
