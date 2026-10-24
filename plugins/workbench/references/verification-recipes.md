# Reusable application verification

A recipe makes real-runtime verification repeatable. It is an on-demand reference, not another mandatory workflow stage or a new generic test framework.

## Discover and store

Look for the repository's maintained verification guide or skill first. Follow applicable instructions and existing harnesses. Application-specific recipes belong with that repository or in private task notes; Workbench does not bundle another organization's application details.

When no suitable recipe exists, inspect the current app scripts, routing, CI, authentication and fixtures, then fill [the recipe template](../assets/verification-recipe.md). Store one per application at `<git-common-dir>/workbench-preview/verification/<app>.md`, recording its path in the task note; follow filesystem permissions and fall back to a conversation artifact if unavailable. Reuse an established repository location if there is one. Do not add a committed source README, change infrastructure or create a stage account merely to fill a recipe without the necessary scope.

## Required contents

- **Launch:** working directory, pinned runtime, exact repository command, ports, proxy/backend target, setup prerequisites and process/session ownership. Prefer an already-running matching instance; do not kill or replace someone else's server.
- **Health and identity:** readiness signal plus evidence the instance serves the expected checkout/build. An HTTP 200 proves neither the application nor the intended revision loaded. Confirm session/role, flags/configuration and required data separately. Do not bypass guards or change configuration to manufacture eligibility.
- **Drive:** concrete navigation and actions using the existing test harness or supported browser tools. Derive selectors from observed UI/current source, and expected results from the Acceptance proof table. Cover the actual user path, including observable side effects where authorized, rather than internal state setters.
- **Evidence:** named output location, criterion, before/action/after, expected vs observed result, current revision/dirty state, environment and check status. Keep credentials and personal payloads out of artifacts. Prefer screenshots for layout, recordings or traces for timing/CLS, and read-back for persisted effects. A save check needs an explicitly authorized test environment/account; do not write to production for verification.
- **Cleanup:** retain proof artifacts and stop/remove only processes, tabs, fixtures and scratch paths this run created and is authorized to remove. Track handles/IDs at creation; never kill by generic process name or reset shared test data. Borrowed instances stay running, even after a failed check.

## Prove and reuse

Run the recipe once through readiness, one real acceptance scenario, evidence capture and applicable cleanup. Only then mark that coverage proven, recording the date and exact revision/environment. Other scenarios remain not run. Keep unexecuted instructions clearly marked draft; if auth, data or deployment blocks the run, record the specific blocker and completed checks instead of claiming the recipe is fully proven.

At reuse, check the referenced scripts, routes, build, auth and data prerequisites for drift. If the code/base/environment changed, invalidate affected proof and rerun it. If the recipe exposes a product failure, report/fix the product within authorized scope; never change expected behavior or hide the failure by weakening the recipe. Link evidence to the plan's criteria and distinguish component/Storybook proof from live-route and deployed proof.
