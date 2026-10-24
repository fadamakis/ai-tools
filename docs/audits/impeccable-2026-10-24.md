# Impeccable audit: Shelob, Sauron and Workbench

This is the historical audit record from before the final release commit. Local/uncommitted status below describes audit time. See [release policy](../rollout.md) and the current release notes for publication status, accepted limitations and verification scope.

24 October 2026. Technical audit of the existing web interfaces; no redesign or UI fixes were applied.

**Follow-up:** The original findings and scores below describe the pre-fix snapshot. See the [implementation and repeat audit](impeccable-fixes-2026-10-24.md) for the local fixes, successful checks and remaining narrow WebKit keyboard gap.

## Implementation integrity: PASS for all three

The interfaces express their own product workflows: Shelob separates reviews, coverage and evidence; Sauron separates task decisions from incoming context; Workbench presents delivery stages, task state and native handoff. Shared UI primitives and semantic tokens provide a coherent foundation. The verified defects below concern accessibility and theme initialization. Detector style warnings were checked in context rather than treated as defects automatically.

## Result

**Five verified findings: four P1 and one P2; no P0 or P3 findings.** The shared contrast finding is counted once, although it affects all three products. One additional Safari keyboard concern needs engine/host verification and is reported separately.

| Dimension | Shelob | Sauron | Workbench | Basis |
| --- | ---: | ---: | ---: | --- |
| Accessibility | 2/4 | 3/4 | 2/4 | Shared low-contrast active placeholders; Shelob disclosure target; Workbench badge and nested form control. Sauron's other inspected semantics and forms passed automated checks. |
| Performance | 3/4 | 3/4 | 3/4 | Self-contained bundles and bounded updates; payload and first-load main-thread work leave optimization room. Large-data and native profiling remain untested. |
| Theming | 3/4 | 2/4 | 2/4 | Explicit light/dark states render; Sauron's local preview does not apply its initial system theme; Workbench's default light palette misses contrast thresholds. |
| Responsive design | 3/4 | 3/4 | 3/4 | No document-level horizontal overflow at the tested widths, including narrow forms. Small controls require the specific fixes below; physical devices were not tested. |
| Implementation integrity | 4/4 | 4/4 | 4/4 | Coherent product-specific structures and shared primitives; no accepted generic-template or decorative-content defect. |
| **Total** | **15/20** | **15/20** | **14/20** | **Good: address weak dimensions.** |

These scores are scoped review judgments, not accessibility certification or public-release approval. Four P1 findings should be addressed before release.

## Coverage and evidence

- UI source is unchanged from `71dbd16eb292e4ec6046aaae5c0ff73054854bdd`. Each source preview HTML file was byte-compared with the reviewed release package before accepting screenshots.
- Impeccable skill metadata **4.7.0**, engine **0.1.16**; axe-core **4.14.0**, downloaded from npm with its SHA-512 integrity verified; Chromium **156.0.8078.4**, Node **22.16.0**, macOS ARM64.
- Source detector scans covered all three app directories and shared UI primitives. Rendered Impeccable scans used a disposable browser's loopback CDP endpoint. Sauron was scanned directly; Shelob/Workbench render inside synthetic host iframes, so their outer-page detector findings were distinguished from product findings. Axe and DOM measurements ran inside each actual app document.
- **42 rendered states**, 14 per product: populated views at 1440, 768, 390 and 320 CSS px, plus forms at 1440, 390 and 320 px, each in light and dark themes. Sauron's dark states were explicitly applied with its own theme control after recording the initialization defect.
- Keyboard checks exercised form entry, focus containment, Tab traversal, Escape and delayed focus restoration for the two modal forms. Sauron's task composer is inline and was evaluated as inline content. Both mouse-open and keyboard-open modal restoration passed after allowing the close lifecycle to finish.
- Synthesized Chromium touch activated Shelob's checks panel, Sauron's return to its task list and Workbench's Plan stage. No native chats, reviews or external messages were launched.
- No document-level horizontal overflow and no uncaught page errors were observed in these states. Screenshots were visually inspected for wide/light and narrow/dark layouts.
- Normal product stores and installed plugins were not used. Previews used disposable data and host simulations; external browser requests were blocked. Native Codex activation/handoff, screen readers, Safari/WebKit, physical touch devices, browser text-only scaling, large-data performance and every error/integration state were not exercised by this audit.

## P1 findings

### A11Y-01 — Active placeholder and unselected field text has insufficient light-theme contrast

**Products:** all three. **Category:** Accessibility / Theming.

