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

## Organisation assistance

The read-only chat adapter owns app-server discovery and pagination. It cannot start, resume or modify chats.
The review worker checkpoints active and archived discovery separately, then sends bounded evidence to a proposal model.
The model receives no mutation tools. Its MCP inventory is disabled for that invocation and checked again before execution.
The source scanner retains its existing provider policy.

Review state, checkpoints, rejected evidence fingerprints and corrections live in separate metadata records through `ReviewStore`.
`SauronStore` owns their transaction boundary and validates accepted proposals using the existing task actions.
Models cannot bypass cycle prevention, focus eligibility or branch closure confirmation.
Each generated batch checks the task revision from before model execution. Concurrent edits require a fresh review.

A proposal records dependencies, its task baseline and the exact descendants included in proposed closures.
Accepting selected changes commits one receipt and one transaction. Missing dependencies or changed closure scopes roll back the whole batch.
Rejected changes stay hidden until relevant evidence changes. Title and check-time changes do not alter task evidence fingerprints.
UI drafts and original save requests survive panel reloads.

Daily scheduling is opt-in and independent of source scanning. A macOS user schedule ticks once per minute.
The store decides whether 07:00 Europe/Berlin is due, including catch-up and daylight-saving changes.
The scheduler uses stable runtime copies beside the database, an expected store ID and a leased worker.
Incomplete reviews retain their watermark and checkpoints, with a 15-minute automatic retry delay.
Remote Codex hosts and ChatGPT history are explicitly outside current discovery coverage.

## Error recovery

The [product decisions](product-decisions.md) explain the intentions behind these recovery mechanisms.

The clients share approved error categories and preserve structured server errors alongside legacy text responses.
Only input validation or a confirmed transaction rollback establishes rejection; transport and unexpected failures remain unconfirmed.
`list_attention` accepts an optional `checkSave` containing the expected store, receipt ID and original payload.
It returns a receipt only when both identity and payload match a committed operation. Matching task values are not confirmation.

Recovery retains original requests, including their operation IDs. Conflicts require a fresh read and explicit review before reapplication.
Requests from another store cannot be replayed. Older requests without store identity can be confirmed by receipt but otherwise require dismissal.
Session-local diagnostics use an allowlist and exclude task content, request payloads and raw exception text.
They retain 100 historical events separately from active failures and may disappear on panel closure or Codex restart.
No database schema or saved-request migration is required.
