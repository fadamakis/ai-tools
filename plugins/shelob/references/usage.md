# Shelob

A local Codex plugin for reviewing local changes or someone else's GitHub PR. Shelob combines native Codex correctness review, deterministic checks, and your selected rules in one report. Reports appear in a native app and are saved as standalone HTML and JSON.

Requires Node 22.13 or newer and an authenticated Codex CLI. Shelob prefers the desktop’s bundled CLI (`CODEX_CLI_PATH`), then `codex` on PATH. GitHub PR reviews require the GitHub CLI (`gh auth status`) and repository access. Git is needed for local changes and the local-copy PR option. The shipped SDKs and app are already bundled; no npm install, model API key, or hosted service is required. The baseline rules cover size/focus, independence, test protection, PR communication, and useful visual evidence.

## Codex sidebar and conversation tab

Open **Shelob** from Codex's sidebar to see the review form and history. Opening a saved report is explicit; **All reviews** returns to the form and history. Choose a review source before submitting:

- **PR only** (default): reads the diff and changed files directly from GitHub, without a Git fetch or a repository copy. It caches only the changed-file snapshots needed for the report and evidence. Source inspection is limited to files in the PR.
- **Local copy**: fetches an isolated Git repository for access to related code outside the PR. It does not check out files, run project code, or change your working checkout.

A new PR opens its own conversation. Both modes review the pinned head against its merge base and check at finalization whether the PR changed. Local-copy reviews use the base repository's PR ref for fork heads. PR-only reviews read the base and head repositories through the API using the authenticated user's access. Only github.com URLs are supported in this release.

The report names the selected mode, and reruns preserve it. In the original PR conversation, use the review-source selector beside Rerun to switch modes, including while an older local copy is still preparing. If PR-only review needs unrelated source to reach a conclusion, that check stays unresolved; ask for a local-copy rerun in the original conversation to review that context. There is no automatic switch or background Git fetch. Missing or truncated API source is explicitly incomplete. PR-only limits are 200 changed files, 1 MiB per source file, and 16 MiB of changed source in total.

New PR requests default to PR-only even when a tool call omits the mode. Older saved requests retain their original mode. If a local-copy fetch times out, choose **PR only** in the original conversation and rerun to collect a fresh snapshot without Git. The failed run stays in history. Its recovery screen offers **Review PR only** and **Retry local copy**, preserving the selected rule pack. Technical diagnostics sit under a disclosure.

For local changes, open the **Review report** tab in the coding conversation or ask “Use Shelob to review my local changes.” The **Review local changes** button asks that conversation to resolve the repository, run the checks, review the context, and show the report. Questions and reruns stay in that conversation.

The server saves the initial scan, then the review conversation explicitly calls `shelob.code_review`. This launches one bounded native `codex exec review` pass using the configured Codex review model and authentication. The conversation validates those findings and checks your selected contextual rules. There are no scheduled reviews. If that review stops, the initial report remains available with unchecked rules. **Continue review** resumes an unfinished run; **Rerun review** creates a new run and snapshot. History opens saved reports; it cannot navigate to an older conversation with the current host SDK. Continue and rerun in the current review chat to preserve discussion. From saved history, **Continue in new chat** explicitly resumes an unfinished snapshot in a new review chat; **Review again in new chat** creates a fresh snapshot. These actions never send work into an unrelated active chat. Repeated form submissions start a new attempt. History groups attempts by PR (or local repository, branch, and scope) and keeps previous immutable reports under a disclosure.

After updating Shelob, fully quit Codex with Command-Q and reopen it before launching the sidebar. A running conversation can retain the previous MCP server even after the installation changes. Shelob uses a stable app resource address and accepts older versioned addresses, so cached entrypoints remain readable by the new server.

The native app follows Codex's theme and advertises separate global and conversation entrypoints. Launch buttons require the host's OpenAI messaging extension; without it, reports remain readable and the skill is still available. An older Codex build may require an update before sidebar entrypoints appear. The standalone scanner below remains usable independently.

