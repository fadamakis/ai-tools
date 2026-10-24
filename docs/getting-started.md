# Install and start

AI Tools is a Git marketplace containing three independent plugins. Install only the ones you want. Release packages contain their UI and server dependencies; using a plugin does not require cloning this source or running pnpm.

## Requirements

The initial release targets **macOS with Codex in the ChatGPT desktop app**. Use a current host that supports Git marketplaces, local MCP servers, skills, and MCP App panels. Exact acceptance results are recorded in [supported systems](supported-systems.md).

Install Node.js 22.13 or newer and Git. The `node` executable must be available to the desktop process, not only to an interactive shell. GitHub CLI (`gh`) and your own GitHub login are needed for GitHub workflows. Sauron's source features need the corresponding connected apps in your account. Workbench's native chat actions need the Codex app tools and host messaging capability.

## Install

Using the Codex CLI:

```sh
codex plugin marketplace add fadamakis/ai-tools --ref releases
codex plugin add shelob@ai-tools
codex plugin add sauron@ai-tools
codex plugin add workbench@ai-tools
```

Alternatively, after adding the marketplace, select **AI Tools** in the desktop plugin directory and install the products you want. Start a new chat and open the product from the plugin/sidebar UI. Each user connects their own accounts. Repository access is only required while this repository is private.

## First use

- **Shelob:** open a project chat and ask Shelob to review the current local changes. Inspect the findings and saved report. To review a GitHub PR, provide its URL and authenticate `gh` for that repository.
- **Sauron:** open the sidebar and add a personal task. Connect the relevant apps before asking for a source refresh. Refresh status reports unavailable or partially covered sources; an installed connection alone does not prove source access.
- **Workbench:** open the board, add a repository, and choose **New task**. Start with a description or issue URL. Autopilot is off by default. `/workbench:help` describes all 13 explicit commands.

Installing a plugin does not create schedules, start source scans, send messages, or publish code. Read [privacy and permissions](privacy-and-permissions.md) before enabling optional actions.

## Updates and removal

Follow [updates](updates.md) to refresh the release channel and verify the loaded version. Refreshing a board's data does not update its application code.

```sh
codex plugin remove shelob@ai-tools
```

Use the corresponding name for another plugin, or uninstall through the host plugin directory. Saved data remains outside the installed plugin cache. See [privacy and permissions](privacy-and-permissions.md) for intentional data deletion and [troubleshooting](troubleshooting.md) for setup problems.
