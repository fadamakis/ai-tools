# Compatibility and migration

## Before replacing a live installation

Compare the current source and installed build with the selected release receipt and version. Capture build fingerprints and back up user data. Run the new version against a disposable copy of that data before changing the installed runtime. Release receipts contain package fingerprints, not user records. Preserve original source, installed runtime, and data until the replacement is verified.

## Shelob

Baseline: 0.11.3. Keep `SHELOB_DATA_DIR` and the existing per-user Shelob application data location. Historical saved reports, rules, settings, decisions, and publication receipts stay readable. Completed reports and HTML exports are not rewritten. An incomplete older-engine review may need a new run; do not mark it completed because an update installed.

### Shelob 0.11.8 connection preflight

No review/report/settings schema migration is introduced. Existing store identity and policy remain unchanged. The fingerprint uses the existing canonical directory and filesystem identity; it creates no store ID or credentials. New optional `ui-connections/*.json` sidecars record only a rendered app acknowledgment, server identity, runtime/version fingerprints, policy revision and bounded freshness. These do not modify reports, rules, decisions, receipts or approval settings. Older versions ignore them. Preflight reads never register or renew a UI connection.

Verify old and candidate readers against disposable saved-state copies before local installation, and compare original store hashes afterward. No source or installed-cache files should be edited in place to deploy. A local installation must use Codex's supported installer. Native activation and identity proof remain a separate step after packaging/tests; do not substitute a test-host receipt for the real user panel.

## Workbench

### Content-bound delivery and recovery

Version 0.4.0 retains board schema 1, the existing data directory, task and repository IDs, chat links, notes, launches and archives. Requirements, content snapshots, required-CI observations, publication attempts and remote-run observations are optional versioned additions. No data migration or relocation is required.

Reads normalize legacy evidence in memory without rewriting the board. Missing fingerprints remain historical or unbound; they do not become current verification after installation. Verification and independent review retain separate snapshots. Publication can rebind proof across a commit only when tested content and base remain unchanged.

Before installation, back up the current board and compare old and candidate readers against disposable copies. Preserve any uncertain publication attempt and its receipts; updating or restarting the plugin never grants permission to retry an external action. Remote bindings and refreshes update local observations only. Reopen the panel after installation and confirm the server and UI both show the selected version.

### 0.3.0 reliability update

Schema version 1, task IDs, chat ownership, archives and note locations remain unchanged. Reads normalize old flat evidence in memory; each updated verification/review kind is saved with its own result, timestamp and optional HEAD in `evidenceChecks`. The legacy `evidence` summary remains readable. A shared legacy HEAD is omitted when the two records have different or unknown revisions. Reads never rewrite board files or notes. Markdown remains the narrative record for scope, decisions, commands and working-tree evidence; structured checkpoints own progress and check results.

Before installing 0.3.0, back up the board and stop all old Workbench server processes. Do not run old and new writers concurrently. If an old `.write-lock` file remains, use the packaged offline helper:

```sh
node PLUGIN_ROOT/scripts/migrate-lock.mjs --root "/absolute/path/to/Workbench Preview" --confirm-writers-stopped
```

The helper retains the old lock under a unique diagnostic filename and refuses recovery when its recorded PID is alive. Empty or malformed legacy locks require the same explicit stopped-writer confirmation. It never modifies board data. New locks use an atomic directory, 60-second staleness and 10-second heartbeats; after a crash, a fresh lock can remain unavailable for up to a minute. Never remove a live lock manually. Interrupted saves leave a complete old or new board file.

Unresolved launch requests gain an explicit app-only recovery action after the user confirms no delivery. The original request and recovery receipt remain saved. Recovery sends nothing; a subsequent launch has a new ID and defaults Autopilot to off. Worker confirmations carry an optional exact launch request ID so late startup can be attributed without taking over another confirmed worker.

For rollback, publish a newer release retaining compatible persistence and evidence readers rather than restoring an old database/board over newer decisions. Native activation and chat launch/resume still require their own checks after reopening Codex.

Initial promoted version: 0.2.0, combining Preview 0.1.13's board with all 13 workflow skills. The original skills' newer monitoring, visual-evidence, and supported activation guidance is retained. Plugin identity becomes `workbench`; existing `workbench.*` tool names remain. The old `ui://workbench-preview/...` resource namespace remains valid.

Keep the existing `WORKBENCH_PREVIEW_DATA_DIR` override and macOS `~/Library/Application Support/Workbench Preview/board.json` default. Schema version 1, task IDs, repository IDs, revisions, archive metadata, chat links, launches, notes, and evidence stay intact. Future worker continuity remains in `<git-common-dir>/workbench-preview/`; original `workbench/` notes remain read-only historical import sources. No automatic note migration, import, chat creation, or Autopilot activation occurs on installation.

For workspace import, keep listing identity in a separate private catalog as described in [workspace setup](workspace-setup.md). After native acceptance, disable duplicate local Workbench/Preview installations through the supported plugin UI; retain their data. Do not edit installed caches directly.

## Sauron

Baseline: 0.6.6. The portable runtime defaults to `~/Library/Application Support/Sauron/attention.sqlite` on macOS, outside any versioned plugin directory. `ATTENTION_DB` still takes precedence. Existing tool names and resource aliases remain readable. Database schema 3 remains in use. A newer unknown schema is rejected before table writes.

Existing personal adapters point to a development database and must not be shared. To move an existing database, stop Sauron and its scheduled writers, then run:

```sh
pnpm sauron:migrate --from /absolute/path/to/existing.sqlite --confirm-writers-stopped
```

Use `--to /absolute/path/to/new.sqlite` only for an intentional custom destination. The migration checks schema support, takes a consistent SQLite backup including committed WAL data, checks database integrity, and compares all tables and the schema version. It refuses to overwrite or merge a destination and retains the original source. Store identity, decisions, history, reply drafts, and uncertain-delivery receipts must match. It does not send replies or refresh external sources.

Once verified, use the new plugin and update any existing local attention schedules to the portable `dist/server/check-attention.js` command, preserving their existing cadence and intent. Its mode-aware behavior remains unchanged. The packaged `dist/server/sync-attention.js` uses the same durable database. Installing the plugin never creates schedules. Keep the old database until the pilot is accepted.

## Recovery

For a code-only regression, revert the offending source commit on `main`. Passing CI republishes the previous behavior under newer patch versions. Independent users refresh the marketplace and installed product as described in [updates](updates.md); workspace admins can select **Sync now**. Reopen panels or restart Codex afterward. Do not reset the `releases` branch or force older version numbers.

A data migration must document forward/backward compatibility and backup recovery before release. Never automatically downgrade databases or delete records to make older code start. If a migration is incompatible, stop writers and restore a separately verified backup as a deliberate recovery action.
