---
name: verify
description: >
  Verify a Workbench change against acceptance criteria, CI configuration and the
  real runtime. Use for /workbench:verify or the active Workbench verification stage.
  Check UI behavior beyond Storybook where applicable and report passed, failed and
  blocked checks separately. Verification alone never authorizes a push.
---

# Verify the behavior

Read [the shared contract](../../references/workflow.md). Bind checks to the target branch, HEAD and current diff before running them.

1. Start from the plan's **Acceptance proof** table. If absent, reconstruct the relevant expectations from the ticket/design/user decisions before comparing them with implementation. Verify each in-scope criterion against its expected observable result and link the evidence back to that row; passing implementation tests alone does not establish acceptance. Mark each result passed, failed, blocked or not run, and explain any excluded criterion. Derive the technical check set from changed behavior, repository instructions and actual CI configuration. Inspect runtime versions and test entry points. Run required lint, formatting, type and focused behavior checks; use one appropriate proof layer per behavior and do not duplicate the same proof across unit, component and E2E checks without a concrete contract or regression reason. If a behavior cannot be meaningfully tested, state why. Expand only for changed boundaries or unresolved failures.
2. Use or establish a reusable application recipe following [verification recipes](../../references/verification-recipes.md). Revalidate its commands, environment and last proof against the current checkout before reuse. When an app or Storybook needs launching, follow [run](../run/SKILL.md) for checkout identity, ports and session ownership, then continue verification. For UI changes, inspect the real route as well as stories. Compare the specified design at relevant viewport sizes: theme/providers, typography, width, spacing, button states, hover/focus, portals and loading layout. Verify loading feedback preserves the layout. Test empty/error states and stale responses when those paths changed. For visual changes, capture and inspect Before/After screenshots following [PR visual evidence](../../references/visual-evidence.md). Retain the files and provenance for publish; report missing baseline/access rather than fabricating a pair.
3. For write flows, check the user-visible sequence and ownership of submit, disable, error, retry and success. Confirm success/navigation comes from authoritative data. Do not invent recovery or cancellation contracts to make a test pass.
4. For bug fixes, check the [before/after regression evidence](../../references/regression-proof.md); do not count a missing pre-fix reproduction as proven. For CI failures, fetch the exact failed command and log, reproduce with the same relevant runtime/configuration, then identify environment mismatch, flaky ordering or a code defect. Test async behavior deterministically where possible. Do not treat a longer timeout as a root-cause fix.
5. Record exact commands, results, scope and revision in the task note. For UI changes, hand publish an explicit inventory of reviewed screenshots and relevant new/changed or existing Storybook stories following [PR visual evidence](../../references/visual-evidence.md). Record capture paths, provenance and missing images; record each story's source, actual ID, demonstrated state and local proof. Captures remain unattached until publish confirms PR body readback. A command must complete successfully to count as passed. Mark browser/staging checks as unverified when authentication, API data or environment setup prevents them. Do not change staging records or production configuration without separate authorization.

Report a compact evidence summary with local checks, runtime/design checks, CI and deployment dependencies separated. State what remains unverified and why. If a fix changes code, run the affected checks again before updating the evidence. A verify-only request reports failures; make fixes when the user's broader implementation request already authorizes them.

Finish with the **Next-step handoff** defined in the shared contract, choosing the recommendation from the actual result of this stage.

Record the current preview board checkpoint before handing back control, following **Preview board checkpoints** in the shared contract.

In the structured checkpoint, submit only the `verify` evidence actually checked, with its check time and tested HEAD when known. Preserve the other stage's independently recorded evidence. Detailed commands and working-tree context remain in the Markdown note.

Follow [delivery evidence and recovery](../../references/delivery-recovery.md) to capture content before checking and bind the result to its snapshot.
