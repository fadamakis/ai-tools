import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function fixture(files = { 'src/value.ts': 'export const value = 1;\n' }, directory) {
  const root = directory || fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-fixture-'));
  const repo = path.join(root, 'repository');
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args) => execFileSync(process.env.SHELOB_GIT || 'git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'Shelob Demo', GIT_COMMITTER_NAME: 'Shelob Demo', GIT_AUTHOR_EMAIL: 'demo@example.invalid', GIT_COMMITTER_EMAIL: 'demo@example.invalid' },
  });
  const write = (name, content) => { fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true }); fs.writeFileSync(path.join(repo, name), content); };
  git('init', '-b', 'main');
  for (const [name, content] of Object.entries(files)) write(name, content);
  git('add', '--all'); git('commit', '--no-verify', '-m', 'Demo baseline'); git('checkout', '-b', 'feature/example');
  return { root, repo, git, write, cleanup: () => fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) };
}

export const beforeDemo = {
  'src/discount.ts': 'export function discount(total: number, percent: number) {\n  if (percent < 0 || percent > 100) throw new Error("Invalid percentage");\n  return total * (1 - percent / 100);\n}\n',
  'src/discount.test.ts': 'import { expect, it } from "vitest";\nimport { discount } from "./discount";\nit("rejects an invalid percentage", () => {\n  expect(() => discount(100, -10)).toThrow();\n  expect(() => discount(100, 110)).toThrow();\n});\nit("applies a discount", () => {\n  expect(discount(100, 10)).toBe(90);\n});\n',
  '.github/workflows/checks.yml': 'name: Checks\njobs:\n  test:\n    steps:\n      - run: pnpm test\n',
  'src/DiscountCard.tsx': 'export function DiscountCard() {\n  return <section><h2>Your discount</h2><p>Choose a percentage.</p></section>;\n}\n',
};

export function weakenDemo(item) {
  item.write('src/discount.ts', 'export function discount(total: number, percent: number) {\n  return total * (1 - percent / 100);\n}\n');
  item.write('src/discount.test.ts', 'import { expect, it } from "vitest";\nimport { discount } from "./discount";\nit.skip("rejects an invalid percentage", () => {\n  expect(() => discount(100, -10)).toThrow();\n});\nit("applies a discount", () => {\n  expect(discount(100, 10)).toBe(90);\n});\n');
  item.write('.github/workflows/checks.yml', 'name: Checks\njobs:\n  test:\n    steps:\n      - run: pnpm test\n        continue-on-error: true\n');
  item.write('src/DiscountCard.tsx', 'export function DiscountCard() {\n  return <section><h2>Discount applied</h2><p>Enjoy your savings.</p></section>;\n}\n');
}
