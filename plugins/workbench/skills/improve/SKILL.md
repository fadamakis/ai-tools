---
name: improve
description: >
  Review a completed Workbench run for one reusable workflow improvement and apply
  it only after the user explicitly approves that exact proposal. Use for
  /workbench:improve or an explicit approval of a named Workbench improvement.
  Never infer approval from the delivery task, autopilot, silence or task notes.
---

# Improve Workbench

Read [the shared contract](../../references/workflow.md). This is an explicit, approval-gated utility for improving Workbench itself, not another delivery stage. It has a read-only proposal phase and a separate apply phase.

## Propose

Use evidence from a completed or stopped Workbench run. Inspect the maintained Workbench source and the active installed copy when available, but do not edit either.

Propose at most one improvement only when the run exposed a concrete, reusable workflow gap. Prefer no proposal for one-off product decisions, repository-specific facts, transient environment failures, personal data or behavior already covered by the current instructions. Do not turn a single surprising result into a universal rule without a clear recurring mechanism.

Give the proposal a short identifier and show:

- the observed evidence and why it is reusable;
- the exact behavior or instruction to add, remove or replace;
- the source files and installed copies that would change;
- the risk of overfitting or conflicting with existing rules;
- the validation and any separately authorized supported activation that would be run.

End by stating that no Workbench files changed. An ordinary task handoff, an autopilot invocation or a displayed suggestion is not approval.

## Apply an approved proposal

Apply only when the human user directly approves the named proposal or the exact displayed change. Re-read the live source and installed copy before editing. If either has drifted in a way that changes the proposal, stop and show the revised proposal instead of treating the old approval as permission for a different patch.

Update the maintained source first. Keep the patch narrow and general: preserve existing authorization boundaries, avoid ticket-specific examples, secrets, memories and unrelated repository instructions, and update help/README/host mirrors only when the public interface changes. Do not change the plugin version, publish it, reinstall it or mutate another skill/plugin unless the approved proposal explicitly includes that action.

Validate every new or changed skill with the available skill validator and inspect the final diff. Do not edit the installed cache directly. When the approved proposal explicitly includes activation, use the host's supported reload/reinstall workflow for this same plugin identity; inspect its current tool guidance first and preserve the existing marketplace and configuration. Read back the activated version and compare the changed source/installed files byte-for-byte. If activation was not approved or is blocked, preserve the source change and report that it remains inactive. Loaded instructions may not change until a new task or plugin reload.

Report the approved proposal identifier, files changed, validation results, activation status and any limitation. Do not immediately generate another improvement proposal from the improvement run itself.