The app and exported report share the Shelob spider logo, system typography, neutral surfaces, and small plum accents for selection and review progress. The sidebar uses a simplified monochrome spider. Verdict colors retain their review meaning. The standalone logo is embedded in the HTML; exports need no external image or font requests.

The standalone theme follows the system until you choose light or dark. The sun/moon button then switches between those two themes and remembers the choice when browser storage is available. The review gauge animates once on display, with a static final value for reduced-motion preferences and printing. Embedded reports continue to follow Codex's theme.

## Combined review

Every new managed review includes a **General code review** check alongside the selected pack. Codex looks for concrete correctness, security, data-loss and contract problems even when no custom rule covers them. It receives the pinned selected rules as guidance. The visible chat then validates native candidates, inspects supporting source when needed, and audits the remaining contextual rules. It does not repeat a second full correctness review.

The native pass reads a JSON bundle containing the exact before/after changed files, diff, description and selected rules. It does not run against your live checkout. This preserves staged, unstaged and branch scopes, excludes untracked files, and works in PR-only mode without a repository download. Repository instructions remain data inside the bundle. Codex runs with a read-only sandbox, plugins, Apps and lifecycle hooks disabled, and discovered MCP servers disabled for that invocation. It cannot use Shelob’s publication tools. The bundle is capped at 16 MiB; binary, inaccessible or partial input cannot pass silently.

Native review is limited to changed files. The chat can inspect related source with Shelob’s source tools in local and local-copy reviews. PR-only judgments that require unavailable context stay unchecked. A completed process is not a pass: finalization also requires a source-validated general assessment bound to the exact saved native output digest. Failed CLI authentication, unsupported models and timeouts remain failed; interrupted runs remain interrupted. An explicit rerun creates a new snapshot; repeated calls for the same run do not launch or bill a second native pass. Shelob never silently changes models. The user can explicitly choose a model for the native call when CLI configuration requires it.

Findings carry **Codex review**, **Code scan**, or **Rule: ID** provenance. The reviewing chat can identify repeated causes using explicit references. Shelob shows one comment, retains both sources and the strongest severity, and links the other check to it. Different issues on the same line stay separate. Only supported High findings block approval; missing review coverage still prevents a green verdict.

Report schema **1.2.0** adds native review coverage and finding provenance. Older 1.0.0 and 1.1.0 reports remain readable. Existing saved runs are historical evidence; unfinished runs from older engines need a fresh snapshot.

## Run the scanner

```sh
node scripts/shelob.mjs check --repo /absolute/path/to/demo-repo --base main --scope all --output /tmp/shelob-review-001 --open
```

The standalone scanner remains a rules-only fallback; it does not launch native Codex review. Run from this plugin directory, or use the absolute script path. Both `report.json` and `report.html` are written; `--format json` additionally prints JSON to stdout. Existing reports are never overwritten.

| Scope | Selected tracked change |
| --- | --- |
| `all` (default) | Merge base to working tree: committed, staged, and unstaged tracked changes combined |
| `branch` | Merge base to HEAD; excludes uncommitted changes |
| `staged` | HEAD to index; excludes unstaged edits |
| `unstaged` | Index to working tree; excludes staged and committed changes |

`all` and `branch` need an existing local base, inferred from origin/HEAD or main/master if omitted. No fetch occurs. Untracked files are listed as unassessed, not read or silently included. Renames are represented as delete/add pairs. Binary and oversized sources have visible inspection limits. A repository needs an initial commit.

## Review with the plugin

Ask: “Use Shelob to review my local changes against its rules and show the HTML report.” The `shelob-review` skill runs the scanner, inspects applicable contextual rules, validates source references, and creates a final report. It does not edit code, execute project tests, or submit GitHub reviews. PR comments and approvals require their own explicit confirmation in the report.

The scanner leaves contextual rules unassessed. The reviewing agent can supply a JSON file matching `schemas/assessments.schema.json` and rerun the same command with `--assessments FILE` and a fresh output directory. Results must match the exact snapshot and cannot override deterministic checks. Source locations and snippets are checked. Logical correctness of the agent's judgment is not mechanically proven.

