# Store compatibility for the local plugin update

No data migration is required for this update. Install the published packages
over the existing plugin identities and retain their existing data directories.
Never replace a data directory with a test fixture or restore a database merely
to roll back code.

## Sauron

The durable path resolver, store identity and SQLite schema version 3 are
unchanged. Source/action identities, operation receipts, history and explicit
Done, Dismissed and Snoozed decisions remain authoritative.

Discussion associations use independent metadata keys and idempotent receipts;
source observations cannot overwrite them. Older versions ignore and retain
these keys. New conversations request association using per-call host identity.
If the host omits identity or cannot invoke the association tool, the entry
continues to offer a pasted conversation-link fallback. A new-chat
acknowledgement alone is not proof that an association was saved.

The additional local update mode is opt-in and requires successful observed
reads from all five providers with the current runtime policy. Installation
does not change ownership, enable a local schedule or pause a cloud schedule.
An existing dot-managed store remains dot-managed. The latest upstream shared
worker implementation remains in use for manual checks and reply preparation;
the restricted local coordinator is a separate, gated path.

Local writer cutover is still blocked until all five real provider reads and
the subsequent wake/scheduling acceptance checks succeed. A code release does
not resolve that runtime limitation. See the plugin's local-updates document
for coordinated cutover and rollback requirements.

## Shelob

Existing review manifests remain store version 1. Requester name and optional
request URL are additive context fields, including after asynchronous source
preparation. Existing reports without these fields remain readable. This does
not change review execution, publication authorization, saved assessments,
on-call watches or schedules.

## Workbench

No new Workbench source or store format changes are introduced by this update.
The current upstream persistence implementation and saved board path are
retained. A new package version may be generated because the shared release
script is part of each product's build-input fingerprint.

## Verification and rollback

Run the repository's build, backend tests, validation, browser suites and
packaged smoke checks before release. Compare installed package digests with
the published release receipt, rather than relying on version strings alone.
Record read-only before/after audits of existing stores during installation.

For rollback, reinstall a known earlier published code package under the same
plugin identity. Keep all saved state in place. Any writer ownership transition
requires the separate pause, drain and compare-and-swap procedure; never run
two automatic source writers.
