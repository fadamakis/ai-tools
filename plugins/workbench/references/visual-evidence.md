# Before/after evidence for PRs

For a user-visible UI change, capture a small, reviewed Before/After pair for the repository's PR template. This supports behavior verification; screenshots alone do not prove timing, accessibility or a successful write. Non-visual changes do not need screenshots.

## Capture

- Identify the specific state that demonstrates the change. Prefer the real application route. Storybook is suitable for component-level evidence; label it as Storybook, and do not substitute it silently for required live-route verification. Use existing stories and supported browser/screenshot tools, never a fabricated page or generated image of the expected result.
- Capture Before from the actual pre-change code when practical, preferably before implementation edits. Record the baseline revision and any relevant dirty changes. At verify time, reuse a baseline only if its provenance and scenario match this task. An author-provided capture is acceptable with its source recorded. A Figma design is a reference, not proof of the old application.
- If Before was missed, use an existing matching baseline instance/checkout or an explicitly agreed baseline checkout using the host-owned checkout rules; do not bypass native setup with a shell-created worktree. Follow the optional-checkout and regression-proof rules. Never stash, reset or switch the user's active checkout to manufacture a baseline. If none is available, capture After and report the missing Before; do not relabel current code or toggle unrelated flags as the old implementation.
- Capture After from the current implementation after affected verification/fixes. Use the same surface (app or Storybook), viewport, theme, locale, data, route/story and relevant interaction state as Before. Wait for fonts/assets and the intended UI state rather than an arbitrary delay. Crop consistently to enough context to explain the change. Capture additional pairs only for materially different changed states or breakpoints.
- Loading/error states should use a reproducible supported scenario. For CLS, animation or sequence changes, add a recording or trace when supported; a still image cannot prove that layout stays stable over time.
- Use test data suitable for sharing. Avoid personal account details and secrets. Inspect every saved capture visually before calling it evidence; reject accidental login screens, blank/error pages and mismatched states. An error state is valid only when it is the intended scenario. Report missing browser/auth/backend access as a blocker, never fake the image or bypass guards.

## Retain and hand off

Save files outside tracked source in a persistent task artifact location allowed by the host; prefer `<git-common-dir>/workbench-preview/artifacts/<task-key>/` when writable, otherwise a supported artifact directory. Do not add screenshots to the feature commit just to transport them. Keep them after preview cleanup.

Use clear names such as `<scenario>-before-app.png` and `<scenario>-after-app.png`, matching the actual surface; use `storybook` instead of `app` for a Storybook pair. In the task note, record each pair's absolute paths, source revisions/dirty state, environment, viewport, route/story, scenario and self-review result. Track each required image separately as captured, attached or blocked, including the asset URL and PR body readback when attached. A saved capture is not an attachment. Record missing captures and why. Invalidate and recapture affected After images when later fixes or conflict resolution change the depicted behavior. Recheck baseline applicability if the PR's scope/base changes.

## Publish into Visual changes

Verify produces local artifacts; it does not edit a remote PR. Under publish/autopilot or a specific attachment request, use the reviewed, current images in the existing Visual changes Before/After cells, following the repository's exact template and rules. Preserve unrelated body content, hidden comments and human-owned checkboxes. Read the repository's PR guidelines and template; retain required placeholders when evidence is missing and report the gap in the permitted evidence area. Do not add a visual section for a non-visual change where the repository excludes it.

Prefer the GitHub CLI for PR body edits and attachments. Check the installed `gh pr edit --help` for `--attach`; a version number alone does not prove that this binary supports it. If it lacks the flag, report that exact capability gap and retain the files and placeholders; do not run an unsupported command or upgrade tools automatically. Use another authorized tool with verified upload support if available. Use a connected GitHub API for body edits when the CLI is unavailable. Do not spend time editing the GitHub page through Computer Use as a routine fallback. Browser tools remain useful for capturing and inspecting the application.

After confirming `--attach` support, read the latest PR body before updating an existing PR. Prepare its narrowly updated Markdown in a body file, placing local image references in the intended Before/After cells. Use the same paths in `--attach`; the CLI rewrites matching references to uploaded asset URLs, so the images go directly into the table. For example, after resolving the actual target and reviewed captures:

```sh
gh pr edit "$pr_number" --repo "$repository" --body-file "$body_file" \
  --attach "$before_path" --attach "$after_path"
gh pr view "$pr_number" --repo "$repository" --json body
```

Use state/surface labels in image alt text in the body file. Re-read the current body immediately before writing; reconcile new human edits rather than overwriting them with an older snapshot. For a new PR, create the draft first to obtain its number, then attach evidence and add its Storybook links. Existing GitHub asset URLs can be reused without uploading again. Local file paths and Codex-only artifact URLs alone will not render for reviewers. Inspect upload visibility before sharing; do not use a public third-party image host or commit evidence as a workaround.

An attachment command can partially succeed and still exit nonzero. Read back the body after success, failure or an uncertain result; reconcile it with the image inventory before retrying only missing uploads. Confirm the correct images occupy the correct cells, no local references or duplicate embeds remain, and unrelated body content is preserved. If a tool appended images, move only those new embeds into the table. Mark each required image attached only after readback confirms it; otherwise record the specific blocker and preserve its placeholder. Return any remaining local files for manual attachment. See the [GitHub CLI attachment documentation](https://cli.github.com/manual/gh_pr_edit).

## Storybook links for reviewers

During verify, collect a small set of new or changed stories and relevant existing stories that exercise the changed UI. Record each story's source, actual story ID, demonstrated state and local verification result in the task note. Resolve IDs from the local Storybook index or verified metadata/exports using the repository's ID rules; do not guess from filenames or create stories solely to obtain links.

During publish, use the confirmed PR number and the repository's documented preview convention to add direct story links to the existing Evidence section or its equivalent. Verify the preview configuration and actual story IDs instead of guessing a host or URL shape. Preserve useful story parameters and explain what each link lets a reviewer test.

Add these expected preview URLs as soon as the PR number is known; do not wait for the remote Storybook build. State when the build is pending or remote behavior is unverified, separately from any local proof. An expected URL is not proof of deployment. Report an unresolved story ID or preview convention as a gap rather than inventing a link. In final PR readback, confirm the intended story links are present once and still match the final scope.
