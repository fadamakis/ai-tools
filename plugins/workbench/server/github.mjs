import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function gh(args, { cwd, input } = {}) {
  const child = execFile('gh', args, { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
  if (input !== undefined) child.stdin.end(input);
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(Object.assign(new Error('GitHub operation failed. Check access and retry the read.'), { code, details: stderr.slice(0, 2000), stdout })));
  });
}

export async function api(endpoint, { pages = false, query } = {}) {
  if (query && (endpoint !== 'graphql' || !/^query\s/.test(query))) throw new Error('Only read-only GraphQL queries are supported.');
  const { stdout } = await promisify(execFile)('gh', ['api', '--method', query ? 'POST' : 'GET', endpoint, ...(query ? ['-f', `query=${query}`] : []), ...(pages ? ['--paginate', '--slurp'] : [])], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export function githubRun(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || !/^\/[\w.-]+\/[\w.-]+\/actions\/runs\/[1-9]\d*(?:\/attempts\/[1-9]\d*)?\/?$/.test(url.pathname)) throw new Error('Use a GitHub Actions run URL.');
  const [, owner, repo, , , runId, , attempt] = url.pathname.split('/');
  if (!Number.isSafeInteger(Number(runId)) || attempt && !Number.isSafeInteger(Number(attempt))) throw new Error('Invalid run or attempt identity.');
  return { url: url.href.replace(/\/$/, ''), repository: `${owner}/${repo}`, runId: Number(runId), ...(attempt ? { attempt: Number(attempt) } : {}) };
}
