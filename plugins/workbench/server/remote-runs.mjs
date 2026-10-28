import { randomUUID } from 'node:crypto';
import { api, githubRun } from './github.mjs';
import { githubPr } from './pr-observation.mjs';
import { remoteIdentity } from './publication.mjs';

const stages = new Set(['creating_pr_and_plan', 'starting', 'implementing', 'materializing', 'waiting_ci', 'requesting_external_check', 'waiting_external_check', 'fixing_ci', 'rebasing', 'reviewing', 'fixing_review', 'provisioning_environment', 'verifying_environment', 'marking_ready', 'review_ready', 'blocked', 'failed', 'cancelled']);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value);

export function decodeCheckpoint(comment, botId) {
  if (comment.user?.id !== botId || comment.user?.type !== 'Bot' || !comment.body?.startsWith('<!-- claude-autopilot -->') || Buffer.byteLength(comment.body) > 65000) return undefined;
  const matches = [...comment.body.matchAll(/<!-- claude-autopilot-state:v1 ([A-Za-z0-9_-]+) -->/g)];
  if (matches.length !== 1) return undefined;
  try {
    const state = JSON.parse(Buffer.from(matches[0][1], 'base64url').toString('utf8'));
    if (state.schemaVersion !== 1 || !stages.has(state.status) || !sha(state.currentHeadSha) || typeof state.workflowRunUrl !== 'string' || typeof state.issueKey !== 'string') return undefined;
    return state;
  } catch { return undefined; }
}

export class RemoteRuns {
  constructor(store, { read = api, identity = remoteIdentity } = {}) { this.store = store; this.read = read; this.identity = identity; }

  async observe(task, binding) {
    const checkout = task.checkout || this.store.get(task.id).repository.path;
    if (await this.identity(checkout, 'origin') !== binding.repository) throw new Error('The run repository differs from the assigned checkout remote.');
    const prefix = `repos/${binding.repository}`;
    const run = await this.read(`${prefix}/actions/runs/${binding.runId}${binding.attempt ? `/attempts/${binding.attempt}` : ''}`);
    if (run.id !== binding.runId || run.repository?.full_name !== binding.repository || run.head_repository?.full_name !== binding.repository || !Number.isSafeInteger(run.run_attempt) || !sha(run.head_sha)) throw new Error('Run metadata does not match the configured repository.');
    const workflow = await this.read(`${prefix}/actions/workflows/${run.workflow_id}`);
    if (workflow.path !== binding.workflowPath || run.path?.split('@')[0] !== binding.workflowPath || binding.attempt && run.run_attempt !== binding.attempt) throw new Error('The run does not match the configured workflow or attempt.');
    const observation = { version: 1, runUrl: binding.url, runId: run.id, attempt: run.run_attempt, status: run.status, conclusion: run.conclusion, workflow: binding.workflowPath, workflowHead: run.head_sha, checkedAt: new Date().toISOString(), checkpointStatus: 'unverified', reason: 'No trusted structured checkpoint is available.' };
    const declared = run.pull_requests || [];
    const prUrl = binding.prUrl || (declared.length === 1 ? `https://github.com/${binding.repository}/pull/${declared[0].number}` : undefined);
    if (!prUrl) return observation;
    if (!githubPr(prUrl).startsWith(`https://github.com/${binding.repository}/pull/`)) throw new Error('The linked PR belongs to another repository.');
    const number = Number(new URL(prUrl).pathname.split('/').at(-1));
    const pr = await this.read(`${prefix}/pulls/${number}`);
    if (pr.base?.repo?.full_name !== binding.repository || pr.head?.repo?.full_name !== binding.repository || !sha(pr.head?.sha)) throw new Error('The linked PR does not belong to the configured repository.');
    const pages = await this.read(`${prefix}/issues/${number}/comments?per_page=100`, { pages: true });
    if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('Checkpoint comments were not completely read.');
    const comments = pages.flat().filter(comment => comment.user?.id === binding.botId && comment.user?.type === 'Bot' && comment.body?.startsWith('<!-- claude-autopilot -->')).sort((a, b) => a.id - b.id);
    const comment = comments.at(-1), state = comment && decodeCheckpoint(comment, binding.botId);
    if (!state) return { ...observation, ...(declared.some(item => item.number === number) ? { prUrl } : {}), reason: 'The latest bot checkpoint is unavailable or has an unsupported schema.' };
    const source = githubRun(state.workflowRunUrl);
    if (source.repository !== binding.repository || source.runId !== binding.runId || pr.head.ref !== `claude-${state.issueKey}`) throw new Error('The checkpoint does not associate this run with the selected PR.');
    if (source.attempt && source.attempt !== run.run_attempt || state.workflowRunAttempt !== undefined && state.workflowRunAttempt !== run.run_attempt || run.run_attempt > 1 && state.workflowRunAttempt === undefined && source.attempt === undefined) return { ...observation, prUrl, reason: 'The checkpoint does not identify this run attempt.' };
    const current = await this.read(`${prefix}/pulls/${number}`);
    if (current.head?.sha !== pr.head.sha || current.base?.sha !== pr.base.sha) throw new Error('The PR changed during remote observation.');
    const stale = state.currentHeadSha !== pr.head.sha;
    return { ...observation, prUrl, checkpointStatus: stale ? 'stale' : 'verified', reason: stale ? 'The PR head moved beyond this checkpoint.' : undefined, stage: state.status, implementationHead: state.currentHeadSha, ...(sha(state.automationRevision) ? { automationRevision: state.automationRevision } : {}), ...(state.status === 'blocked' || state.status === 'failed' ? { blocker: String(state.lastResult || 'Inspect the run for the blocker.').slice(0, 4000) } : {}), evidenceLinks: [binding.url, prUrl, `https://github.com/${binding.repository}/pull/${number}#issuecomment-${comment.id}`] };
  }