Both views share expandable checks grouped into **Needs attention**, **Passed**, and **Not checked**, with **Not applicable** when needed. Counts refer to review checks, including general review, rather than individual findings or test results. Passed means the review method found no issue; missing context and failed scans remain unchecked. There is no numeric quality score. Category buttons, search, and severity filters narrow the checks; evidence, next steps, changed files, and run details expand in place. The standalone HTML has a theme icon and a JSON download in Run details; the embedded app follows the host theme.

The verdict separates progress from the recommendation:

- **Approve** or **Approve with notes** (green): all applicable checks completed, source is current, and there are no High findings. Medium and Low notes never block approval.
- **Request changes** (red): one or more High findings establish an important issue or violate an explicitly blocking rule. Unfinished checks remain visible alongside the blockers.
- **Approval pending** (plum) or **Approval blocked** (yellow): required work is pending, coverage is unchecked, source was skipped, or PR freshness cannot be established. These states do not approve the change.

Execution is displayed separately: **Completed · PR-only**, **Completed · Local copy**, or **Completed · Local changes** means the required steps within that scope finished. Missing context and visual evidence remain under **Coverage limitations** and still block approval. **Incomplete** means a required step was not finished; failed, interrupted, and pending execution retain their own states. CLI-only reports identify their narrower **Code scan** or **Rule review** scope. Older reports recover completion from their saved assessments; absent execution evidence stays incomplete. Historical JSON, assessments, snapshots, and existing HTML exports are not rewritten.

Every finding has a severity: **High** (`error`, blocking), **Medium** (`warning`, nonblocking), or **Low** (`info`, nonblocking). Contextual findings can set severity individually according to concrete impact. A rule explicitly configured as `error` cannot be weakened. The baseline's deterministic signals remain advisory. The gauge measures checks reviewed, not checks passed or code quality. Finalization saves a report; it does not turn unresolved checks into passes. Older reports retain their recorded evidence and receive the same honest presentation.

**Review and send** appears below the execution, approval, and coverage summary. Every finding has a visible editable comment, severity, selection checkbox, evidence link, and individual Post comment action. Select several comments or Select all, then use **Post selected (N)**. Drafts and selections survive refreshes within the app session. Posted comments display their GitHub link and the exact sent text; they cannot be selected again.

**Post selected** submits one GitHub `COMMENT` review containing the selected comments. Comments with a valid changed-line anchor are inline; comments about related source or without an anchor appear in the review summary. Both before/after diff sides are supported. The submitted review is pinned to the reviewed head. Selected comments, target PR, review summary, and exact inline locations appear in a separate confirmation before anything is sent. A batch is limited to 50 comments.

**Approve PR** is a separate action. It can include selected nonblocking comments, but is available only for a completed, current review without High findings or unresolved checks. The confirmation explicitly says it submits a GitHub approval and requires **Confirm approval**. Posting comments never implicitly approves. GitHub's account permissions and review restrictions still apply. Neither path submits request-changes reviews or merges the PR.

Both confirmation previews expire after five minutes. Head/base commits and description are checked at preview and immediately before submission. Persistent run-level locks and finding/approval receipts prevent duplicate batches, concurrent sends, or overlap with older individual-comment actions. Unknown delivery is never retried automatically; check GitHub first. The original reports stay immutable.

Publishing tools are app-only MCP tools, hidden from the review model. Reviewing a change does not authorize publishing: the user confirms each selected batch or approval in the report. Standalone HTML and local reviews expose visible drafts, selection, and batch copy; posting and approvals require Shelob's connected Codex view and the existing GitHub CLI login. Nothing is sent during scanning, finalization, history opening, or export. An older unfinished engine snapshot needs a fresh run after an upgrade; its original report remains available.


## Rule packs

Open **Rules** in Shelob’s top bar to list, search, edit, or add rules. Edit a rule’s name, category, severity, file patterns, and rationale. Automatic checks expose their supported numeric limits. New rules use **Codex** review and include instructions describing what to check; they cannot run custom code. High severity blocks approval; Medium and Low remain notes.

