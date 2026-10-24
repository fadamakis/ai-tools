# UI and release recovery

Shelob 0.10.0 replaces the previous renderer with Apps SDK UI. Home opens saved review history; New review opens the launch form. Reports show a check list and a detail pane with evidence and editable comments. Narrow windows use Back to checks. New HTML exports share this renderer and remain readable without JavaScript, printable and copy-only.

## Compatibility

There is no data migration. Store version 1 and report schemas 1.0.0, 1.1.0 and 1.2.0 remain readable. Opening a report does not rewrite its evidence. Existing HTML exports are unchanged.

Review execution, coverage and approval readiness remain separate. Discussion markers do not clear blockers. Bulk comment selection excludes advisory, discussed and receipted comments; advisory comments remain individually selectable. Posting and approval keep their explicit preview, confirmation, freshness and receipt checks.

Review-model preferences, rejected-setup protection and the 0.9.1 desktop CLI resolver are retained. Existing unfinished reviews from an older plugin version still require a fresh review under the existing snapshot policy. A UI release does not make older unfinished evidence current.

## Recovery

The source workspace retains application-only backups under `dist/releases/0.10.0/`:

- `shelob-0.9.1-source-build.tar.gz`
- `sauron-0.6.1-source-build.tar.gz`
- `baseline.json` records source and saved-state fingerprints.

From the source workspace, keep a copy of the recovery utility outside the application trees, then restore Shelob:

```sh
cp scripts/restore-release.mjs /private/tmp/restore-sauron-shelob-release.mjs
node /private/tmp/restore-sauron-shelob-release.mjs --product shelob --archive dist/releases/0.10.0/shelob-0.9.1-source-build.tar.gz --target /absolute/path/to/codex-plugins
```

Restore Sauron independently with:

```sh
node /private/tmp/restore-sauron-shelob-release.mjs --product sauron --archive dist/releases/0.10.0/sauron-0.6.1-source-build.tar.gz --target /absolute/path/to/sauron
```

The recovery utility restores only application trees. It never restores or deletes Shelob's Application Support data, Sauron's `.data` directory, or Codex automation configuration. Keep the recovery utility available outside the target's scripts directory if restoring both products in succession; restoring Shelob also restores its older build scripts.

After recovery, package the restored Shelob source with `node scripts/package.mjs`, then reinstall `shelob@shelob-local` using the existing registered marketplace. For Sauron, regenerate its local adapter with `npm run prepare:local-plugin`, then reinstall `sauron@personal`. Reopen the plugin; a desktop restart may be needed if an existing MCP server still holds an older bundle in memory.

Recovery is tested against temporary application copies with a separate saved-state sentinel. It does not downgrade live review data or task decisions.


## Shelob 0.11.0 recovery and compatibility

The inbox workspace keeps history beside the report, uses a compact next-action header, and moves check search/filtering into a picker. Model selection, the Codex executable resolver, review calculations, source snapshots and manual publication receipts remain compatible. The saved report schema is unchanged.

Two additive data types are introduced: `approval-policy.json` records the user-enabled clean-review approval setting, and per-run `comment-suggestions/` files store proposed rewrites. Per-run `auto-approval.json` and its claim record prevent automatic retries. None rewrites an existing report or model setting. Other installations default to automatic approval off. This user's installation is enabled only because they explicitly requested it. A clean review requires zero findings, successful native review, full applicable coverage and immediate PR freshness checks; opening saved history cannot approve it.

For application-only recovery to 0.10.0, keep the recovery utility outside the source tree:

```sh
cp scripts/restore-release.mjs /private/tmp/restore-shelob-release.mjs
node /private/tmp/restore-shelob-release.mjs --product shelob --archive dist/releases/0.11.0/shelob-0.10.0-source-build.tar.gz --target /absolute/path/to/ai-tools
node scripts/package.mjs
```

Then reinstall `shelob@shelob-local` using the registered marketplace and reopen Shelob. Recovery restores application/build files and the dependency lockfile, preserving Application Support review data, user settings and automation. The older build ignores the new policy and suggestion sidecars, so it does not perform automatic approval. New self-contained HTML exports remain readable independently.

## Shelob 0.11.1 check results

Reports now show visible totals for Failed, Passed, Notes, Not checked and Not applicable. Selecting a nonempty total opens that group in the check picker. Counts follow the existing search, category and severity filters; filtered totals are labelled. Each check also carries a written result and an icon, including in offline exports and print.

Failed means a blocking finding was discovered. Notes are nonblocking. A check that could not run remains Not checked and carries a Could not run label. A partial check with findings retains its incomplete-coverage warning. These labels do not change execution, coverage, approval eligibility, discussion markers or automatic-approval policy. No state migration or saved-report rewriting is required.

The application-only backup for returning to 0.11.0 is `dist/releases/0.11.1/shelob-0.11.0-source-build.tar.gz`. Dependencies are unchanged. If other plugin work has changed the shared workspace since the backup, restore only Shelob's application tree:

```sh
recovery_dir=$(mktemp -d /private/tmp/shelob-recovery.XXXXXX)
tar -xzf dist/releases/0.11.1/shelob-0.11.0-source-build.tar.gz -C "$recovery_dir" plugins/shelob
mv plugins/shelob "$recovery_dir/shelob-current"
cp -R "$recovery_dir/plugins/shelob" plugins/shelob
node scripts/package.mjs
```

Then reinstall `shelob@shelob-local` using the registered marketplace and reopen Shelob. This preserves other plugins, shared build scripts, root package changes, current review data, model settings, approval policy, task databases and automation. Finish active reviews before upgrading or downgrading; the existing unfinished-review version policy still applies.

## Shelob 0.11.2 inline checks and spacing

Checks expands in the report workspace rather than a dialog. The list retains grouped outcomes, search, optional filters and keyboard navigation. Choosing a check collapses the list and focuses its heading. Expansion, group scope, filters and drafts survive polling in the existing in-memory report session; no saved-state fields or migration are introduced.

Failed and Passed remain visible, including zero counts. Notes, Not checked and N/A appear only when nonzero. Incomplete-coverage warnings remain unchanged. About this check and Review details use matching disclosure arrows and compact spacing.

To recover 0.11.1, follow the plugin-tree-only recovery commands above with `dist/releases/0.11.2/shelob-0.11.1-source-build.tar.gz`. Current review data, settings, publishing receipts, approval policy and shared workspace changes remain preserved.

## Shelob 0.11.3 lifecycle repairs

Running servers retain their immutable default rules, protocol and HTML export assets, so removing the old version cache does not prevent an active pinned review from finishing. New servers use the installed build. Unfinished snapshots from an older engine still require a fresh run; completed historical reports remain readable. No report, setting or receipt migration is required.

An initial PR report remains in progress until its selected work finishes. The final freshness check and missing coverage continue to block approval independently. The global app refreshes saved history while visible, including updates from another conversation; reading history never starts scans or reviews. Search responses now return both a file offset and line position when more matches remain in the same file.

On process termination, the next read derives interrupted preparation or failed native execution from the saved owner PID and bounded lifetime. It preserves the original manifest and evidence. Start a fresh review to recover; no automatic native retry is performed. Before the first upgrade from 0.11.2, finish active runs because that older process does not contain the asset-retention repair.
