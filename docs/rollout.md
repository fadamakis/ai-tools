# Release and acceptance

## Validate before publication

Use the pinned pnpm/lockfile and run `pnpm verify`, `pnpm audit:secrets`, and `pnpm audit`. Package against the previous published marketplace when checking version continuity. Validate the extracted candidate with:

```sh
pnpm package --previous /absolute/path/to/previous/marketplace --source-commit SOURCE_SHA
node scripts/validate.mjs dist/release --packaged
node scripts/check-public.mjs dist/release --packaged
node scripts/scan-secrets.mjs --packages dist/release
node scripts/smoke-packages.mjs dist/release
```

The secret scanner is pinned by version and archive SHA-256 in `scripts/security-tools.json`. It bootstraps a platform binary into ignored `.cache/security/`; `GITLEAKS_BINARY` can select an independently verified binary of the same version. Reports are redacted and remain under ignored `dist/security/`. The only generic-key exception identifies an exact React DOM variable assignment verified against its dependency source; it excludes no file or whole line.

Check project licenses and third-party notices in every ZIP, not only source. Verify unchanged versions/fingerprints, product/shared changes, interrupted builds, failed validation, and stale-main publication protection. PR validation is unprivileged; publishing credentials are used only by the trusted publish job. Do not commit generated bundles or user data to `main`.

## Desktop acceptance

Record source/release commit, versions, macOS/architecture, host/CLI/Node versions, commands, and dated results. Use disposable data and a clean installation; preserve existing data before replacing an installation.

1. Install each product independently through the supported host/CLI installer. Check tool discovery, one harmless workflow, UI loading, missing prerequisites, and feature-specific connections.
2. Verify native Workbench chat start/resume and the explicit command routes. Keep simulated bridge/browser results separate from native delivery.
3. Upgrade a synthetic N installation to N+1 through the documented marketplace procedure. Record catalog, installed manifest, server, and UI versions, including any reopen/restart needed.
4. Check existing saved data on disposable copies: reports/settings/rules, task identities and decisions/drafts/receipts, board cards/notes/chat links. Confirm unknown-schema rejection and any writer-stop requirement.
5. Verify uninstall/reinstall retention and recovery under a newer compatible code version. Do not downgrade a database or automatically retry an uncertain external action.

An optional workspace pilot uses a separate private identity mapping, as described in [workspace setup](workspace-setup.md). Independent Git installation does not require workspace import.

## Public-launch review

While the repository is private, audit source and all retained Git refs, release ZIPs, Actions logs/artifacts, and other GitHub content. Keep private audit evidence outside this repository. Resolve ownership, licensing, private material, and any history/asset remediation before the visibility change. A current-source scan does not cover an older tag or ZIP.

Prepare a release report containing exact source/package identities, audit coverage and resolutions, license/provenance, dependency results, native acceptance, supported configurations, update proof, and remaining limitations. Review any destructive history/asset changes as concrete operations. The maintainer approves the visibility change only after that result is reviewable.

After approval, recheck remote drift, apply the approved preparation/remediation, change visibility, inspect effective branch/security settings, and enable private vulnerability reporting where available. Verify logged-out repository/marketplace/ZIP access and installation without repository credentials. Publish release notes only for the approved verified candidate.

## Ongoing releases

Passing `main` changes publish the unbound `releases` marketplace and versioned GitHub ZIPs/checksums. Existing installations pull that channel as described in [updates](updates.md). Keep original workspace identities out of the public catalog. Restore previous behavior through a compatible newer release; do not reset public version numbers or erase newer user state.
