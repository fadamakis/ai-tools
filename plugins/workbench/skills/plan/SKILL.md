---
name: plan
description: >
  Turn a ticket and designs into a small, evidence-based Workbench implementation
  plan. Use for /workbench:plan or the active Workbench planning stage. Reconcile
  acceptance criteria, existing code, API contracts, copy and dependent PRs. Do not
  replace a directly requested OpenSpec, ticket-refinement or PR-plan workflow.
---

# Plan a reviewable change

Read [the shared contract](../../references/workflow.md). Use [specialists](../../references/specialists.md) only for the sources required here.

1. Read the full ticket, out-of-scope notes, relevant comments, linked tickets and exact design nodes. Inspect linked PRs and their current merge status. Record missing or conflicting requirements instead of choosing silently.
2. Before using implementation details to define tests, turn the sourced requirements into a small **Acceptance proof** table: criterion/source, preconditions, user action, expected observable result and verification method. Include only states supported by the requirements; mark missing expectations as open questions. Keep expected behavior separate from how the current code happens to work. Then trace the existing entry point, callers, state ownership, API schema and implementation. Check recent changes on the verified base. Separate an API declared in a schema from one implemented and deployed in the target environment.
3. Search existing components and source copy, then the relevant English translation catalog for exact and equivalent messages. Identify what can be reused and which new text has an approved source. Do not invent state-specific messages.
4. Define the smallest coherent slice. For each user-visible transition, identify its owner and observable success, loading, empty and failure behavior where relevant. Sketch a short reading order through the entry point, state/side-effect owner and rendering/tests; prefer extending an existing owner before proposing new layers. Keep this in the task note, not a new source document. List backend dependencies, flags/configuration, rollout conditions and what can be tested now.
5. Assess PR size and independent behaviors using the shared reviewability criteria. Keep tests with each slice and choose one appropriate proof layer per behavior. At 600 changed lines, reassess the slice; at 800, stop and propose self-contained stacked PRs. Keep frontend and backend changes separate by default. Specify base and merge order for dependent PRs; avoid two PRs owning the same transition.

6. Raise unresolved product, design, copy and API questions before dependent implementation. First check the ticket, designs and current code for an answer. Present each remaining question with the affected behavior, why the answer matters, any evidence-backed recommendation clearly labeled as a proposal, and whether it blocks work. Ask the user the smallest actionable question rather than merely hiding it in the task note. Do not ask about routine engineering choices that repository conventions already settle. Continue independent work while awaiting required answers.

Produce a short plan containing: outcome, scope/non-goals, existing pieces to reuse, changed responsibilities, the Acceptance proof table, dependencies, **Open questions**, and PR split if needed. In Open questions, distinguish decisions needed before implementation from non-blocking follow-ups; say “None” when the available sources settle the requirements. Keep it in the task note rather than a source README unless the repository requires a committed design artifact.

For an implementation request, proceed after resolving material ambiguity; do not add a ceremonial approval gate. For plan-only requests, return the plan. A missing contract blocks only the work that depends on it, with the gap stated explicitly.

Finish with the **Next-step handoff** defined in the shared contract, choosing the recommendation from the actual result of this stage.

Record the current preview board checkpoint before handing back control, following **Preview board checkpoints** in the shared contract.
