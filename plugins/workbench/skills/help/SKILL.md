---
name: help
description: >
  Explain Workbench commands and when to use each stage. Use for /workbench:help,
  "how does Workbench work?", "show me the Workbench steps", or "which Workbench
  command should I use?" Give a brief guide and one next-step suggestion. Do not
  start the workflow, inspect the repository or change task state for a help request.
---

# Workbench help

Read the [usage guide](../../README.md) for the current command list. Use it as the single source for command names and brief descriptions; do not load every stage's instructions.

1. Explain in one sentence that Workbench takes work from a ticket to a reviewed PR using the existing specialist skills.
2. Show the command table from the usage guide, with one short sentence per command. Keep prepare, plan, implement, verify, review, publish and greenlight in workflow order; distinguish help and start as entry points, autopilot as the explicit end-to-end mode, run as an optional preview utility, translations as an explicit-only utility outside autopilot that follows the repository's localization process and verifies requested languages, and improve as the explicit approval gate for changing Workbench itself.
3. Explain briefly that stages can be invoked directly, simplification is included in implement, and each stage suggests what to do next. Explain that Local/Worktree selection and setup belong to Codex. Show `/workbench:start TICKET`; Workbench uses the task’s native checkout and configured environment, with no separate worktree option. Run prefers matching configured native actions. Clarify that publish commits/pushes and creates or updates a draft PR; greenlight handles comments, failed checks and conflicts, with pushes and discussion replies requiring authorization. Neither command merges automatically. Explain that `/workbench:autopilot TICKET` explicitly authorizes the full sequence through a draft PR, ordinary pushes and addressed-discussion replies/resolution, during the active run. It stops when waiting for CI or reviews and never schedules work automatically. Before handoff it may propose one evidence-backed Workbench improvement, but no skill files change unless the user separately approves that exact proposal through `/workbench:improve`. Monitoring requires a separate explicit request, is read-only and expires after at most two hours. Findings need a user-requested fix round. Human approvals remain separate; it never marks ready or merges.
4. End with one clickable next-step suggestion using the [Next-step handoff](../../references/workflow.md#next-step-handoff) format; read that section for host syntax and the plain-text fallback. Use an already-established task/stage when available. Without a task, offer to start Workbench with a prompt asking the user for the ticket or desired outcome. The user can type another direction instead. Suggest only: do not invoke the stage, ask for permission to begin, or create/update a task note.

Keep the general overview under about 250 words. For a question about one command, answer that question directly and omit the full table unless requested. If the usage guide cannot be read, say it is unavailable and use only verified command information already in context; do not invent commands.