**Save changes** and **Add rule** save your personal library under Shelob’s application-data directory, outside the plugin installation. New managed local and PR reviews use these rules by default. An external pack selected in the review form or `shelob.start` takes precedence. Every run gets its own rules copy before source preparation; edits never change a running or historical review. Concurrent windows must reload after another window saves. Saved revisions survive restarts and plugin updates.

The standalone CLI still defaults to the baseline. Use `--rules` with an external pack or the saved `rules/current.json` in Shelob’s application-data directory to select that library explicitly.

The baseline is `rules/baseline.json`. `--rules FILE` selects an external pack, so reviewed repositories need no configuration changes. A pack has an ID/version, exclusions, and scoped rules. Each review selects one explicit pack; automatic rule inheritance/merging is not implemented.

Deterministic checks: change size, top-level area spread, introduced skip/focus markers, net assertion reduction, and recognizable weakened verification gates. Thresholds are configurable advisory values, not hard limits. Contextual rules assess independence, meaningful test coverage, a supplied description, and relevant visual evidence. Add a description using `--description-file FILE`.

JS/TS and Python test signals use a lexical heuristic. They do not fully parse the languages, establish behavioral coverage, or recognize every test framework, dynamic construction, assertion helper, or gate configuration. Source inspection is bounded at 1 MiB per file and 200 changed files; errors and incomplete checks are explicit. Missing context is never converted into a pass.

## Data and writes

The scanner reads local Git metadata, selected before/after source, an explicit pack, and any supplied description/assessment files. It performs no network or model calls and never executes target-repository code. Git uses no optional locks, external diff drivers, or text conversions. It writes only to the explicit output directory outside the reviewed repository, including when symlinks are involved. Reports contain local paths, source snippets, patches, and supplied draft text; they remain local until the user chooses otherwise.

Contextual review uses the host's model and data policy. Only the standalone deterministic scanner is offline. No telemetry is included.

Managed reviews are stored outside the plugin installation under `~/Library/Application Support/Shelob` on macOS (`~/.local/share/shelob` elsewhere). `SHELOB_DATA_DIR` overrides this location for testing or explicit configuration. Runs contain manifests, pinned rule packs and PR descriptions, native input/output receipts, isolated Git objects when selected, and immutable initial/final reports. New runs populate history; earlier CLI reports remain independently readable. Report schema 1.2.0 includes native review coverage, local/PR provenance, and PR freshness; the renderer also reads 1.0.0 and 1.1.0 reports. Contextual assessments retain schema 1.0.0.

No automatic rule mining, code edits, fixes, automatic approvals, request-changes submissions, or merges are included. Posting comments and submitting approvals are separate confirmed app actions. Reports are advisory assessments, not approval to merge. A changed PR or failed freshness check cannot produce green approval.

## Remove

For a local Codex installation, use `codex plugin remove shelob@MARKETPLACE`. Remove generated report directories separately when no longer needed; uninstalling the plugin does not delete evidence or touch reviewed repositories.


## PR decisions and review model (0.9.0)

The history shows approval guidance, comment guidance, and a next step for each
PR. Execution failures include the saved error in the report. A rejected model
means the review needs attention; it is not presented as a code defect.

Approval still requires current source, completed native review and rule
coverage, and no High findings. Optional comments do not prevent approval.
Mechanical size, area, and assertion-count signals appear under Advisory checks
and are excluded from Select comments. They remain available for inspection and
individual selection; High findings are never moved into this advisory group.

Use **Mark as discussed** to record your own decision about a comment. This is a
local marker, not automatic synchronization with GitHub discussion threads. It
survives reopening the saved review and can be restored. It does not clear a
blocking finding or incomplete coverage. Posted and uncertain delivery receipts
remain separate from these markers.

**Settings → Review model** saves a model for new native reviews without editing
Codex configuration or the chat model. Blank uses the CLI default. Each new run
pins the saved choice. An explicitly user-selected model passed to code_review
can override that choice. Compatibility is established by a successful native
review, not a guessed model list. A saved unsupported-model failure prevents
another invocation with the same model and CLI/configuration fingerprint;
changing the model or CLI/configuration allows a new attempt. If account access changes, explicitly allow a fresh attempt in Settings. No automatic model
fallback or PR rerun occurs.