**Locations:** [packages/ui/index.jsx:5](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/packages/ui/index.jsx#L5), [plugins/shelob/app/Modals.jsx:16](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/shelob/app/Modals.jsx#L16), [plugins/sauron/src/app/InboxView.tsx:43](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/sauron/src/app/InboxView.tsx#L43), [plugins/sauron/src/app/InboxView.tsx:52](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/sauron/src/app/InboxView.tsx#L52), [plugins/workbench/app/App.jsx:214](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/workbench/app/App.jsx#L214) and [plugins/workbench/app/App.jsx:23](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/workbench/app/App.jsx#L23).

The active input/textarea placeholders resolve to `rgb(143,143,143)` at opacity 1. Shelob's PR URL and Workbench's task description are **3.23:1** against white. Sauron's personal-task placeholder is **3.10:1** against the composer background `rgb(250,250,250)`. Impeccable also measured Sauron's search placeholder at approximately **3.2:1**. Axe separately identified Workbench's “All repositories” text at **3.23:1**, 14px normal weight.

**Impact:** low-vision users have difficulty reading active field guidance and the repository filter. The fields were enabled; the disabled-control exception does not apply. WCAG's normal-text contrast threshold is 4.5:1 and includes placeholders. [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Reproduce:** use the default light palette, open New review / Add task / New task with empty fields, and inspect their `::placeholder` computed color and effective background. In Workbench's board, inspect the unselected repository filter.

**Recommendation:** supply an accessible shared placeholder/unselected-text token or variant for active controls, with a minimum 4.5:1 ratio against each supported surface. Retain separate disabled styling and recheck actual host-provided variables. This was found by rendered Impeccable plus computed-style verification; axe alone did not report the placeholders.

**Suggested command:** `$impeccable harden shared input and select contrast`.

### SHELOB-01 — Previous-attempt disclosure is below the minimum pointer target/spacing

**Category:** Accessibility / Responsive. **Location:** [plugins/shelob/app/App.jsx:26](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/shelob/app/App.jsx#L26); `.previous-reviews > summary` styling in [plugins/shelob/app/app.css:10](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/shelob/app/app.css#L10).

At 1440px in both themes, the “1 previous attempt” target measures **235 × 16.5px**. Axe reports only **16.6px** of safe clickable space to the closest neighboring target, so the spacing exception does not rescue its short height.

**Impact:** users with reduced pointing accuracy can open the wrong review or miss the disclosure. The control reveals older runs and is not inline prose. WCAG 2.5.8 requires a 24px minimum target or a valid exception; 44px is not the AA threshold. [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

**Reproduce:** open the populated Shelob preview at 1440px with grouped review attempts; measure the disclosure and its neighbors.

**Recommendation:** give the summary an explicit minimum clickable height of at least 24px, adequate padding and separation, while preserving the compact review rail. Recheck both themes and keyboard activation.

**Suggested command:** `$impeccable adapt Shelob review-history controls`.

### WORKBENCH-01 — Merged badge text misses contrast in the default light palette

**Category:** Accessibility / Theming. **Location:** [plugins/workbench/app/App.jsx:40](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/workbench/app/App.jsx#L40) and the semantic status color mapping used by its `Badge`.

The enabled Done card's “Merged” label renders as `#008635` on `#d9f4e4`, **4.03:1**, at 14px normal weight. Axe reproduced the failure in light-mode board views. The text is too small to use the large-text exception.

**Impact:** the completion state is harder to read for users with low vision. Its status matters even though the badge itself is not a button. [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Recommendation:** choose a darker semantic success foreground or a compatible background variant that reaches at least 4.5:1, retaining textual state and verifying dark mode as well.

**Suggested command:** `$impeccable colorize Workbench status contrast`.

### WORKBENCH-02 — Repository Select renders a focusable text input inside its button-like trigger

**Category:** Accessibility / Implementation. **Locations:** [plugins/workbench/app/App.jsx:23](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/workbench/app/App.jsx#L23) and [plugins/workbench/app/App.jsx:215](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/workbench/app/App.jsx#L215).

Passing `id` and `name` to the SDK Select results in a `span[role=button][tabindex=0]` containing `input#task-repository`. The nested input is **type=text**, with `tabindex=-1` and `aria-hidden=true`; it is not an HTML hidden input. Axe's `nested-interactive` rule reproduces this in both themes at all three tested form widths.

**Impact:** nested interactive semantics can create unexpected screen-reader focus and ambiguous control behavior. A negative tabindex and `aria-hidden` do not make this equivalent to a noninteractive `type=hidden` form value. Actual screen-reader behavior still needs testing; the rendered structure and automated failure are verified. The rule maps to WCAG 4.1.2. [Deque nested-interactive rule](https://dequeuniversity.com/rules/axe/4.14/nested-interactive).

**Recommendation:** use a Select integration with one interactive trigger and a genuinely noninteractive hidden form value outside it, and associate the visible label with the trigger. Verify its accessible name, keyboard selection and form submission after the change. Avoid a CSS-only hiding fix.

**Suggested command:** `$impeccable harden Workbench repository selection`.

## P2 finding

### SAURON-01 — Local preview does not apply the initial system theme

**Category:** Theming. **Locations:** [plugins/sauron/src/app/controller.ts:37](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/sauron/src/app/controller.ts#L37) and [plugins/sauron/src/app/InboxView.tsx:35](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/sauron/src/app/InboxView.tsx#L35).

With `prefers-color-scheme: dark`, local preview initializes its state and toggle as dark (the button says “Switch to light theme”), but the document has no `data-theme` and still renders a **white** background. The click handler applies the DOM theme only after an explicit toggle. Setting the theme through that control does produce the correct dark palette.

**Impact:** local previews and visual checks can show a light interface while claiming dark state. This is a verified preview initialization defect. Native MCP host context applies its own theme through the client; this audit does not establish a native-host defect.

**Recommendation:** synchronize the initial local-preview theme with the document, and keep the state and theme attribute consistent when system preference or explicit selection changes. Preserve host-driven theming for embedded mode.

**Suggested command:** `$impeccable harden Sauron preview theming`.

## Verification follow-up: keyboard access to code evidence

At 320px, axe flags Shelob's horizontally scrolling evidence `pre` in both themes. [plugins/shelob/app/Report.jsx:20](https://github.com/fadamakis/ai-tools/blob/71dbd16eb292e4ec6046aaae5c0ff73054854bdd/plugins/shelob/app/Report.jsx#L20) gives that region neither an explicit tab stop nor a focusable child. The rule specifically addresses browsers such as Safari that do not automatically add scrollable regions to the focus order. This is a source-backed cross-engine concern, not a reproduced native Codex failure. [Deque rule documentation](https://dequeuniversity.com/rules/axe/4.14/scrollable-region-focusable).

Check keyboard scrolling in WebKit and the actual host. If it cannot be reached, add an appropriately named keyboard-focusable scroll region and a visible focus indicator. Suggested command: `$impeccable harden Shelob code evidence`. This concern is excluded from the five verified-defect count pending that interaction check.

## Performance observations

| Product | Inline HTML bytes | Gzip bytes for comparison |
| --- | ---: | ---: |
| Shelob | 3,126,066 | 1,270,388 |
| Sauron | 2,979,483 | 1,543,243 |
| Workbench | 1,783,435 | 461,677 |

The gzip figures are size comparisons, not a claim that the MCP host transmits these resources with gzip. The UI bundles are self-contained and avoid external font requests. Initial Chromium observations included main-thread tasks of approximately 84–109ms; repeated viewport records of the same navigation were not treated as independent samples. These instrumented observations are not clean product benchmarks, and they do not establish which work caused each task. No sustained animation or scrolling performance defect was established. Native timings, large stores and a representative-device profile are still needed before setting a performance budget or selecting a bundle-splitting change.

## Detector findings that were not accepted as product defects

- Shelob's source `side-tab` warning identifies the proposed-rewrite section's accent border. That visual distinction separates a proposed comment from the user's draft; a technical defect was not established. No detector waiver was added.
- Workbench's rendered `tiny-text` warning targets the synthetic browser host's `#host-status` banner, outside the shipped app iframe. It is excluded from product findings.
- Sauron's two `straggler` advisories concern synthetic, variable-length task copy. They do not establish broken layout or a reason to edit user text.
- Immediate focus sampling initially saw Workbench's body during dialog teardown. Delayed checks reproduced correct focus restoration after both mouse and keyboard opening, so no focus-loss defect is reported.
- Axe returned incomplete contrast checks for decorative glyphs and pseudo-element-backed buttons. Those were not converted to fabricated passes or automatic defects. A full manual contrast sweep remains part of accessibility acceptance.

## Practices to preserve

- Visible labels, useful accessible names, stateful controls and semantic task/review structures are widespread.
- Shelob and Workbench modal forms trap focus and restore their opener; Sauron's inline composer focuses its task field without imposing a modal trap.
- Light/dark layouts, narrow reader transitions and Workbench's stage picker keep document width within the viewport in the tested cases.
- Reduced-motion rules accompany persistent textual status and busy feedback. No task-critical animation was found.
- Product state and host capability limits remain explicit. The tests used synthetic records and did not substitute simulated handoff for native proof.

## Recommended sequence

1. **P1 — `$impeccable harden`** the shared active field contrast and Workbench Select integration.
2. **P1 — `$impeccable adapt`** Shelob's previous-attempt target size.
3. **P1 — `$impeccable colorize`** Workbench's success badge contrast.
4. **P2 — `$impeccable harden`** Sauron's initial preview theme and verify the Shelob code-scroller concern in the target engine.
5. Run the affected interaction/accessibility checks, then **`$impeccable polish`** for the final consistency pass.

These can be addressed one at a time, together or in another chosen order. Re-run `$impeccable audit` after fixes. The audit request itself did not authorize implementing the recommendations.
