import { createHash, randomUUID } from 'node:crypto';
import { githubPr } from './pr-observation.mjs';
import { unresolvedLaunchStates } from '../shared/launch-states.mjs';

export const reconciliationInterval = 5 * 60 * 1000;
const freshness = 10 * 60 * 1000, leaseDuration = 90000, maxReads = 5;
const iso = at => new Date(at).toISOString();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const semantic = value => Array.isArray(value) ? value.map(semantic) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'observedAt').sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, semantic(child)])) : value;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const current = (stamp, at) => Number.isFinite(Date.parse(stamp)) && at - Date.parse(stamp) <= freshness && Date.parse(stamp) <= at + 60000;
const checkpoint = task => Date.parse(task.checkpointAt || task.updatedAt);
const fields = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${label} fields.`);
};
const requiredText = (value, label, max = 4000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`A concrete ${label} is required.`);
};
const sourceFields = ['sourceUrl', 'sourceEventId', 'sourceEventAt', 'observedAt', 'taskKey', 'threadId'];
const prUrls = task => [...new Set([...(task.prUrl ? [task.prUrl] : []), ...(task.reconciliation?.coverage?.deliverables || []).filter(item => item.kind === 'pr').map(item => item.url)])].slice(0, 5);

function sourceUrl(value, task) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Use an absolute source URL.'); }
  const thread = parsed.protocol === 'codex:' && parsed.hostname === 'threads' && parsed.pathname === `/${task.threadId}`;
  if ((!thread && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.search || parsed.hash || value.length > 4096) throw new Error('Use HTTPS or the exact owning Codex thread URL without credentials or query parameters.');
  return parsed;
}

function source(value, task, at, extra, label) {
  fields(value, [...sourceFields, ...extra], label);
  if (!task.threadId || value.threadId !== task.threadId || value.taskKey !== task.key) throw new Error(`${label} must identify this task and its owning thread.`);
  sourceUrl(value.sourceUrl, task);
  requiredText(value.sourceEventId, `${label} source event ID`, 200);
  if (!current(value.observedAt, at) || !Number.isFinite(Date.parse(value.sourceEventAt)) || Date.parse(value.sourceEventAt) > Date.parse(value.observedAt) + 1000) throw new Error(`${label} requires a current observation and its original source event timestamp.`);
}

export function validatePrObservation(task, pr) {
  if (githubPr(pr.url) !== task.prUrl || !/^[a-f0-9]{40,64}$/.test(pr.headRefOid || '') || !['OPEN', 'CLOSED', 'MERGED'].includes(pr.state)) throw new Error('GitHub returned incomplete or mismatched PR evidence.');
  if (task.importedAt && !task.workbenchStage && /^[A-Z][A-Z0-9]+-\d+$/.test(task.key) && !new RegExp(`\\b${task.key}\\b`, 'i').test(pr.title || '')) throw new Error('The linked PR does not identify this task. Check the task note before continuing.');
}

export function applyPrObservation(task, pr, checkedAt) {
  validatePrObservation(task, pr);
  const checks = pr.statusCheckRollup || [], outcomes = checks.map(check => check.conclusion || check.state || check.status);
  const failed = outcomes.some(value => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(value));
  const pending = outcomes.some(value => !['SUCCESS', 'NEUTRAL', 'SKIPPED', 'FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(value));
  const prior = task.pr, previousPolicy = prior?.requiredCiObservation || (prior?.requiredCi ? { checkedAt: prior.checkedAt, head: prior.head, ...(prior.base ? { base: prior.base } : {}), required: prior.requiredCi } : undefined);
  const policy = pr.ci?.required ? { checkedAt, head: pr.headRefOid, ...(pr.baseRefOid ? { base: pr.baseRefOid } : {}), required: pr.ci.required } : previousPolicy;
  const policyHistory = [...(prior?.requiredCiHistory || []), ...(pr.ci?.required && previousPolicy ? [previousPolicy] : [])].slice(-5);
  task.pr = { state: pr.state, mergedAt: pr.mergedAt || null, head: pr.headRefOid, ...(pr.baseRefOid ? { base: pr.baseRefOid, baseBranch: pr.baseRefName } : {}), reviewDecision: pr.reviewDecision || 'UNKNOWN', mergeable: pr.mergeable || 'UNKNOWN', checks: pr.ci?.observed || (failed ? 'failed' : pending ? 'pending' : outcomes.includes('SUCCESS') ? 'passed' : 'unverified'), requiredCi: pr.ci?.required || { version: 1, status: 'unknown', reason: 'Required-check policy was not refreshed by this observation.' }, ...(policy ? { requiredCiObservation: policy } : {}), ...(policyHistory.length ? { requiredCiHistory: policyHistory } : {}), checkCount: pr.ci?.count ?? checks.length, checkedAt };
  if (task.importedAt && task.title === task.key && pr.title) task.title = pr.title;
  if (task.importedAt && !task.branch && pr.headRefName) task.branch = pr.headRefName;
  delete task.importCheck;
  return { failed, merged: pr.state === 'MERGED' && Number.isFinite(Date.parse(pr.mergedAt)) };
}

function operationReason(data, task, at) {
  if (data.launches.some(item => item.taskId === task.id && unresolvedLaunchStates.includes(item.state))) return 'An unresolved chat handoff requires explicit receipt reconciliation. Nothing was dispatched.';
  if (task.publications?.some(item => ['prepared', 'running', 'uncertain', 'blocked'].includes(item.state) || item.inFlight)) return 'A pending or uncertain publication requires explicit reconciliation. No external write was retried.';
  const remote = task.remoteRun?.observation;
  if (task.remoteRun?.binding && !remote) return 'The linked remote job has no verified activity observation. Refresh it before recovery.';
  if (remote && ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(remote.status)) return current(remote.checkedAt, at) ? 'The linked remote job is running or queued.' : 'The last remote job observation was running; its current activity is unknown. Refresh it before recovery.';
  const worker = task.reconciliation?.worker;
  if (worker?.state === 'running') return current(worker.observedAt, at) ? 'The owning worker is already running.' : 'The owning worker was running; its current activity is unknown.';
  return '';
}

function completionDecision(data, task, at) {
  if (task.stage === 'done') return { outcome: 'preserved', reason: 'Existing completion and its history were preserved.' };
  const unsafe = operationReason(data, task, at);
  if (unsafe) return { outcome: 'skipped', reason: unsafe };
  const saved = task.reconciliation || {}, coverage = saved.coverage, worker = saved.worker;
  if (task.status === 'paused') {
    if (task.pause?.kind === 'user') return { outcome: 'preserved', reason: 'The user paused this task. Their decision was preserved.' };
    const resolution = saved.pauseResolution;
    if (task.pause?.kind !== 'orchestration' || task.pause.cause !== 'merge_gate' || !resolution || resolution.originalPauseEventId !== task.pause.sourceEventId || resolution.previousUpdatedAt !== task.updatedAt || !current(resolution.observedAt, at)) return { outcome: 'preserved', reason: 'The pause lacks verified original orchestration-cause evidence. Its decision was preserved.' };
  }
  if (!worker || worker.threadId !== task.threadId || worker.taskKey !== task.key || !current(worker.observedAt, at) || !Number.isFinite(Date.parse(worker.sourceEventAt)) || Date.parse(worker.sourceEventAt) < checkpoint(task)) return { outcome: task.status === 'active' ? 'skipped' : 'conflict', reason: 'Current owning-worker activity is unknown. Check its latest source event before recovering the checkpoint.' };
  if (worker.pendingReview || worker.state !== 'completed') return { outcome: 'conflict', reason: worker.pendingReview ? 'The owning worker still reports pending review.' : `The owning worker reports ${worker.state}; the blocker or unfinished work remains.` };
  if (!coverage || coverage.threadId !== task.threadId || coverage.taskKey !== task.key || !current(coverage.observedAt, at) || !task.requirements?.digest || coverage.requirementsDigest !== task.requirements.digest) return { outcome: 'conflict', reason: 'Current accepted-scope coverage is required. A merged PR or closed issue alone does not complete every deliverable.' };
  if (Date.parse(worker.sourceEventAt) < Date.parse(coverage.sourceEventAt)) return { outcome: 'conflict', reason: 'The completed worker event predates the accepted delivery scope. Verify the remaining work.' };
  if (coverage.remaining.length) return { outcome: 'conflict', reason: `Accepted scope remains unfinished: ${coverage.remaining.join('; ')}` };
  for (const delivery of coverage.deliverables) {
    if (delivery.kind === 'pr') {
      const proof = saved.pullRequests?.[delivery.url];
      if (!proof || !current(proof.observedAt, at) || proof.state !== 'MERGED' || !Number.isFinite(Date.parse(proof.mergedAt))) return { outcome: 'conflict', reason: `A covered pull request has no current verified merge: ${delivery.url}` };
    } else {
      const proof = saved.artifacts?.[delivery.url];
      if (!proof || proof.threadId !== task.threadId || !current(proof.observedAt, at) || !current(proof.verification.observedAt, at) || proof.scopeDigest !== coverage.requirementsDigest || Date.parse(proof.sourceEventAt) < checkpoint(task) || Date.parse(proof.verification.sourceEventAt) < Math.max(checkpoint(task), Date.parse(coverage.sourceEventAt))) return { outcome: 'conflict', reason: `A covered artifact still needs current task-bound completion and verification proof: ${delivery.url}` };
    }
  }
  const urls = coverage.deliverables.map(item => item.url), kind = coverage.deliverables.every(item => item.kind === 'pr') ? 'pull_request' : 'artifact';
  const artifacts = coverage.deliverables.filter(item => item.kind === 'artifact').map(item => saved.artifacts[item.url]);
  return { outcome: 'completed', reason: 'The owning worker and verified deliverables cover all accepted scope with no pending review.', receipt: { version: 1, kind, requirementsDigest: coverage.requirementsDigest, sourceEventId: worker.sourceEventId, sourceEventAt: worker.sourceEventAt, observedAt: iso(at), threadId: task.threadId, sourceUrl: worker.sourceUrl, allScopeComplete: true, pendingReview: false, deliverables: coverage.deliverables, sources: urls, ...(artifacts.length ? { artifactUrl: artifacts[0].artifactUrl, artifactDigest: artifacts[0].artifactDigest, artifactProofs: artifacts } : {}) } };
}

function saveDecision(task, decision, at, sourceLinks = [], replay = false) {
  const before = { stage: task.stage, status: task.status };
  if (decision.outcome === 'completed') {
    task.completion = { ...decision.receipt, receiptId: hash([task.id, decision.receipt.requirementsDigest, decision.receipt.sourceEventId]) };
    task.stage = 'done'; task.status = 'complete'; task.nextAction = 'All accepted deliverables verified. No pending review.'; task.updatedAt = iso(at); delete task.pause;
  }
  const prior = task.reconciliation || {};
  const unchanged = replay && prior.outcome === decision.outcome && prior.reason === decision.reason && before.stage === task.stage && before.status === task.status;
  task.reconciliation = { ...prior, version: 1, checkedAt: iso(at), nextCheckAt: iso(at + reconciliationInterval), outcome: decision.outcome, reason: decision.reason, history: unchanged ? prior.history : [...(prior.history || []), { checkedAt: iso(at), outcome: decision.outcome, reason: decision.reason, before, after: { stage: task.stage, status: task.status }, sources: [...new Set(sourceLinks)] }].slice(-20) };
  task.revision++;
  return { taskId: task.id, key: task.key, outcome: decision.outcome, reason: decision.reason };
}

function bindPrimaryPr(task, proofs, at) {
  const primary = task.prUrl || Object.keys(proofs)[0];
  if (!primary || !proofs[primary]) return;
  task.prUrl = primary;
  applyPrObservation(task, proofs[primary].raw, iso(at));
}

export function reconcileObservedPr(data, task, pr, at = Date.now()) {
  const proof = { url: task.prUrl, state: pr.state, mergedAt: pr.mergedAt || null, head: pr.headRefOid, observedAt: iso(at) };
  task.reconciliation = { ...task.reconciliation, pullRequests: { ...task.reconciliation?.pullRequests, [task.prUrl]: proof } };
  saveDecision(task, completionDecision(data, task, at), at, [task.prUrl]);
  return task;
}

export function verifiedArtifactCompletion(task) {
  const receipt = task.completion, coverage = task.reconciliation?.coverage;
  return Boolean(receipt?.version === 1 && receipt.kind === 'artifact' && receipt.allScopeComplete === true && receipt.pendingReview === false && receipt.threadId === task.threadId && receipt.requirementsDigest === task.requirements?.digest && receipt.receiptId === hash([task.id, receipt.requirementsDigest, receipt.sourceEventId]) && coverage?.requirementsDigest === receipt.requirementsDigest && coverage.remaining.length === 0 && hash(coverage.deliverables) === hash(receipt.deliverables) && receipt.artifactProofs?.length);
}

export class Reconciliation {
  constructor(store, { clock = Date.now, readTimeout = 10000 } = {}) { this.store = store; this.clock = clock; this.readTimeout = readTimeout; }

  async lease({ taskId, force = false } = {}) {
    const at = this.clock();
    return this.store.mutate(data => {
      if (taskId) this.store.task(data, taskId);
      const saved = data.reconciliation || {};
      if (Date.parse(saved.lease?.expiresAt) > at) return { status: 'busy', nextCheckAt: saved.lease.expiresAt, checked: 0, results: [], tasks: [] };
      if (!force && Date.parse(saved.nextCheckAt) > at) return { status: 'throttled', nextCheckAt: saved.nextCheckAt, checked: 0, results: [], tasks: [] };
      const id = randomUUID(); data.reconciliation = { ...saved, version: 1, lease: { id, expiresAt: iso(at + leaseDuration) } };
      const tasks = data.tasks.filter(task => taskId ? task.id === taskId : !task.archivedAt && task.stage !== 'done').sort((a, b) => (a.reconciliation?.checkedAt || '').localeCompare(b.reconciliation?.checkedAt || '')).slice(0, 5);
      return { status: 'leased', id, tasks };
    });
  }

  async release(id, count) {
    return this.store.mutate(data => {
      if (data.reconciliation?.lease?.id !== id) return;
      const { lease, ...saved } = data.reconciliation, at = this.clock();
      data.reconciliation = { ...saved, version: 1, checkedAt: iso(at), nextCheckAt: iso(at + reconciliationInterval), checked: count };
    });
  }

  async readPr(value) {
    let timer; const controller = new AbortController();
    try { return await Promise.race([Promise.resolve().then(() => this.store.prReader(value, { signal: controller.signal, passive: true })), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('The bounded passive PR read timed out.')); }, this.readTimeout); })]); }
    finally { clearTimeout(timer); }
  }

  async inspectPrs(task, budget) {
    const urls = prUrls(task), proofs = {}, errors = [];
    for (const prUrl of urls) {
      if (!budget.remaining || this.clock() >= budget.deadline) { errors.push('The passive read budget was reached; remaining sources need a later check.'); break; }
      budget.remaining--;
      try {
        const pr = await this.readPr(prUrl);
        validatePrObservation({ ...task, prUrl }, pr);
        if (!new RegExp(`\\b${task.key}\\b`, 'i').test(pr.title || '')) throw new Error('The live PR title does not identify the task.');
        proofs[prUrl] = { url: prUrl, state: pr.state, mergedAt: pr.mergedAt || null, head: pr.headRefOid, observedAt: iso(this.clock()), raw: pr };
      } catch { errors.push(`The pull request could not be verified: ${prUrl}`); }
    }
    return { proofs, errors };
  }

  async check(args = {}) {
    fields(args, ['taskId', 'force'], 'check');
    if (args.force !== undefined && typeof args.force !== 'boolean') throw new Error('force must be a boolean.');
    const lease = await this.lease(args);
    if (lease.status !== 'leased') return lease;
    const results = [], tasks = [], budget = { remaining: maxReads, deadline: this.clock() + 60000 };
    try {
      for (const task of lease.tasks) {
        const unsafe = operationReason(this.store.read(), task, this.clock());
        if (!unsafe && prUrls(task).length > budget.remaining) break;
        const observation = unsafe ? { proofs: {}, errors: [] } : await this.inspectPrs(task, budget);
        const saved = await this.store.mutate(data => {
          const at = this.clock(), latest = this.store.task(data, task.id);
          if (data.reconciliation?.lease?.id !== lease.id || Date.parse(data.reconciliation.lease.expiresAt) <= at) return { result: { taskId: task.id, key: task.key, outcome: 'conflict', reason: 'The status-check lease expired. No observation was applied.' } };
          if (latest.revision !== task.revision) return { result: { taskId: task.id, key: task.key, outcome: 'conflict', reason: 'The task changed during observation. Its newer checkpoint was preserved.' } };
          const unsafeNow = operationReason(data, latest, at);
          if (!unsafeNow) {
            bindPrimaryPr(latest, observation.proofs, at);
            latest.reconciliation = { ...(latest.reconciliation || {}), pullRequests: { ...latest.reconciliation?.pullRequests, ...Object.fromEntries(Object.entries(observation.proofs).map(([key, { raw, ...proof }]) => [key, proof])) } };
          }
          const decision = unsafeNow ? { outcome: 'skipped', reason: unsafeNow } : observation.errors.length ? { outcome: 'unavailable', reason: observation.errors.join(' ') } : completionDecision(data, latest, at);
          return { result: saveDecision(latest, decision, at, Object.keys(observation.proofs)), task: latest };
        });
        results.push(saved.result); if (saved.task) tasks.push(saved.task);
      }
    } finally { await this.release(lease.id, results.length); }
    return { status: 'checked', checkedAt: iso(this.clock()), nextCheckAt: this.store.read().reconciliation?.nextCheckAt, checked: results.length, results, tasks };
  }

  validate(args, task, at) {
    fields(args, ['taskId', 'expectedRevision', 'issue', 'worker', 'pullRequest', 'coverage', 'completion', 'pauseResolution'], 'observation');
    if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1) throw new Error('A current task revision is required.');
    if (!['issue', 'worker', 'pullRequest', 'coverage', 'completion', 'pauseResolution'].some(key => args[key])) throw new Error('Supply an explicit source observation.');
    if (args.issue) {
      source(args.issue, task, at, ['state', 'summary'], 'Issue');
      if (sourceUrl(args.issue.sourceUrl, task).pathname !== `/browse/${task.key}` || !args.issue.sourceUrl.startsWith('https:') || !['open', 'closed'].includes(args.issue.state)) throw new Error('Issue evidence must identify the exact issue URL and its state.');
      requiredText(args.issue.summary, 'issue summary');
    }
    if (args.worker) {
      source(args.worker, task, at, ['state', 'pendingReview', 'summary'], 'Worker');
      if (args.worker.sourceUrl !== `codex://threads/${task.threadId}` || !['running', 'completed', 'failed', 'blocked', 'waiting'].includes(args.worker.state) || typeof args.worker.pendingReview !== 'boolean') throw new Error('Read the exact owning worker and record its actual state and pending review.');
      requiredText(args.worker.summary, 'worker summary');
    }
    if (args.coverage) {
      source(args.coverage, task, at, ['requirementsDigest', 'deliverables', 'remaining'], 'Coverage');
      if (!sha(args.coverage.requirementsDigest) || args.coverage.requirementsDigest !== task.requirements?.digest) throw new Error('Coverage must bind the current accepted requirements digest.');
      if (!Array.isArray(args.coverage.deliverables) || !args.coverage.deliverables.length || args.coverage.deliverables.length > 5 || !Array.isArray(args.coverage.remaining) || args.coverage.remaining.length > 20) throw new Error('Record one to five accepted deliverables and any remaining scope.');
      for (const delivery of args.coverage.deliverables) {
        fields(delivery, ['kind', 'url'], 'deliverable'); sourceUrl(delivery.url, task);
        if (!['pr', 'artifact'].includes(delivery.kind)) throw new Error('Use a PR or artifact deliverable.');
        if (delivery.kind === 'pr') githubPr(delivery.url);
      }
      if (new Set(args.coverage.deliverables.map(item => item.url)).size !== args.coverage.deliverables.length) throw new Error('Accepted deliverables must be unique.');
      args.coverage.remaining.forEach(value => requiredText(value, 'remaining scope', 2000));
    }
    const accepted = args.coverage || task.reconciliation?.coverage, primary = args.pullRequest?.url || task.prUrl;
    const acceptedPrs = (accepted?.deliverables || []).filter(item => item.kind === 'pr').map(item => item.url);
    if (new Set([...(primary ? [primary] : []), ...acceptedPrs]).size > maxReads) throw new Error('Accepted coverage plus the linked primary PR exceeds the five-PR check limit. Correct the linked PR or divide the work into separately tracked tasks before recording coverage.');
    if (args.completion) {
      const proof = args.completion;
      source(proof, task, at, ['artifactUrl', 'artifactDigest', 'scopeDigest', 'allScopeComplete', 'pendingReview', 'verification'], 'Completion');
      sourceUrl(proof.artifactUrl, task);
      if (!sha(proof.artifactDigest) || proof.scopeDigest !== task.requirements?.digest || !sha(proof.scopeDigest) || proof.allScopeComplete !== true || proof.pendingReview !== false) throw new Error('Completion requires a content digest, accepted scope and no pending review.');
      const verification = proof.verification;
      source(verification, task, at, ['artifactUrl', 'artifactDigest', 'scopeDigest', 'result', 'summary'], 'Verification');
      if (verification.result !== 'passed' || verification.artifactUrl !== proof.artifactUrl || verification.artifactDigest !== proof.artifactDigest || verification.scopeDigest !== proof.scopeDigest) throw new Error('Verification must bind the exact artifact URL, content and accepted scope.');
      const allowed = [proof.artifactUrl, `codex://threads/${task.threadId}`];
      if (!allowed.includes(proof.sourceUrl) || !allowed.includes(verification.sourceUrl)) throw new Error('Artifact proof must come from the artifact or exact owning worker source.');
      requiredText(verification.summary, 'verification result');
      if (Date.parse(proof.sourceEventAt) < checkpoint(task) || Date.parse(verification.sourceEventAt) < checkpoint(task)) throw new Error('An old answer cannot verify work after a newer task checkpoint.');
      const coverage = args.coverage || task.reconciliation?.coverage;
      if (!coverage?.deliverables.some(item => item.kind === 'artifact' && item.url === proof.artifactUrl) || coverage.requirementsDigest !== proof.scopeDigest || Date.parse(verification.sourceEventAt) < Date.parse(coverage.sourceEventAt)) throw new Error('The artifact must belong to the current accepted delivery scope.');
    }
    if (args.pullRequest) {
      source(args.pullRequest, task, at, ['url'], 'Pull request');
      if (githubPr(args.pullRequest.url) !== args.pullRequest.sourceUrl || task.prUrl && task.prUrl !== args.pullRequest.url) throw new Error('The explicit PR source must match the saved task PR.');
    }
    if (args.pauseResolution) {
      source(args.pauseResolution, task, at, ['kind', 'previousUpdatedAt', 'originalPauseEventId', 'reason'], 'Pause resolution');
      if (task.pause?.kind === 'user') throw new Error('An explicit user pause cannot be resolved by orchestration evidence.');
      if (args.pauseResolution.kind !== 'orchestration' || task.pause?.kind !== 'orchestration' || task.pause.cause !== 'merge_gate' || args.pauseResolution.originalPauseEventId !== task.pause.sourceEventId || args.pauseResolution.previousUpdatedAt !== task.updatedAt || Date.parse(args.pauseResolution.sourceEventAt) < Date.parse(task.pause.sourceEventAt)) throw new Error('The original merge-gate pause event and a later resolution of the exact checkpoint are required; legacy pauses remain preserved.');
      requiredText(args.pauseResolution.reason, 'pause resolution reason');
    }
  }

  async observe(args) {
    const task = this.store.get(args.taskId).task, at = this.clock();
    this.validate(args, task, at);
    const events = ['issue', 'worker', 'pullRequest', 'coverage', 'completion', 'pauseResolution'].filter(key => args[key]).map(key => [key, args[key].sourceEventId]);
    const receiptId = hash([task.id, args.coverage?.requirementsDigest || args.completion?.scopeDigest || task.requirements?.digest || null, events]);
    const payload = { ...args }; delete payload.expectedRevision;
    const payloadDigest = hash(semantic(payload)), prior = task.reconciliation?.receipts?.find(item => item.id === receiptId);
    if (prior) {
      if (prior.digest !== payloadDigest) throw new Error('A source event receipt cannot be reused with changed evidence.');
      if (task.stage === 'done' || events.every(([key]) => args[key].observedAt <= prior.observations?.[key]) && (!args.completion || args.completion.verification.observedAt <= prior.verificationObservedAt)) return { task, outcome: task.reconciliation.outcome, reason: task.reconciliation.reason };
    }
    if (!prior && task.revision !== args.expectedRevision) throw new Error('The task changed. Read it before recording evidence.');
    let lease, observation = { proofs: {}, errors: [] };
    if (args.pullRequest || (args.coverage || task.reconciliation?.coverage)?.deliverables.some(item => item.kind === 'pr')) {
      lease = await this.lease({ taskId: task.id, force: true });
      if (lease.status !== 'leased') throw new Error('Another status check is in progress. No evidence was changed.');
      observation = await this.inspectPrs({ ...task, ...(args.pullRequest ? { prUrl: args.pullRequest.url } : {}), reconciliation: { ...task.reconciliation, ...(args.coverage ? { coverage: args.coverage } : {}) } }, { remaining: maxReads, deadline: this.clock() + 60000 });
    }
    try {
      return await this.store.mutate(data => {
        const latest = this.store.task(data, task.id), checkedAt = this.clock();
        if (latest.revision !== task.revision) throw new Error('The task changed during observation. Its newer checkpoint was preserved.');
        if (lease && (data.reconciliation?.lease?.id !== lease.id || Date.parse(data.reconciliation.lease.expiresAt) <= checkedAt)) throw new Error('The status-check lease expired. No evidence was applied.');
        this.validate(args, latest, checkedAt);
        const saved = latest.reconciliation || {};
        for (const [key] of events) {
          const previous = key === 'completion' ? saved.artifacts?.[args[key].artifactUrl] : saved[key];
          if (previous?.sourceEventId === args[key].sourceEventId && hash(semantic(previous)) !== hash(semantic(args[key]))) throw new Error('An immutable source event cannot be reused with changed evidence.');
        }
        for (const key of ['issue', 'worker', 'coverage']) if (args[key] && (Date.parse(args[key].sourceEventAt) < Date.parse(saved[key]?.sourceEventAt) || Date.parse(args[key].observedAt) < Date.parse(saved[key]?.observedAt))) throw new Error(`A newer ${key} observation is already saved.`);
        latest.reconciliation = { ...saved, ...Object.fromEntries(['issue', 'worker', 'coverage', 'pauseResolution'].filter(key => args[key]).map(key => [key, args[key]])), ...(args.completion ? { artifacts: { ...saved.artifacts, [args.completion.artifactUrl]: args.completion } } : {}), pullRequests: { ...saved.pullRequests, ...Object.fromEntries(Object.entries(observation.proofs).map(([key, { raw, ...proof }]) => [key, proof])) } };
        bindPrimaryPr(latest, observation.proofs, checkedAt);
        const decision = observation.errors.length ? { outcome: 'unavailable', reason: observation.errors.join(' ') } : completionDecision(data, latest, checkedAt);
        saveDecision(latest, decision, checkedAt, events.map(([key]) => args[key].sourceUrl), Boolean(prior));
        const receipt = { id: receiptId, digest: payloadDigest, checkedAt: iso(checkedAt), observations: Object.fromEntries(events.map(([key]) => [key, args[key].observedAt])), ...(args.completion ? { verificationObservedAt: args.completion.verification.observedAt } : {}) };
        latest.reconciliation.receipts = [...(saved.receipts || []).filter(item => item.id !== receiptId), receipt].slice(-20);
        return { task: latest, outcome: decision.outcome, reason: decision.reason };
      });
    } finally { if (lease) await this.release(lease.id, 1); }
  }
}
