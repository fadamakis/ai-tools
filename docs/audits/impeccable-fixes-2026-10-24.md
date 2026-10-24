# Impeccable fixes and repeat audit

This is the historical audit record from before the final release commit. Local/uncommitted status below describes audit time. See [release policy](../rollout.md) and the current release notes for publication status, accepted limitations and verification scope.

24 October 2026. Local, uncommitted changes based on source `71dbd16eb292e4ec6046aaae5c0ff73054854bdd`. The five original verified findings have been fixed. One cross-engine keyboard acceptance item remains open.

## Changes

| Finding | Implementation | Verification |
| --- | --- | --- |
| A11Y-01: active field hints | Shared controls use the existing secondary text token for placeholders and unselected values. Workbench now imports the shared foundation after the SDK styles. | Placeholder and repository-filter contrast assertions pass at 4.5:1 or better in light and dark. |
| SHELOB-01: previous-attempt disclosure | A 32px minimum target, 8px vertical padding, visible keyboard focus and a 44px minimum for coarse pointers. | Keyboard activation and synthesized Chromium touch pass; measured targets exceed the specified minima. |
| WORKBENCH-01: Merged badge | Soft success badges use the existing stronger success text token. | Measured rendered contrast passes in both themes. |
| WORKBENCH-02: repository selector | Removed SDK `id`/`name` props that created a nested hidden text control. Selection remains controlled by React state; the trigger's accessible name includes “Repository” and its selected value. The visible field caption no longer labels an unrelated input. | No nested interactive form element; existing selector, modal focus, Escape, and task-launch tests pass. |
| SAURON-01: initial preview theme | Apply the system theme when connecting the standalone preview. Host-provided theme initialization remains on the embedded-client path. | Both initial system themes and the toggle pass. An AppBridge test with a dark system and a light host confirms that the embedded app respects the host. |
| Additional Workbench contrast | Dark warning badges and next-action text use brighter tokens from the existing orange palette. | Both themes pass rendered contrast assertions and axe. |
| Shelob code evidence | Named, focusable regions, a visible inset focus ring and scoped Left/Right scrolling. Modified key combinations remain available. | Chromium Tab, scrolling, reverse scrolling and modifier checks pass. WebKit results and the remaining narrow Tab-entry gap are below. |

The changes retain product identity, existing workflows and the incumbent layout. No schema, store, server tool, data path, permission or connector change is required; no data migration is introduced.

## Validation

- Build and Sauron TypeScript checking: passed.
- **320 unit tests:** Shelob 160, Workbench 69, release tooling 12, Sauron 79; zero failures.
- **124 browser tests:** Shelob 40, Workbench 39, Sauron 45; zero failures, skips or flakes. Shelob's entire suite was rerun after the final arrow-scrolling change.
- **42-state repeat audit:** populated views at 1440, 768, 390 and 320 CSS px, plus forms at 1440, 390 and 320px, in both themes for each product. Zero axe WCAG-tagged violations, document-level horizontal overflows or uncaught page errors. Shelob's 14 states were refreshed after its final change; the other 28 states retained unchanged UI bytes.
- Modal focus containment and Escape checks passed in both themes. Sauron's inline composer remains inline.
- Impeccable source and rendered detectors were reviewed. The existing Shelob proposed-comment accent warning is intentional differentiation within the established design. Workbench's tiny-text warning targets the synthetic host banner outside the shipped app. No broad waiver was added.
- Visual polish: inspected wide/light Workbench, narrow/dark Workbench form, narrow/light Sauron composer and narrow/dark Shelob report. Controls retain their existing hierarchy; the altered colors, focus treatment and field caption fit the surrounding UI.
- Public-content and redacted source-secret checks are recorded in the adjacent verification receipt.

Tooling: Impeccable skill 4.7.0, engine 0.1.16; axe-core 4.14.0; Chromium 156.0.8078.4; Node 22.23.1; pnpm 10.11.0. Synthetic stores and host simulations were used; external audit-browser requests were blocked.

## WebKit and remaining acceptance

Used the installed **WebKit 26.0** with its matching **Playwright 1.58.1** client, separately from the Chromium suite. The first attempt with the newer client stalled; those disposable processes were stopped and the matching client used. No project dependency was changed.

In light and dark at 1440 and 320px, the final region scrolled right by 40px, returned left to its start, and displayed its focus outline. The wide keyboard Tab cycle passed. **Narrow synthetic-iframe Tab entry did not pass**; pointer focus was needed before the narrow scrolling assertion. These four scrolling results are not four complete keyboard-path passes.

The narrow Tab-entry behavior needs reproduction in the actual supported Codex host to distinguish app behavior from the older WebKit synthetic host's focus routing. Do not mark native keyboard acceptance complete from these results. Actual Codex panels/handoff, screen readers, physical touch hardware and other operating systems remain unverified.

## Repeat-audit scores

| Dimension | Shelob | Sauron | Workbench |
| --- | ---: | ---: | ---: |
| Accessibility | 3/4 | 3/4 | 3/4 |
| Performance | 3/4 | 3/4 | 3/4 |
| Theming | 3/4 | 3/4 | 3/4 |
| Responsive design | 3/4 | 3/4 | 3/4 |
| Implementation integrity | 4/4 | 4/4 | 4/4 |
| **Total** | **16/20** | **16/20** | **16/20** |

These are scoped review judgments, not accessibility certification or release approval. The original scores were 15, 15 and 14 respectively. Native acceptance and the explicit narrow WebKit gap limit the accessibility/responsive conclusions. Performance remains an observation rather than a measured improvement; no bundle-splitting change was justified by the audit.

## Local delivery and publication status

The edits are in the clean preparation checkout on `main`. The original sandbox checkout and installed plugins were not modified. Changes remain uncommitted and unpushed. No external message, GitHub release update, repository visibility change or plugin installation occurred.

The frozen candidate ZIPs and GitHub draft still represent the earlier source. Build a new versioned candidate and refresh its receipts after these local changes are reviewed and committed; do not describe the old candidate as containing these fixes. Existing private-history and native-host publication gates remain separate and open.
