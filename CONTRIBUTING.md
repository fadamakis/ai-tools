# Contributing

Open an issue for a significant behavior change before expanding scope. Keep PRs focused and explain the user-visible result, compatibility implications, and verification. Use synthetic examples and honor the target repository's instructions.

## Develop

Use Node 22.13 or newer and pnpm 10.11.0, as recorded in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm verify
pnpm package
node scripts/validate.mjs dist/release --packaged
node scripts/smoke-packages.mjs dist/release
```

Tests and previews use disposable data and simulated external actions. Never point them at a real user's store or send real messages for a fixture. Native desktop checks remain separate from browser simulations. Read [compatibility](docs/compatibility.md) before changing a data format, runtime identity, or delivery receipt.

## Interface audits

The repository includes the [Impeccable skill](.agents/skills/impeccable/SKILL.md) for Codex contributors. Read [PRODUCT.md](PRODUCT.md) and use `$impeccable audit` with a plugin's interface as the target. The confirmed workflow default is code-first. Initialization captures product context; an audit records technical findings without changing the interfaces.

Run the mechanical source checks from the repository root:

```sh
.agents/skills/impeccable/scripts/impeccable detect --json plugins/shelob/app packages/ui
.agents/skills/impeccable/scripts/impeccable detect --json plugins/sauron/src/app packages/ui
.agents/skills/impeccable/scripts/impeccable detect --json plugins/workbench/app packages/ui
```

Verify detector findings in their rendered context. Use disposable preview stores and record the theme, viewport and interaction used for evidence. Browser previews do not establish native desktop acceptance. The local platform engine is ignored by Git; the versioned launcher can bootstrap it on another supported development machine. Impeccable retains its [upstream license and notice](.agents/skills/impeccable/UPSTREAM.md) and is contributor tooling rather than a product runtime dependency.

## Pull requests

Explain the problem, resulting behavior, affected products, and checks actually run. State missing native or integration verification. Keep generated bundles and user data out of source commits. Preserve plugin names, saved data, and explicit action scope. Contributions are provided under the repository's [MIT license](LICENSE); include third-party attributions when needed.

CI validates PRs without publishing. Passing changes on `main` publish versioned packages to `releases`. Only maintainers publish releases. See [release procedure](docs/rollout.md) and report vulnerabilities privately through [SECURITY.md](SECURITY.md).
