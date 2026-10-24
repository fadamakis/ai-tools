# Historical Preview compatibility

The distributed product is **Workbench**. Historical Preview names remain in data paths and UI resource aliases to preserve existing boards, notes, and saved links. They do not identify a second required plugin.

The current workflow and installation instructions are in [README.md](README.md). Schema-1 boards remain at `~/Library/Application Support/Workbench Preview/board.json`, or `WORKBENCH_PREVIEW_DATA_DIR`. Repository notes remain under `<git-common-dir>/workbench-preview/`; original `workbench/` notes are read-only import sources.

Do not run old and new writers concurrently during a documented migration. Unknown schemas fail without rewriting records. Native chat launch, resume, and panel activation require their own host acceptance; browser simulations prove only their tested protocol and UI behavior.

See [compatibility](../../docs/compatibility.md) before replacing an existing installation. Uninstalling a plugin does not delete its board, notes, or Codex chats.
