# Sauron architecture

## Task ownership

`tasks` stores source observations, identities and explicit closure decisions.
The `task-plan:` metadata records user titles, workflow, dates, ordering and focus.
The `task-organisation:` metadata records parentage, direct topics and attention acknowledgements.
Source refreshes update evidence without replacing either user-owned record.
Schema 4 prevents older writers from bypassing hierarchy rules.

`SauronStore` owns the SQLite connection, public commands, operation receipts and transaction boundary.
`OrganisationStore` reads and writes organisation metadata using that connection; it never starts a nested transaction.
The shared `task-tree` module derives ancestry, inherited topics, attention summaries, visibility and focus eligibility.
Derived values are not persisted as competing sources of truth.

## User actions

UI and MCP requests enter `service`, then validated store commands.
Moves validate current store revision and cycles inside a write transaction.
Branch closure and reopening validate the affected subtree before changing decisions.
One receipt deduplicates each explicit operation, including retries after a lost response.
Existing completion and ordering tools enforce the same invariants as organisation controls.

Views include a monotonic task-view revision. Readers merge complete task projections using that revision rather than mixing old ancestry with new summaries.
Source-sync status and reply drafts keep their independent revisions.
The reader constructs expandable rows from the shared tree projection and retains the existing task detail interface.

## Behaviour contracts

- H-01: one parent per task and no cycles.
- H-04/H-05: child completion never closes a parent; closing open descendants needs explicit approval.
- F-01/F-03: only actionable roots occupy Top 3; nesting removes only the moved task's slot.
- A-02/A-04: reading clears nothing; handling clears only the task's own attention.
- T-02: inherited topics follow current ancestry; direct assignments survive moves.
- I-05: source refreshes preserve organisation and migration preserves task identities and saved decisions.

See `tests/task-groups.test.ts` for executable contracts and `AGENTS.md` for targeted checks.
