# Sauron compatibility

Task grouping upgrades the local database to schema 4 transactionally.
Existing tasks become roots with no topics. Initial attention uses saved `needs_you` evidence, without inferring unread or partial-read chat state.
Task JSON, IDs, store identity, planning metadata, decisions, discussion links, reply drafts and uncertain-delivery receipts remain readable.
Organisation and topic records are additive metadata. Source observations cannot overwrite them.
Older schema-3 Sauron builds reject the upgraded database before normal writes; rollback requires a pre-upgrade backup.
Unknown future schemas remain rejected.

The default macOS store stays outside plugin caches. `ATTENTION_DB` retains precedence.
Use the root [compatibility guide](../../../docs/compatibility.md) for backup and migration.
Before replacing an installed build, use a disposable SQLite backup, verify migration and reopen it twice with the candidate.
Retain the original backup for rollback. Never test migration against the only copy of user data.

Tests use isolated synthetic databases and fake source runtimes.
Browser evidence does not establish native-host activation or another user's connector access.
Installation and UI polling do not enable source or organisation schedules.