Existing saved reports are read as before and are never rewritten by this UI.
There is no migration. New optional files are settings.json and
review-setup-failure.json at the Shelob data root, plus discussed/ markers inside
a run directory. Markers apply to that saved run only, so a new PR snapshot does
not inherit a decision about older source. Posting and approvals retain their
existing explicit confirmation and freshness checks.

### Codex executable selection

Native review honors an explicit `CODEX_CLI_PATH`. On macOS, when the MCP server does not inherit that setting, Shelob uses an installed ChatGPT or Codex desktop app CLI before falling back to `codex` on PATH. The selected model does not change. Rejected-setup detection fingerprints the resolved executable, so replacing or upgrading the CLI permits a fresh attempt without deleting saved reports. Existing review history needs no migration.

## Apps SDK UI (0.10.0)

Home opens your grouped saved reviews. **New review** opens the launch form. The report pairs a check list with evidence, discussion markers and editable comments. Narrow windows use **Back to checks**. New standalone exports share this interface and remain readable offline and without JavaScript. Existing HTML files are unchanged.

All 0.9.1 review, model, CLI resolution and publication behaviour is retained. No saved-state migration is required. See [UI compatibility and release recovery](ui-and-recovery.md).


## Inbox workspace (0.11.0)

Reviews stay in a left rail while the selected report opens beside them. Each pane keeps its own position. On mobile, Back to reviews restores the selected row. The compact report header shows one next action; Checks opens a grouped picker with search and optional filters. Prepare comment opens an editor beside its evidence. Ask Shelob to rewrite returns a proposal for explicit Apply, without starting another review or replacing your draft.

Settings includes **Approve fully reviewed PRs with no findings**. This is off by default for new installations. When explicitly enabled, automatic approval runs only as a current-version review first finishes: native review and all applicable checks must complete, no findings may remain, and the publisher must recheck the exact PR head, base and description. Reading or re-finalizing saved completed history never triggers approval. Failures, source gaps, unchecked context and uncertain delivery stop automatic approval. Attempts have durable claims and delivery receipts; uncertain delivery is never retried automatically. Notes and comments keep the existing manual preview and confirmation flow.

The approval policy and rewrite proposals use additive local JSON sidecars. Existing reviews, model settings and saved exports need no migration. See [UI and recovery](ui-and-recovery.md).


## Live UI connection and read-only preflight (0.11.8)

Settings shows the current window's connection ID, plugin version and store fingerprint. The rendered MCP app acknowledges a server-issued resource nonce and renews an owner-only connection sidecar every 15 seconds. Only visible windows count; receipts expire after 45 seconds and are rejected when the owning server has stopped. A separately started stdio worker gets its own server instance ID and can read the UI's receipt from the same store through `shelob.preflight`.

Preflight compares the existing store directory's canonical filesystem fingerprint, the UI/server runtime fingerprints, current policy revision and server liveness. It returns a read-only policy summary and optional exact `{ repository, prNumber, headSha }` history. No paths, credentials or resource nonces are returned by preflight. No review, rule, setting or publication action changes. Multiple live windows require an explicit connection ID. An absent acknowledgment never defaults to a successful match.

The app-only acknowledgment uses the MCP host's app routing; it is an application handshake, not adversarial OS attestation. Workers must not call it or simulate a host. An automated browser fixture proves the handshake implementation, not that a user's actual Codex panel is connected. After installation, restart/reopen Shelob in Codex and keep its panel visible to obtain native proof. Preflight remains blocked until that acknowledgment and disabled approval policy are both current.

History covers this store only and reports unreadable runs instead of silently declaring no duplicates. `skip_completed` preserves an unchanged completed review; `join_active` avoids overlapping work. Cross-watch/private/task-local history still needs its own deduplication. Recheck preflight immediately before finalization under a no-public-actions watch.
