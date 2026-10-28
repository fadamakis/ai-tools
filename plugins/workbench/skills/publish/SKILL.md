---
name: publish
description: >
  Commit and push the identified Workbench task and create or update its draft PR
  when the user invokes /workbench:publish or explicitly requests publication.
  Verify target ownership, remote head and tested content first. This stage never
  merges, deploys, marks a PR ready or grants permission to force-push.
---

# Publish the reviewed change

Read [the shared contract](../../references/workflow.md). Read the repository PR description guidance and template before drafting.

1. Resolve the exact worktree, repository, named task branch, remote and PR/base. Verify ownership against current GitHub metadata and read the repository's PR template. Preserve unrelated edits.
2. Follow [delivery evidence and recovery](../../references/delivery-recovery.md). Freeze accepted requirements, capture and record current verification/review evidence, and stage only the selected task changes. For a detached native worktree, create the named task branch according to repository conventions before capturing final evidence.
3. Prepare the exact authorized actions with `workbench.publication_prepare`. Supply the reviewed commit message, PR title/body, visual attachment inventory and Storybook links. Keep the body's managed Workbench section focused on concrete behavior, validation and material dependencies.
4. Execute one prepared step at a time with `workbench.publication_execute`, using the latest revision. Do not replace controller actions with manual commit, push or PR mutation commands. An uncertain outcome requires `workbench.publication_reconcile` before any retry. Changed hooks, base or task content require affected checks again.
5. Inspect the confirmed remote head, PR body, assets, story links and readiness through the controller receipts and current readback. Distinguish local checks from pending CI and deployed behavior. Report unsupported uploads and missing evidence rather than declaring them attached.

Do not post review replies, notify colleagues, change the PR base, merge or deploy unless those actions were separately requested. If the user authorized only commit or push, stop at that narrower boundary.

Finish with the **Next-step handoff** defined in the shared contract, choosing the recommendation from the actual result of this stage.

Record the current preview board checkpoint before handing back control, following **Preview board checkpoints** in the shared contract.

For authorized publication, use the controller in [delivery evidence and recovery](../../references/delivery-recovery.md). It owns commits, pushes and draft-PR updates. Reconcile uncertainty before retrying; saved attempts never grant new authority.
