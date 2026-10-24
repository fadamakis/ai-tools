# Supported systems

The first public release targets macOS desktop. This is a support policy; the acceptance record below distinguishes tested behavior from candidate support.

| Environment | Scope |
| --- | --- |
| macOS + Codex desktop | Primary target: skills, local MCP tools, and sidebar UI. Native chat actions additionally require Codex app tools and host messaging. |
| Codex CLI on macOS | Marketplace installation and local MCP/skill checks. Sidebar UI and native chat start/resume require the desktop host. |
| Windows / Linux | Not verified for this release. A portable code path is not a support claim. |
| Web / mobile / cloud-only chats | Outside this release's local-execution scope. |

## Runtime and integrations

- Node.js **22.13 or newer**, Git, and a host supporting the plugin format are end-user requirements. Sauron uses Node's built-in SQLite module.
- Shelob native review needs an authenticated Codex CLI. It prefers the desktop-bundled CLI when available; an explicit `CODEX_CLI_PATH` is preserved. Local reviews do not require GitHub access.
- GitHub CLI with the user's own authentication is required for GitHub operations.
- Sauron uses the user's connected Slack and Granola apps for manual refresh; optional coordinated/local updates require verified access to Slack, Granola, Jira, GitHub, and Google Calendar. Missing providers remain explicit coverage gaps.
- Workbench can read saved cards without a live GitHub connection. GitHub status checks and native chat delivery require their respective capabilities.
- Maintainers also need the pnpm version in `package.json`, the pinned lockfile, and Playwright's browser runtime. These are not plugin-installation prerequisites.

## Platform behavior

The native repository folder picker uses macOS automation. Manual paths remain available. Codex CLI discovery checks supported desktop application locations and then `PATH`. Keep Node and CLI executables available to the desktop process.

Sauron computes business-hour freshness in the computer's local time zone by default. Set the IANA `ATTENTION_TIME_ZONE` environment variable for the plugin and any scheduled worker to use an explicit zone. Existing task timestamps remain UTC instants; this setting does not migrate records. Optional source schedules are configured separately and are never installed automatically.

## Acceptance record

On 24 October 2026, package and CLI checks passed on macOS 26.6.2 (25G83), ARM64, Codex CLI 0.155.1 and Node 22.23.1. Fresh MCP processes also passed on the official Node 22.13.0 ARM64 runtime. All three plugins passed independent isolated CLI installation, uninstall and reinstall, and a Git marketplace upgrade from the preceding published version. The tests used a loopback Git origin without the maintainer's normal plugin profile or service connections.

The source passed 320 unit checks and 124 browser checks. Those browser results use a simulated host bridge. Native desktop activation and Workbench chat delivery remain unverified; they are not established by the CLI or browser results. Windows, Linux, Intel Macs and anonymous GitHub installation remain unverified.

Record source/release identity, macOS build, architecture, host/CLI versions, Node runtime, and dated results in the release acceptance report. Automated MCP and browser checks establish those tested boundaries only. Native panel activation and chat delivery must have their own observed result before they are described as verified. No minimum macOS version or untested CPU architecture is inferred from CI.

The owner reports installing the latest available Workbench on another Mac and using it successfully. Exact package/OS versions and native Start/Resume were not captured, so this is an installation/use smoke report. The UI audit also found a narrow synthetic-iframe Tab-entry failure in WebKit 26.0; Chromium keyboard tests passed. This is not an accessibility conformance claim. No further owner-run manual QA is required for the initial publication decision.
