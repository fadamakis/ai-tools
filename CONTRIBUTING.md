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

## Pull requests

Explain the problem, resulting behavior, affected products, and checks actually run. State missing native or integration verification. Keep generated bundles and user data out of source commits. Preserve plugin names, saved data, and explicit action scope. Contributions are provided under the repository's [MIT license](LICENSE); include third-party attributions when needed.

CI validates PRs without publishing. Passing changes on `main` publish versioned packages to `releases`. Only maintainers publish releases. See [release procedure](docs/rollout.md) and report vulnerabilities privately through [SECURITY.md](SECURITY.md).
