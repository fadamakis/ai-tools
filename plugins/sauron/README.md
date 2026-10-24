# Sauron

Discussions opened from an item ask the new chat to save its link back to that item. Saved links survive source updates and app restarts; **Continue discussion** reopens the saved conversation. Hosts without current-chat identity support can use **Link a chat** with a copied ChatGPT or Codex conversation URL. Linking never changes the task's decision or source identity.

Keep source-backed Slack, Jira, GitHub, Calendar, and meeting actions together with personal tasks, saved decisions, and reviewed Slack replies.

## Use

Install Sauron from the workspace plugin directory and open its Codex sidebar. The initial team release supports macOS with Node 22.13 or newer. The UI and MCP server dependencies are bundled; no source checkout or npm installation is needed.

Refresh reads Slack and Granola through the signed-in user's existing Codex connections. Dot-fed sync can add source-backed observations to the same local store. Installing Sauron does not configure schedules, start source checks, or connect someone else's accounts. Task decisions survive refreshes, replay, and restarts.

Reply preparation creates a local editable draft. Only the explicit **Send to Slack** action authorizes sending the reviewed text to its verified original thread. Uncertain delivery retains the draft and cannot automatically resend. Tests simulate these actions and must not send real messages.

## Saved data and upgrades

The default macOS database is `~/Library/Application Support/Sauron/attention.sqlite`. An explicit `ATTENTION_DB` path takes precedence. Database schema 3, store identity, tasks, decisions, history, receipts, and reply drafts remain readable. Data is outside versioned plugin caches. Unknown newer schemas are rejected.

Existing personal installations must stop Sauron and its scheduled writers before migrating their selected database:

```sh
node scripts/migrate-data.mjs --from /absolute/path/to/existing.sqlite --confirm-writers-stopped
```

Run that command from an extracted plugin package. In the source repository, use `pnpm sauron:migrate` with the same arguments. The command makes and verifies a consistent SQLite backup, retains the original, and refuses an existing destination. It never merges databases, checks external sources, or sends replies.

After verifying the new installation, update existing local schedules to `node /absolute/path/to/plugin/dist/server/check-attention.js`, preserving their cadence and intent. `--manual-scan` explicitly requests a source scan; omitting it honors coordination mode. `dist/server/sync-attention.js` accepts the existing JSON sync requests on stdin. Both use the same durable database.

Reopen the panel after an update; restart Codex if it still shows the old build. A data refresh does not reload installed application code.

## Maintain

Use the root repository's pnpm workspace, lockfile, build, and verification commands. Existing tool names, UI resource aliases, operation IDs, and `ATTENTION_DB` remain supported. The standalone personal adapter helper remains an authoring/testing utility and is not the distributable team package.

## Local automatic updates candidate

The unreleased local-managed implementation, verification boundary and safe writer cutover are documented in [Local updates](docs/local-updates.md). The current headless CLI cannot execute all five connected sources; local ownership remains guarded and must not be enabled until that runtime check succeeds. No schedule is installed automatically.

## Preview

Synthetic data in the browser preview; this image does not establish native-host acceptance.

![Sauron preview](https://raw.githubusercontent.com/fadamakis/ai-tools/main/docs/images/sauron.png)
