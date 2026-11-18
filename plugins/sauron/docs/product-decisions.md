# Sauron product decisions: errors and recovery

Sauron should help users understand what happened, retain their intended change and choose a useful next action when something goes wrong.

Agreed direction: 18 November 2026. Provenance: [PR #20](https://github.com/fadamakis/ai-tools/pull/20) and the product discussion accompanying it. This records intentions, not release status.

## Intent

An unexplained save warning and an ineffective retry prompted these decisions. Recovery should help users continue their work without understanding internal subsystems or guessing whether a change reached storage. The goal is understandable state and preserved work, with enough explanation to make the next decision confidently.

## Agreed principles

- **Use task language.** Name the attempted change, such as moving a task or saving topics. Internal subsystem names should not become concepts users must learn to recover.
- **Be honest about certainty.** A rejected save and an unconfirmed save have different consequences. Calling an uncertain outcome a failure can encourage duplicate actions or unnecessary rework.
- **Make recovery useful.** Every offered action must do what its label promises, or explain why it is unavailable. A retry that silently does nothing leaves users stuck.
- **Preserve intent and control.** Retain unfinished changes and require review when newer information changes their meaning. Recovery should not silently overwrite newer decisions or discard the original intention.
- **Explain dismissal.** Clearing a retry request does not undo a saved change. State that consequence so users can dismiss a warning without misunderstanding what happens to their work.
- **Diagnose without exposing content.** Record enough context to explain failures and blocked actions, while excluding task text, reply drafts and request contents. Useful diagnostics should not require sharing private work.
- **Keep routine saves quiet.** Ordinary saving is progress, not a failure state. Interrupt users when they need to understand uncertainty or make a recovery decision.

## Current implementation choices

The 100-event diagnostic limit, session-only retention and existing recovery controls are choices for this iteration. They balance useful troubleshooting with limited local retention. They are not permanent product rules.

Longer retention, different controls or safe automatic recovery may be considered when useful. Any change must preserve honest outcomes, user control and the content boundaries above.

The [architecture notes](architecture.md#error-recovery) explain the mechanics. The [error-recovery requirements](task-groups.md#error-recovery-requirements) define testable behaviour. Keep those details there rather than duplicating them here.
