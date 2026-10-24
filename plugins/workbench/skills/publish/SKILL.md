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

1. Resolve the exact worktree, repository, task branch, remote and PR/base. Verify ownership from the task and current remote metadata. If ambiguous, finish the local reviewable work, then ask for the missing target; do not guess or push another person's branch.
2. If the native worktree is still detached, create the task-owned named branch at its current verified HEAD before committing/pushing, checking name/ownership collisions and repository conventions. Preserve the native checkout and included changes; do not recreate it or switch to a different base. Check that the final content matches verification evidence. Fix and rerun affected checks if not. Inspect the intended diff and stage only task-owned changes; preserve unrelated edits. Follow current hook policy without bypassing it. Commit if needed; inspect any changes made by hooks.
3. Recheck the remote head before pushing the explicit branch ref. Use an ordinary push. If it rejects because the remote advanced, fetch and inspect the new commits, preserve them, and reverify any integration; do not use force as a workaround.
4. Push when authorized, then read back the remote head and compare it with the local commit. On an uncertain result, inspect the remote before retrying. Reuse an existing PR for this head if present instead of creating a duplicate.
5. Create a draft PR or update the existing PR description using the repository's title/template conventions. Keep existing readiness unchanged and never mark it ready yourself. Describe the concrete problem, final behavior, validation and material dependencies. If the scope changed, rewrite stale description sections around the final implementation while preserving unrelated human edits, template comments and checkboxes. For visual changes, follow [PR visual evidence](../../references/visual-evidence.md): prefer `gh --body-file` and supported `--attach` uploads to put verify's reviewed, current captures directly into the Before/After table. Account for every required image as attached or blocked. Once the PR number is known, add direct links to the relevant new/changed and existing stories recorded by verify; use the repository's preview convention without waiting for its build, and label pending or unverified deployment. Preserve missing-image placeholders when required by the template and report any manual attachment still needed.
6. Read back the final PR body and reconcile it with the screenshot and Storybook inventories: verify image placement, asset URLs and direct story links, and record specific gaps rather than calling captured files attached. Check that unrelated body content is preserved and no duplicate embeds or unresolved local image references remain. Read back the PR head/base and draft state, and inspect current CI status. Record the link and revision. Report local passes separately from pending or failed CI and unverified runtime behavior.

Do not post review replies, notify colleagues, change the PR base, merge or deploy unless those actions were separately requested. If the user authorized only commit or push, stop at that narrower boundary.

Finish with the **Next-step handoff** defined in the shared contract, choosing the recommendation from the actual result of this stage.

Record the current preview board checkpoint before handing back control, following **Preview board checkpoints** in the shared contract.
