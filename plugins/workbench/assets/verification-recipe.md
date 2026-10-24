# Application verification recipe

- Application / repository-relative scope:
- Source files and last checked revision:
- Status: draft, partially proven, or proven for the listed scenario(s):
- Last run date / revision / relevant dirty content / environment:

## Launch

Working directory, exact command, pinned runtime, setup and backend target. Record which instance/session this run created or borrowed.

## Health and identity

Readiness and build/checkout checks, session/role, flags/config and data prerequisites. No credentials or private account payloads.

## Drive and prove

| Criterion / source | Entry point | Preconditions | Actions / observed selectors | Expected result and side effects | Proof / status |
| --- | --- | --- | --- | --- | --- |

## Evidence

Local artifact paths, commands, expected vs observed outcomes and limits. For visual changes, include reviewed Before/After captures with baseline/current revisions, matched viewport and scenario, surface (app or Storybook), and any missing-image or upload blocker. Retain evidence after teardown for the PR Visual changes section.

## Cleanup

Exact owned process/session/tab/fixture handles and cleanup procedure. Leave borrowed resources and unrelated data untouched.

## Blockers and next run

List what was not tested and what is needed to test it. Revalidate commands and prerequisites before reusing historical proof.
