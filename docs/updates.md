# Updates and recovery

The `releases` branch is the installation channel. `main` contains editable source. Pull requests validate without publishing; a passing change on `main` publishes affected plugins, the marketplace, ZIPs, SHA-256 checksums, and a source receipt.

## Update an installation

Refresh the configured Git marketplace, then select/install the current version of the products you use:

```sh
codex plugin marketplace upgrade ai-tools
codex plugin add shelob@ai-tools
codex plugin add sauron@ai-tools
codex plugin add workbench@ai-tools
codex plugin list --json
```

Omit products you do not use. The `upgrade` command refreshes the marketplace snapshot; it is not a guarantee that an already open application panel loaded a new UI. Do not edit installed cache files to update a plugin.

On macOS ARM64 with Codex CLI 0.155.1, an isolated Git marketplace test confirmed that `marketplace upgrade ai-tools` also replaced installed caches: Shelob 0.11.8 → 0.11.9, Sauron 0.6.11 → 0.6.12, and Workbench 0.3.2 → 0.3.3. Repeating `plugin add` for those selections retained the same versions. The explicit add commands above remain useful for selecting products and checking the installer result. This test used a private loopback Git origin; anonymous GitHub installation and native desktop activation are separate launch checks.

Start a new chat and reopen the product panel after updating. Compare the running version shown by the product with the installed version and the release's `release.json`. If the panel remains on the previous version, quit and reopen the desktop app. Keep a stale panel result separate from a failed installation.

Independent Git installations have no promised daily update cadence. The explicit procedure above is the supported refresh path; workspace-managed synchronization is a separate admin option. The release acceptance report records which client and activation sequence were actually tested.

## Data compatibility

Data is outside versioned caches. Back up the store before a migration and stop relevant writers when the migration instructions require it. Read [compatibility](compatibility.md) for each product's paths, environment overrides, schema handling, and older-version requirements.

Installing an update must preserve Shelob reports/rules/settings, Sauron tasks/decisions/drafts/receipts, and Workbench cards/notes/chat links. An interrupted or uncertain external action must not be retried merely because a new build installed.

## Verify a release download

Download a plugin ZIP and `SHA256SUMS` from the same GitHub Release. Run the checksum check from their directory, using only the checksum entries for files you downloaded:

```sh
shasum -a 256 shelob-VERSION.zip
```

Compare the complete hash to its entry in `SHA256SUMS`. The release receipt maps each product version and package fingerprint to the source commit. Keep license and third-party notices with extracted packages.

## Recover from a regression

Report the plugin version, host/runtime versions, reproduction steps, and a sanitized error. Do not attach your database or full private report by default.

Maintainers restore compatible previous behavior under a **newer version** through normal validation and release. They do not reuse old version numbers or reset the `releases` branch. Never restore an old database over newer user decisions as an automatic code rollback. An incompatible data migration needs a separate writer-stop and verified-backup recovery procedure.
