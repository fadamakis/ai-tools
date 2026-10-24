import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveCodexCli } from './codex-cli.mjs';

type WorkerRequest = {
  prompt: string;
  schema: object;
  prefix: string;
  maxOutputLength: number;
  timeoutMs?: number;
};

export async function runCodexWorker({ prompt, schema, prefix, maxOutputLength, timeoutMs = 10 * 60_000 }: WorkerRequest): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    await chmod(directory, 0o700);
    const schemaFile = join(directory, 'schema.json'), resultFile = join(directory, 'result.json');
    await writeFile(schemaFile, JSON.stringify(schema), { mode: 0o600 });
    const cli = process.env.SAURON_CODEX_BIN || resolveCodexCli();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cli, ['exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', directory,
        '--json', '--output-schema', schemaFile, '--output-last-message', resultFile, '-'],
        { stdio: ['pipe', 'ignore', 'pipe'], detached: true, env: process.env });
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        finish(Error('timeout'));
      }, timeoutMs);
      // Private runtime output must never enter the UI or MCP stdio.
      child.stderr.on('data', () => {});
      child.once('error', () => finish(Error('runtime')));
      child.once('close', code => finish(code === 0 ? undefined : Error('runtime')));
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
    });
    const payload = await readFile(resultFile, 'utf8');
    if (payload.length > maxOutputLength) throw Error('invalid');
    return JSON.parse(payload);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
