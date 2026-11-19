# Sauron compatibility

Task grouping upgrades the local database to schema 4 transactionally.
Existing tasks become roots with no topics. Initial attention uses saved `needs_you` evidence, without inferring unread or partial-read chat state.
Task JSON, IDs, store identity, planning metadata, decisions, discussion links, reply drafts and uncertain-delivery receipts remain readable.
Organisation and topic records are additive metadata. Source observations cannot overwrite them.
Older schema-3 Sauron builds reject the upgraded database before normal writes; rollback requires a pre-upgrade backup.
Unknown future schemas remain rejected.

The default macOS store stays outside plugin caches. `ATTENTION_DB` retains precedence.
Use the root [compatibility guide](https://github.com/fadamakis/ai-tools/blob/main/docs/compatibility.md) for backup and migration.
Before replacing an installed build, use a disposable SQLite backup, verify migration and reopen it twice with the candidate.
Retain the original backup for rollback. Never test migration against the only copy of user data.

Tests use isolated synthetic databases and fake source runtimes.
Browser evidence does not establish native-host activation or another user's connector access.
Installation and UI polling do not enable source or organisation schedules.

Organisation assistance retains schema 4. Its review, proposal and checkpoint records are additive metadata.
Release-one writers preserve those records but cannot operate organisation assistance.
Stop older running Sauron processes before upgrading from schema 3. Constructor checks prevent old builds reopening an upgraded store, but cannot revoke an already open connection.
Daily schedules remain off unless enabled explicitly. No verification test installs a real schedule.


## Direct Codex capture titles

`track_codex_threads` accepts optional `threads[].taskTitle` (1–160 characters after trimming) alongside the original chat `title`.
New direct captures supply the agreed outcome as `taskTitle`; the store saves that value as the task title.
Calls without it retain the original `title` fallback, including existing organisation-review tracking.
Repeated capture never renames an existing linked task. Requested amendments use the existing planning title override.

This change adds no database fields or schema version and performs no backfill.
Task IDs, discussion links, user decisions and existing titles remain readable.
The stored task uses the existing title format, so older builds can read its outcome title without understanding the new input field.
New callers require an updated tool schema before sending `taskTitle`; older strict tool schemas reject that field.
