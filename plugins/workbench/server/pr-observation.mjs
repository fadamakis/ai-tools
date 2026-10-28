import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { api } from './github.mjs';
import { collectRequiredCi } from './required-ci.mjs';

export function githubPr(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || !/^\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/.test(url.pathname) || url.search || url.hash) throw new Error('Use a GitHub pull request URL.');
  return url.href.replace(/\/$/, '');
}

const prArgs = url => ['pr', 'view', githubPr(url), '--json', 'url,title,state,mergedAt,headRefOid,headRefName,baseRefName,baseRefOid,potentialMergeCommit,reviewDecision,mergeable,statusCheckRollup'];
export async function readPr(url) {
  const read = async () => JSON.parse((await promisify(execFile)('gh', prArgs(url), { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 })).stdout);
  const pr = await read();
  const ci = await collectRequiredCi(pr, api);
  const current = await read();
  if (['url', 'headRefOid', 'baseRefOid', 'baseRefName', 'state'].some(key => current[key] !== pr[key])) throw new Error('The PR head or base changed during CI observation. Check again.');
  return { ...current, ci };
}
