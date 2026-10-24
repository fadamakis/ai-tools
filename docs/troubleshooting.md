# Troubleshooting

## Plugin is missing or will not start

Run `codex plugin marketplace list` and `codex plugin list --json`. Confirm the `ai-tools` source tracks `releases`, the requested product is installed/enabled, and Node 22.13 or newer is available to the desktop process. Reopen the app after changing runtime availability. Preserve the exact sanitized startup error when reporting a failure.

## Old version still visible

Follow [updates](updates.md), start a new chat, and close/reopen the panel. Compare the installed version with the panel version. Restart the desktop app if the previous plugin process remains loaded. Board Refresh updates data, not code.

## GitHub or source access is unavailable

Use `gh auth status` locally and confirm access to the specific repository. Do not paste authentication tokens into a chat or bug report. Connect only the apps required by the requested feature. A visible connection or discovered tool name does not prove the active runtime can execute that tool; keep missing sources and partial refresh coverage explicit.

## Workbench cannot start or resume a chat

Use the desktop host with its Codex app tools and messaging capability. A readable board is not proof of native chat delivery. Keep the recorded launch request and inspect its status before retrying; a possibly delivered request must not create a duplicate chat automatically. Autopilot is off unless selected explicitly.

## A store needs a newer version or a writer lock remains

Keep the store and its backup. Install a compatible newer runtime rather than deleting data. Stop the relevant old writers before an explicitly documented migration. Never remove a live lock or run old and new writers concurrently. See [compatibility](compatibility.md).

## Report a problem

Open a GitHub issue with the plugin/version, host/runtime versions, expected and observed behavior, and a small synthetic reproduction. Use the [private security route](../SECURITY.md) for vulnerabilities or credentials. Do not attach a full review snapshot, database, or private source archive without reviewing its contents.
