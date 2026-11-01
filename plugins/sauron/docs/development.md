# Sauron Dev

Sauron Dev is an isolated Codex plugin for working on this checkout. It uses
fixture tasks and its own database. It does not read connected sources, send
Slack messages, or start schedules.

It is separate from production Sauron:

- Plugin: `sauron-dev@sauron-dev`
- Display name: **Sauron Dev**
- Database: `plugins/sauron/.data/sauron-dev/attention.sqlite`
- Generated marketplace: `plugins/sauron/.data/sauron-dev-marketplace`

The existing `local-plugin` adapter and `sidebar-verification.sqlite` are not
part of this workflow.

## Setup

From the repository root, install dependencies with the pinned pnpm version,
then run:

```sh
pnpm sauron:dev:setup
```

Setup checks Node 22.13 or newer, the pinned pnpm version, and local build
dependencies. It builds a new immutable runtime under:

```text
plugins/sauron/.data/sauron-dev/builds/<build-id>
```

It then writes the selected build ID to
`plugins/sauron/.data/sauron-dev/current.json`. On the first run it creates the
fixture database. Later setup and build runs retain its tasks and decisions.

Register the generated marketplace once, using the absolute path printed by
setup:

```sh
codex plugin marketplace add /absolute/path/to/ai-tools/plugins/sauron/.data/sauron-dev-marketplace
```

Restart the ChatGPT desktop app. In the Plugins directory, choose the **Sauron
Dev** marketplace and install **Sauron Dev**. Use the supported Plugins UI or
Codex CLI to remove it later. Do not edit Codex caches or configuration files
to install, refresh, or remove the plugin.

## Daily loop

If Sauron Dev is connected, first disable it with the supported UI or restart
the desktop app. Then edit Sauron source and run:

```sh
pnpm sauron:dev:build
```

Re-enable and reopen Sauron Dev afterwards. If the panel still shows the old
build, restart the desktop app. The footer and Diagnostics show the loaded
fixture build ID. Compare it with the expected ID from:

```sh
pnpm sauron:dev:doctor
```

Doctor checks the workspace build, fixture database path and existence,
generated marketplace, adapter paths, and runtime lock. It does not check
fixture database content or prove that the desktop app has loaded the selected
build.

Sauron Dev holds a lock while its native runtime is connected. A rebuild or
reset refuses to run while that lock is active. Closing the panel might not end
the runtime immediately. Disable or restart Sauron Dev with the supported UI,
then rerun the command. File watching and automatic desktop reload are not part
of this first workflow.

## Fixtures and reset

The fixture database contains a synthetic source task, personal tasks, and a
completed task. Refresh and reply controls are simulated. The send control says
**Simulate send**. These actions do not access Slack, other connected apps, or
a schedule. Discussions opened from Sauron Dev refer back to Sauron Dev.

To archive fixture data and recreate it, run this in an interactive terminal:

```sh
pnpm sauron:dev:reset
```

Type `reset` when prompted. The command moves the database and any SQLite WAL
sidecars to `plugins/sauron/.data/sauron-dev/archives/<id>/`, then creates a
fresh fixture database. It refuses when a native dev runtime holds the lock.

## Compatibility

This workflow creates no production database migration and does not change the
default Sauron data path. Before replacing a production plugin build, compare
the candidate against a disposable copy of saved data and confirm existing
state remains readable. Native desktop activation is a separate acceptance
check.
