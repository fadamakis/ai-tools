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

Restart Codex. In the Plugins directory, choose the **Sauron
Dev** marketplace and install **Sauron Dev**. Use the supported Plugins UI or
Codex CLI to remove it later. Do not edit Codex caches or configuration files
to install, refresh, or remove the plugin.

## Daily loop

Edit Sauron source and build while the plugin stays connected:

```sh
pnpm sauron:dev:build
```

After the build succeeds, restart Codex and reopen Sauron Dev to load it.
There is no need to disable or uninstall the plugin. Existing processes and
panels keep their current build until their connection restarts. Each Dev build
advertises a distinct UI resource address. When Codex retains another build's
address, the serving runtime resolves it to its own matching UI. Stable resource
aliases remain readable. The footer and Diagnostics show the loaded fixture
build ID. Compare it with the expected ID from:

```sh
pnpm sauron:dev:doctor
```

Doctor checks the workspace build, fixture database path and existence,
generated marketplace, adapter paths, and runtime lock. It does not check
fixture database content or prove that the desktop app has loaded the selected
build.

Each successful build is published in a new directory. Running clients keep
using their existing build; new connections load the last successfully
published build, even while another build is in progress. A failed or incomplete
build leaves the selected build unchanged. Old build directories are retained.

Ordinary builds preserve the fixture database and reuse the marketplace and
adapter files created by setup. They do not regenerate plugin metadata. If setup
files are missing, the command asks you to run `pnpm sauron:dev:setup`.

Build, setup and reset commands cannot run concurrently with each other. Setup
and reset also refuse to run while any native runtime is connected. Quit Codex
completely, run setup or reset from an external terminal, then reopen Codex.
Closing only the panel may leave its runtime alive. File watching and automatic
reload are not provided.

## Real-chat bootstrap

**D-01:** From the repository root, run `pnpm sauron:dev:bootstrap` to review local
Codex chats active during the last 14×24 hours, including resumed older chats and
archived chats. Load the current Dev build first; older connected runtimes are
refused. The command preserves existing Dev tasks, considers each during review,
and resumes saved real-review checkpoints. Review or dismiss any pending proposal
before starting or resuming. Panel review buttons remain simulated.

Chat excerpts go to the configured Codex model to generate proposals. Real-history
reviews are labelled in the panel; tracking, grouping, topics and closures wait
for acceptance. Evidence can update attention on already linked Dev tasks.
Production data, connected-source refreshes, replies and schedules are untouched.

**D-02:** To start empty, quit Codex completely, then run
`pnpm sauron:dev:bootstrap --fresh` from an external terminal. This archives the
whole Dev store and clears tasks, proposals, history, drafts, receipts, checkpoints
and preferences. It creates a new store identity, with no sample tasks and daily
review off. Reopen Sauron Dev after the command finishes to review its proposal.

Progress and incomplete coverage are printed without chat text. Resume interruptions
with `pnpm sauron:dev:bootstrap`; repeating `--fresh` starts over. The command prints
the archive location. To recover it, quit Codex, retain the current store separately,
then restore the archived `attention.sqlite` and any matching `-wal`/`-shm` files
together. A failed replacement restores the original; a failed review retains its
new store and checkpoints alongside the archive.

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
fresh fixture database. Quit Codex before running it from an external terminal;
it refuses while any native runtime is connected.

## Compatibility

This workflow creates no production database migration and does not change the
default Sauron data path. Before replacing a production plugin build, compare
the candidate against a disposable copy of saved data and confirm existing
state remains readable. Native desktop activation is a separate acceptance
check.
