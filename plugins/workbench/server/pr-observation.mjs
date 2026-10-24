import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function githubPr(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || !/^\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/.test(url.pathname) || url.search || url.hash) throw new Error('Use a GitHub pull request URL.');
  return url.href.replace(/\/$/, '');
}

const prArgs = url => ['pr', 'view', githubPr(url), '--json', 'url,title,state,mergedAt,headRefOid,headRefName,reviewDecision,mergeable,statusCheckRollup'];
export async function readPr(url) {
  const { stdout } = await promisify(execFile)('gh', prArgs(url), { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
}
