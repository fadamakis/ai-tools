# Release and acceptance

## Publication gate

The repository variable `AI_TOOLS_PUBLISH_ENABLED` must equal `true` before the trusted publishing job can run. Keep it unset or `false` during private release preparation. Validation, including a manually dispatched workflow, still runs with publication disabled.

Enable the variable only during the approved launch after privacy, automated validation and repository-control checks are complete and remaining limitations are recorded. Passing `main` changes then publish through the normal release job. Setting the variable to `false` stops future publishing jobs; it does not cancel an already-running job or change installed versions. Check live runs when stopping publication.

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

## Desktop checks when available

Record source/release commit, versions, macOS/architecture, host/CLI/Node versions, commands, and dated results. Use disposable data and a clean installation; preserve existing data before replacing an installation.

The initial public release proceeds on automated validation and the reported successful Workbench installation on another Mac. Unverified native panel activation, chat delivery and keyboard behavior are disclosed limitations, not a request for the owner to perform manual QA. Maintainers can use the checks below when a suitable host is available; record a check as unverified until it has actually been observed.

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

## Prepare an existing release

Maintainers can prepare verified downloads without publishing or changing an installation:

```sh
pnpm update:prepare
pnpm update:prepare --tag release-SOURCE_SHA --published /absolute/path/to/current/plugins
```

The comparison directory contains `shelob/`, `sauron/` and `workbench/` from the current packages. Preparation requires GitHub CLI access, Python 3 and the repository's pinned dependencies. It selects a stable GitHub Release, requires successful main-push CI for its source commit, verifies ZIP checksums and package fingerprints, checks package metadata/public content, and starts the packages with disposable data. The plan, downloaded archives and extracted packages are retained under ignored `dist/updates/`. Repeated preparation preserves earlier plans.

The plan reports unchanged packages or lists changed files and versions. Missing current sources remain unverified. Preparation does not establish saved-state compatibility: follow [compatibility](compatibility.md) with disposable copies before replacing a build. This tooling changes no plugin state format or data location and requires no migration itself.

For an explicitly requested manual account upload, use `$ai-tools-release` from a chat in this repository. The maintainer skill compares the exact current listing, preserves its identity and audience, verifies compatibility and reads back the uploaded result. Pass a separate private mapping with `--workspace-ids /absolute/path/to/private/listing-ids.json` when needed; IDs appear only in the ignored plan, never in the public marketplace. See [optional workspace distribution](workspace-setup.md). Account publication and native desktop activation require their own evidence.
