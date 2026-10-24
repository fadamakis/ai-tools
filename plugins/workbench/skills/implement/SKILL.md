---
name: implement
description: >
  Implement a Workbench slice optimized for code reviewability. Use for
  /workbench:implement or the active implementation stage. Choose the smallest
  clear design before editing, keep state ownership and control flow easy to
  trace, reuse established code and copy, and simplify the actual diff before
  verification. Do not publish or start a competing feature workflow.
---

# Implement for code reviewability

Read [the shared contract](../../references/workflow.md). Confirm the plan, target checkout and acceptance criteria against current code. If no plan exists, reconstruct a minimal scope; use [plan](../plan/SKILL.md) for material unanswered questions. For visual changes, capture an available pre-change baseline using [PR visual evidence](../../references/visual-evidence.md).

Optimize for the effort needed to understand and safely change the code, while preserving correct behavior. A reviewer should be able to trace an action to its result, identify who owns each state transition, and see why each changed file is necessary. Fewer lines or more files are not evidence of simplicity.

## Choose the shape before editing

1. Read the actual entry point, callers and closest maintained implementation of similar behavior. Reuse existing domain types, queries, copy, components and test helpers when their semantics fit. Prefer the repository's established pattern over a new generic mechanism.
2. Before adding custom lifecycle management, inspect whether the existing framework/client already owns it. For Apollo pagination, evaluate the maintained `useQuery`/`fetchMore` and cache/merge pattern before choosing `client.query()` plus custom loading, error, retry and accumulated-result state. Trace the actual acceptance scenarios, including stale responses, filter changes and retries when required. If a library pattern fails a required scenario, identify that concrete gap and add only the missing behavior. Do not switch APIs merely for style or assume a library automatically handles every race.
3. Sketch the smallest responsibility map in the existing task note or progress update: entry point, owner of mutable state/side effects, necessary rendering or pure domain helpers, and the behavior each changed file owns. Keep it to a few lines; do not add a source README or design document for this exercise.
4. Start with the direct implementation. Add a layer only when it removes a concrete responsibility from a caller, enforces an invariant, or serves an actual reuse need. If the planned change needs a new framework, controller, context, service or orchestration layer, first compare it with extending the existing owner. Choose the simpler design that satisfies the requirements; do not build for hypothetical future consumers.
5. Keep one independently reviewable behavior per slice. Separate unrelated cleanup or mechanical moves from behavior changes when useful. If a prerequisite refactor is necessary, make its reason and boundary clear. Follow the shared split guidance for a large diff; do not omit required behavior or tests just to shrink it.

## Design and copy requirements

- Treat the exact Figma node, approved ticket behavior and existing maintained website as the sources of truth. Check layout, spacing, typography, component variants, responsive behavior and interaction states against the actual design, using existing design-system components and tokens. Do not approximate from memory or silently substitute a different interaction. If those sources conflict, or the design is inaccessible or incomplete, raise the specific discrepancy before implementing the affected detail; continue only independent work.
- Ask before diverging from an accessible design, including dimensions, spacing, breakpoints, interaction states, loading layout or component choice. When a breakpoint is unclear, inspect the existing maintained website and record the breakpoint that it actually uses.
- Prefer design-system components and tokens. If the design cannot be implemented with the DS, raise the exact gap and the proposed scoped exception before adding custom UI. Do not change a shared component or its copy to solve a feature-specific mismatch without tracing all consumers.
- Never invent user-facing copy, translations or state-specific wording, including loading, empty, error, success and accessibility text. Search source and the relevant English catalog for existing messages with the same meaning and context before adding an ID. Use new wording only from an approved design, ticket or explicit user decision; preserve its meaning and follow the repository's localization process. Missing copy is an open question, not permission to add a plausible message or ship placeholder text.
- Keep feature-specific messages in the feature's established copy source. Reuse exact existing wording where it fits, and never add translations or inline copy merely to make a state look complete.
- If implementation reveals a new product, design, copy or API question, surface it with the affected behavior and record it in the plan. Wait for an answer only for the dependent work; do not silently turn an assumption into a requirement.

## Scope and reviewability gates

- Keep frontend and backend changes in separate PRs by default. If a shared contract requires both, stop and propose the smallest stacked sequence before editing.
- Keep one independently reviewable behavior per slice. Do not add unrelated filters, refactors, translations, shared-component changes or adjacent fixes. If the behavior is outside the ticket, determine whether this change caused it; otherwise record it as a separate ticket.
- Reassess the diff at 600 changed lines and stop at 800 changed lines, counting additions and deletions across source, tests and configuration. Propose self-contained stacked PRs rather than removing required behavior or tests to meet the limit.


## Build a flow the reviewer can trace

