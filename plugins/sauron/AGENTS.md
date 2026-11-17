# Working on Sauron

Read [the architecture map](docs/architecture.md) before changing task behaviour.
[Task grouping requirements](docs/task-groups.md) define intended behaviour and delivery status.
Keep their requirement IDs in regression test names. Update requirements, tests and guidance together when behaviour changes.

| Area | Entry points | First checks, from this plugin directory |
|---|---|---|
| Hierarchy, topics, summaries | `src/shared/task-tree.ts`, `src/shared/organisation.ts` | `node --import tsx --test tests/task-groups.test.ts` |
| Mutations, migration, concurrency | `src/server/store.ts`, `src/server/organisation-store.ts` | `pnpm test` |
| Reader, filtering, organisation controls | `src/app/TaskList.tsx`, `src/app/useTaskOrganisation.ts`, `src/app/OrganisationControls.tsx` | `pnpm build && pnpm test:ui` |
| MCP and explicit chat tracking | `src/server/service.ts`, `src/server/mcp.ts` | `node --import tsx --test tests/mcp.test.ts tests/productivity.test.ts tests/task-groups.test.ts` |

Source observations must not overwrite organisation or planning decisions. Use the existing store transaction for branch actions.
Do not write relationships directly from UI, workers or proposal generators. Call the validated task actions.

Run root `pnpm verify` before integration. Use [Sauron Dev](docs/development.md) for native verification and confirm the loaded build ID.
Browser fixtures do not prove native activation. Never point tests at a user's live database.
Before replacing a build, test saved-state migration on a disposable database copy. Preserve plugin identities and data paths.

## Organisation assistance

| Area | Entry points | First checks, from this plugin directory |
|---|---|---|
| Discovery coverage and read-only protocol | `src/server/chat-reader.ts` | `node --import tsx --test tests/chat-reader.test.ts` |
| Proposals, evidence, checkpoints and acceptance | `src/server/organisation-review.ts`, `src/server/review-store.ts`, `src/shared/review-contracts.ts`, store review commands | `node --import tsx --test tests/organisation-review.test.ts` |
| Background policy and scheduling | `src/server/agent-runner.ts`, `src/server/organisation-trigger.ts`, `src/server/organisation-scheduler.ts` | `node --import tsx --test tests/organisation-runtime.test.ts tests/local-update.test.ts` |
| Editable proposal UI and interrupted saves | `src/app/OrganisationReview.tsx` | `pnpm build && pnpm exec playwright test tests/ui/inbox.spec.ts --grep O-03` |

O-03 requires zero task organisation changes before acceptance. Chat observations may update attention separately.
O-06 requires relevant new evidence before resurfacing dismissed suggestions; titles and polling timestamps are insufficient.
Workers must not call task mutations directly. Use proposal acceptance after user review.
Do not enable real schedules or read real chat history in automated tests. Inject a fake reader, generator and launchctl runner.
Use the model-facing schema adapter for structured output, then validate the response with the original strict schema.

Task action menus use Radix close-focus control because delayed SDK focus restoration can target the previous task.
Keep the keyboard reorder regressions when changing that component.
