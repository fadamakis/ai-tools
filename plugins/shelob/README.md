# Shelob

Review local changes or a GitHub pull request against correctness checks and explicit rules. Inspect findings, saved reports, and publication receipts in the Codex sidebar.

## Start

Install `shelob@ai-tools` from the [AI Tools marketplace](https://github.com/fadamakis/ai-tools/blob/main/docs/getting-started.md). In a project chat, ask **Use Shelob to review my local changes**. For a PR review, provide its URL. GitHub workflows require GitHub CLI authenticated to the target repository; local reviews do not require GitHub access.

Shelob's tools expose review lifecycle, source snapshots, rules, findings, and report views. The explicit `/shelob:shelob-review` skill coordinates review in the conversation. UI tools require a desktop host with MCP App support. A saved result includes its reviewed revision; an old report is not proof of the current diff.

Review execution may send selected source context to the model runtime. Publishing comments or approvals remains a separate authorized action with freshness and finding checks. Installation itself publishes nothing.

## Data and updates

Reports, snapshots, rules, settings, and receipts default to `~/Library/Application Support/Shelob/`. `SHELOB_DATA_DIR` selects another store. Review snapshots may contain private source; inspect exports before sharing them.

Follow [updates](https://github.com/fadamakis/ai-tools/blob/main/docs/updates.md) and reopen the panel to load an installed update. Compare the displayed version with the installed release. Existing saved reports remain readable; updating code does not complete an interrupted review or retry an uncertain publication.

See [compatibility](https://github.com/fadamakis/ai-tools/blob/main/docs/compatibility.md), [privacy and permissions](https://github.com/fadamakis/ai-tools/blob/main/docs/privacy-and-permissions.md), and [supported systems](https://github.com/fadamakis/ai-tools/blob/main/docs/supported-systems.md). Build and test from the repository root using [CONTRIBUTING.md](https://github.com/fadamakis/ai-tools/blob/main/CONTRIBUTING.md).

See [detailed review behavior and scanner usage](references/usage.md) for review modes, rule packs, report schemas, and advanced commands.

## Preview

Synthetic data in the browser preview; this image does not establish native-host acceptance.

![Shelob preview](https://raw.githubusercontent.com/fadamakis/ai-tools/main/docs/images/shelob.png)