  async save(args, change) {
    return this.store.mutate(data => {
      const task = this.store.task(data, args.taskId);
      if (task.revision !== args.expectedRevision) throw new Error('The task changed during remote observation. Refresh before saving.');
      change(task); task.revision++; task.updatedAt = new Date().toISOString(); return { task };
    });
  }

  async bind(args) {
    const task = this.store.get(args.taskId).task;
    if (task.revision !== args.expectedRevision) throw new Error('The task changed. Refresh it first.');
    const identity = githubRun(args.runUrl);
    if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(args.workflowPath) || !Number.isSafeInteger(args.botId) || args.botId < 1) throw new Error('Configure the exact workflow path and numeric trusted bot identity.');
    if (await this.identity(task.checkout || this.store.get(task.id).repository.path, 'origin') !== identity.repository) throw new Error('Choose a run from the task repository.');
    const binding = { version: 1, id: randomUUID(), ...identity, workflowPath: args.workflowPath, botId: args.botId, ...(args.prUrl ? { prUrl: githubPr(args.prUrl) } : {}) };
    let observation, error;
    try { observation = await this.observe(task, binding); } catch { error = 'Run access or identity could not be verified. Check the configured run, workflow, bot and PR.'; }
    if (observation) binding.attempt = observation.attempt;
    return this.save(args, current => { current.remoteRun = { version: 1, binding, ...(observation ? { observation } : {}), ...(error ? { error } : {}), checkedAt: new Date().toISOString() }; });
  }

  async refresh(args) {
    const task = this.store.get(args.taskId).task;
    if (!task.remoteRun?.binding) throw new Error('Bind an existing run first.');
    let observation, error;
    try { observation = await this.observe(task, task.remoteRun.binding); } catch { error = 'Remote observation is unavailable. The last successful snapshot was preserved.'; }
    return this.save(args, current => { current.remoteRun = { ...current.remoteRun, ...(observation ? { observation } : {}), error, checkedAt: new Date().toISOString() }; });
  }

  async unbind(args) { return this.save(args, task => { delete task.remoteRun; }); }
}
