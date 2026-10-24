# Sauron compatibility

The current product retains schema 3, the existing store identity, task and decision keys, reply drafts, and uncertain-delivery receipts. The default macOS store is outside plugin caches. `ATTENTION_DB` retains precedence. Unknown future schemas are rejected before normal writes.

Use the root [compatibility guide](../../../docs/compatibility.md) for backup and migration. The [local update guide](local-updates.md) describes optional ownership/capability verification. Installation and UI polling do not configure a source schedule.

Tests use isolated synthetic databases and fake source runtimes. Results do not prove that another user's connected apps are accessible. Keep missing-provider and partial-coverage results explicit.
