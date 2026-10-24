# Privacy and permissions

Each installation uses the user's own accounts and stores product state locally. Local storage does not mean all processing stays on the computer: requested model work and connected-service reads/writes can send selected content to OpenAI and the relevant provider under those services' terms and account policies.

## Stored data

| Product | Default macOS location | Override and contents |
| --- | --- | --- |
| Shelob | `~/Library/Application Support/Shelob/` | `SHELOB_DATA_DIR`; review snapshots, reports, rules, settings, and action receipts. Snapshots can include private repository source. |
| Sauron | `~/Library/Application Support/Sauron/attention.sqlite` | `ATTENTION_DB`; source-backed and personal tasks, decisions, short evidence, drafts, coordination state, and delivery receipts. |
| Workbench | `~/Library/Application Support/Workbench Preview/board.json` | `WORKBENCH_PREVIEW_DATA_DIR`; cards, repositories, evidence checkpoints, and chat launch records. The historical directory name is retained for compatibility. |

Workbench task notes remain in `<git-common-dir>/workbench-preview/`; earlier `workbench/` notes are read-only import sources. Codex chats and connected-service records are managed by their respective hosts, not by deleting plugin data.

## Connections and actions

- **Shelob** reads the authorized local diff or GitHub PR. Review execution can send source context to the selected model runtime. Publishing PR comments or approvals follows the requested action scope and the product's checks; installation does not authorize it.
- **Sauron** can read connected Slack/meeting sources and, in explicitly configured coordinated modes, Jira, GitHub, and Calendar. Reply preparation stores a local draft. The explicit **Send to Slack** action sends reviewed text to the verified original thread. Uncertain delivery is retained for reconciliation rather than automatically resent.
- **Workbench** reads registered repositories/notes and requested GitHub status. Starting or resuming a chat sends the selected task context through Codex app tools. Explicit Autopilot invocation grants its documented active-run commit/push/draft-PR scope; normal board use does not.

The host owns provider authentication and access policies. GitHub CLI uses the user's own credential store. Do not put tokens in manifests, environment examples, model prompts, screenshots, issue reports, or schedule files. Installation does not copy the maintainer's credentials or grant access to a private organization.

## Schedules, diagnostics, and deletion

Installation creates no schedule and starts no source check. Optional background updates require explicit configuration, successful capability verification, the correct store identity, and coordinated writer ownership. Read Sauron's [local update guide](../plugins/sauron/docs/local-updates.md) first.

Diagnostics and saved reviews can contain source code and personal task information. Share only a minimal sanitized reproduction. Review generated exports before sharing; redacting a UI label does not remove content from an underlying database or archive.

Uninstalling retains local product state for reinstall/recovery. To delete it intentionally, stop that product and its optional scheduled writers, make any desired backup, and remove only its selected data directory/database and explicitly chosen task-note files. Do not delete a shared repository's Git directory. Remove related schedules through the host/OS's supported controls. Remote messages, PR comments, and Codex chats require separate deletion in their owning services.
