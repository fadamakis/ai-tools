# AI Tools

<!-- impeccable:product-schema 1 -->

## Platform

web

The interfaces are web applications embedded as MCP Apps in Codex desktop. The initial host target is macOS. This does not make the panels native iOS or Android interfaces.

## Users

Individual Codex users who install the tools they need and use their own accounts and local data. Shelob and Workbench serve software development work; Sauron serves personal and source-backed task tracking. Each plugin must be useful independently.

## Product Purpose

- **Shelob:** review local changes or a GitHub pull request, inspect findings and check coverage, and return to saved reports with their reviewed revision.
- **Sauron:** keep personal tasks and source-backed obligations together while preserving the user's decisions, context, discussion links and reviewed reply drafts.
- **Workbench:** start or resume native Codex chats, follow delivery stages and retain repository and task context on a board.

Success means completing those tasks with understandable state, clear next actions and preserved work across refreshes and updates.

## Positioning

The suite combines local persistent state, explicit MCP tools and embedded panels with the user's existing Codex conversations and service connections. The three plugins share a marketplace and UI primitives while retaining their own purposes and data stores.

## Operating Context

Users work in a Codex chat and sidebar panel. They may have a narrow panel, a larger expanded view, long repository or task names, missing optional service connections, or saved work from an earlier release.

Source lives on `main`; installable packages use the `releases` Git marketplace. Users choose their plugins and connect their own services. Installation does not create schedules, start reviews, scan sources or publish external changes.

## Capabilities and Constraints

- Preserve existing plugin, tool and resource identities and saved-state readability. Product data remains outside versioned plugin caches.
- Shelob distinguishes execution progress, assessed checks, findings, freshness and publication readiness. A saved report is evidence for its recorded revision.
- Sauron preserves personal decisions across source refreshes and supports explicit review of reply drafts before sending.
- Workbench has 13 explicit workflow commands and uses the host's native chat and checkout capabilities. Its browser preview simulates native handoff.
- Some actions need local executables, host capabilities or the user's service connections. Missing capabilities need useful guidance.
- Public workflows must discover the target repository's conventions rather than assume an employer's tools, identifiers or processes.
- Interfaces use React and shared UI primitives in `packages/ui`; plugin entry points remain distinct. Existing code and assets define the incumbent visual system for refinements.
- Windows, Linux, Intel Macs and native desktop activation are not established by browser preview evidence.

## Evidence on Hand

Root and per-plugin READMEs document the supported workflows. The repository has unit checks, browser interaction checks and synthetic preview fixtures. Screenshots in `docs/images/` use synthetic data. Browser previews and simulated host bridges do not prove native-host behavior.

## Product Principles

1. Make each plugin's next useful action and current state understandable.
2. Preserve user work and distinguish saved state from freshly verified results.
3. Keep external actions explicit and show their relevant context and outcome.
4. Share consistent primitives without flattening the products' different workflows.
5. Describe capabilities and evidence accurately; do not invent customer, performance or compatibility claims.

## Open Decisions

No additional audience or accessibility requirements were specified during initialization. Audits can identify accessibility gaps without declaring unverified conformance.
