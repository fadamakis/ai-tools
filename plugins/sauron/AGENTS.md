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