- **One owner per mutable fact and transition.** Derive values instead of synchronizing copies. Keep submit, pending, success, failure and retry decisions together under the appropriate owner. Use only states required by the actual contract; do not add overlapping booleans or mirror query data in local state without a concrete reason.
- **Explicit control flow.** Prefer named domain operations and straightforward branches over callback chains, effect-driven coordination or configurable dispatch tables when the direct version is clearer. Keep required race protection, validation and error handling; remove a guard only after proving the invariant that makes it redundant.
- **Visible async coordination.** Use one explicit request/selection identity and the library's lifecycle where possible. Challenge a flow whose correctness depends jointly on memoized object identity, render-time state updates, retry counters and effect-local flags. Trace which signal owns invalidation and stale-result rejection; eliminate overlapping signals while retaining necessary protection. Each additional lifecycle mechanism needs a concrete requirement the existing owner cannot satisfy.
- **Separate rules from lifecycle.** Keep request-variable/plan/filter mapping and response normalization as clearly named pure decisions, separate from asynchronous transitions when that makes the flow easier to read. Local functions may be enough; do not scatter them into files by default. Preserve backend-required field allowlists and variable-only arguments even if removing them would shorten the hook.
- **Small components are encouraged.** Give each component one recognizable UI responsibility and a small, meaningful props interface. Extract a section, list item, state display or action group when it makes its parent easier to read, even with only one caller. Reuse is not a prerequisite. Keep tightly related markup together; avoid trivial forwarding components, excessive prop threading and splits made only to game the 800-line reviewability limit.
- **Favor presentational components.** Prefer UI components that render explicit data/state props and report user actions through named callbacks. Keep fetching, backend mapping and business transitions in a cohesive parent or hook so the UI can be understood and exercised independently. Local UI state is fine where it naturally belongs. Do not add a container/hook pair mechanically to every component or introduce duplicated state to enforce the separation.
- **Cohesive hooks.** Extract a hook when it owns a coherent lifecycle/state responsibility. A hook returning many setters/flags or taking a long list of callbacks may just hide orchestration; simplify ownership first. Do not use a hook merely as a container for a long function.
- **Keep related code close.** Extract pure domain transformations or decisions when they make the main flow clearer or have real reuse. Keep one-use helpers/types local when moving them adds navigation without improving the boundary. Avoid miscellaneous `utils`/`types` files, pass-through wrappers and files split only to meet a line-count target. Follow established repository organization where it already supplies the right boundary.
- **Small, honest interfaces.** Reuse canonical types and API shapes. Avoid redundant model mappings, speculative options, overly generic type parameters, casts that conceal a contract mismatch and fallback data that pretends an unavailable backend works. Resolve a missing contract or report the dependent work as blocked.
- **No explanatory comments by default.** Prefer clear names, types, control flow and tests. Add or retain a comment only when it communicates a crucial, non-obvious constraint whose omission could cause an incorrect change, such as a backend requirement, ordering invariant or necessary workaround. Keep it brief and explain why. Do not narrate what the code does, add section dividers, leave commented-out code or embed task/review history. Preserve required legal/generated headers and compiler/tool directives; do not treat functional directives as disposable prose. Limit cleanup to task-owned changes.
- **Tests that explain behavior.** Add focused coverage from the Acceptance proof table, with readable setup and assertions on observable outcomes. Choose one appropriate proof layer per behavior—unit, component or E2E—and do not duplicate the same proof across layers unless a contract or regression requires it. If no meaningful test is possible, state why. Reuse real boundaries and maintained helpers where practical; do not create a large mocking framework or implementation-mirroring tests. For bugs, use [regression proof](../../references/regression-proof.md) and report unproven cases honestly.

## Simplify each slice, then read the final diff

After each meaningful slice, remove speculative branches/options, duplicated state, obsolete comments, unused code and task-only documentation. Retain explanatory comments only under the crucial-constraint rule above; a general tradeoff or a desire to explain complex code is not enough. Reconsider the structure when repeated casts, special cases or duplicate state appear; trace the underlying ownership instead of adding another workaround. Preserve the design, approved copy and acceptance criteria.

Before handing off, inspect the complete task diff against its base, including task-owned uncommitted files. Read it in the order a reviewer would: entry point, state/side effects, rendering, then tests. Check:

- Can the main action, failure/retry and success paths be followed without repeatedly jumping among forwarding helpers? If not, collapse indirection or regroup the owner.
- Is each custom loading/error/retry/pagination state needed beyond the existing client lifecycle? Identify the concrete gap; otherwise use the established owner. Keep stale-response and failure-path coverage when replacing orchestration.
- Can each new abstraction/file justify its responsibility and smaller caller interface? If not, inline, reuse or remove it. Do not invent another abstraction to explain the first.
- Does each changed block support a requirement, necessary correctness constraint or focused test? Remove unrelated cleanup, formatting churn and obsolete compatibility code introduced by this task. Preserve unrelated user changes.
- Are UI responsibilities small and clearly named, with presentational rendering distinct from data/business orchestration where useful? Extract a cohesive component when it reduces the parent’s complexity; avoid splitting by size alone or splitting only to game the PR limit.
- Do names explain the domain and tests demonstrate the intended behavior? Fix misleading names and opaque test setup instead of adding explanatory narration. For each added explanatory comment, identify the crucial constraint it preserves or remove it.

Assess correctness and maintainability separately: passing checks establish the behavior they exercised, not that the design is easy to review. Do not call the result simple or cohesive without tracing the actual diff and challenging its remaining machinery. Address concrete reviewability problems before declaring implementation complete. Record a necessary tradeoff briefly when simplifying further would obscure or break a real constraint; the 800-line threshold is a reviewability gate, not a reason to rewrite untouched code. If scope must change, ask the user about that decision while continuing independent work.

Run required formatting, lint and focused behavior checks with the repository's runtime/scripts after simplification. Do not weaken tests or increase timeouts to get a pass. In the handoff, give a short reading order for the main changed files and any remaining dependency; keep process commentary out of source and PR descriptions. Continue to [verify](../verify/SKILL.md) when authorized. Do not commit or push without authorization for the target.

Finish with the **Next-step handoff** in the shared contract. Simplification is part of implementation and its completion criteria, not an optional follow-up.

Record the current preview board checkpoint before handing back control, following **Preview board checkpoints** in the shared contract.
