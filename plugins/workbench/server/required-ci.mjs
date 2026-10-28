const success = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const failed = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);
const outcome = check => String(check.conclusion || check.state || check.status || '').toUpperCase();
const appId = value => value == null || value === -1 ? null : value;
const eligibleEvents = new Set(['push', 'pull_request', 'pull_request_review', 'pull_request_target', 'deployment', 'deployment_status']);
export function latestChecks(checks) {
  const latest = new Map();
  for (const check of checks) {
    const key = `${check.name}:${check.kind}:${check.appId ?? check.creatorId ?? 'unknown'}`;
    if (!latest.has(key) || check.id > latest.get(key).id) latest.set(key, check);
  }
  return [...latest.values()];
}

export function observedChecks(checks) {
  const outcomes = checks.map(outcome);
  return outcomes.some(value => failed.has(value)) ? 'failed' : outcomes.some(value => !success.has(value)) ? 'pending' : outcomes.length ? 'passed' : 'unverified';
}

export function evaluateRequired(requirements, checks, { complete = true, reason, unsupported = false } = {}) {
  if (!complete || unsupported) return { version: 1, status: 'unknown', reason: reason || 'Required-check policy could not be fully resolved.' };
  if (!requirements.length) return { version: 1, status: 'none', reason: 'No required status checks are configured.' };
  const results = requirements.map(required => {
    const named = checks.filter(check => check.name === required.context);
    const matching = named.filter(check => required.appId == null || check.appId === required.appId || check.appId == null);
    if (matching.some(check => check.eligibility === 'unknown' || required.appId != null && check.appId == null)) return { ...required, status: 'unknown', reason: 'The check producer or workflow event could not be verified.' };
    const candidates = matching.filter(check => check.eligibility !== false);
    if (!candidates.length) return { ...required, status: 'pending', reason: 'The required check or producer has not reported.' };
    const latest = new Map();
    for (const check of candidates) {
      const key = `${check.kind}:${check.appId ?? check.creatorId ?? 'unknown'}`;
      const previous = latest.get(key);
      if (!previous || check.id > previous.id) latest.set(key, check);
    }
    for (const kind of new Set(candidates.map(check => check.kind))) {
      if ([...latest.values()].filter(check => check.kind === kind).length > 1) return { ...required, status: 'unknown', reason: 'Multiple producers report this required name.' };
    }
    const status = observedChecks([...latest.values()]);
    return { ...required, status: status === 'passed' ? 'satisfied' : status };
  });
  return { version: 1, status: results.some(item => item.status === 'unknown') ? 'unknown' : results.some(item => item.status === 'failed') ? 'failed' : results.some(item => item.status !== 'satisfied') ? 'pending' : 'satisfied', checks: results };
}

export async function collectRequiredCi(pr, read) {
  const repository = new URL(pr.url).pathname.split('/').slice(1, 3).join('/');
  const prefix = `repos/${repository}`, branch = encodeURIComponent(pr.baseRefName);
  const requirements = [], checks = [];
  let complete = true, unsupported = false, strict = false, behind = false, reason;
  try {
    const rules = (await read(`${prefix}/rules/branches/${branch}?per_page=100`, { pages: true })).flat();
    if (!Array.isArray(rules) || rules.some(rule => !rule.type)) throw new Error('Incomplete branch rules.');
    for (const rule of rules) {
      if (rule.type === 'required_status_checks') {
        strict ||= rule.parameters?.strict_required_status_checks_policy === true;
        if (!Array.isArray(rule.parameters?.required_status_checks)) throw new Error('Incomplete required checks.');
        for (const check of rule.parameters.required_status_checks) requirements.push({ context: check.context, appId: appId(check.integration_id) });
      }
      if (['workflows', 'required_workflows'].includes(rule.type)) unsupported = true;
    }
    const branchState = await read(`${prefix}/branches/${branch}`);
    try {
      const protection = await read(`${prefix}/branches/${branch}/protection/required_status_checks`);
      strict ||= protection.strict === true;
      if (!Array.isArray(protection.checks) && !Array.isArray(protection.contexts)) throw new Error('Incomplete branch protection.');
      for (const check of protection.checks || protection.contexts.map(context => ({ context }))) requirements.push({ context: check.context, appId: appId(check.app_id) });
    } catch (error) {
      if (!(branchState.protected === false && /404/.test(String(error.stderr || error.message)))) {
        const [owner, name] = repository.split('/');
        const response = await read('graphql', { query: `query { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { ref(qualifiedName:${JSON.stringify(`refs/heads/${pr.baseRefName}`)}) { branchProtectionRule { requiresStatusChecks requiresStrictStatusChecks requiredStatusChecks { context app { databaseId } } } } } }` });
        const ref = response.data?.repository?.ref;
        if (response.errors || !ref || !Object.hasOwn(ref, 'branchProtectionRule')) throw new Error('Classic branch protection could not be resolved.');
        const rule = ref.branchProtectionRule;
        strict ||= rule?.requiresStrictStatusChecks === true;
        if (rule?.requiresStatusChecks === true) {
          if (!Array.isArray(rule.requiredStatusChecks)) throw new Error('Required protection contexts are incomplete.');
          for (const check of rule.requiredStatusChecks) requirements.push({ context: check.context, appId: appId(check.app?.databaseId) });
        } else if (rule !== null && rule?.requiresStatusChecks !== false) throw new Error('Unknown classic branch protection.');
      }
    }
    if (requirements.some(item => typeof item.context !== 'string' || !item.context || item.appId != null && (!Number.isSafeInteger(item.appId) || item.appId < 1))) throw new Error('Unsupported required-check identity.');
    if (strict && requirements.length) {
      if (!/^[a-f0-9]{40,64}$/.test(pr.baseRefOid || '')) throw new Error('The exact required base is unavailable.');
      const comparison = await read(`${prefix}/compare/${pr.baseRefOid}...${pr.headRefOid}`);
      if (!Number.isSafeInteger(comparison.behind_by) || comparison.behind_by < 0) throw new Error('The required base ancestry could not be resolved.');
      behind = comparison.behind_by > 0;
    }
  } catch { complete = false; reason = 'Required-check policy is unavailable or incomplete.'; }
  const suites = new Map();
  async function eligibility(check) {
    if (!Number.isSafeInteger(check.app?.id) || check.app.id < 1) return 'unknown';
    if (check.app.slug !== 'github-actions') return true;
    const suite = check.check_suite?.id;
    if (!Number.isSafeInteger(suite) || suite < 1) return 'unknown';
    if (!suites.has(suite)) suites.set(suite, (async () => {
      try {
        const pages = await read(`${prefix}/actions/runs?check_suite_id=${suite}&per_page=100`, { pages: true });
        if (!Array.isArray(pages) || !pages.length || !pages.every(page => Array.isArray(page.workflow_runs) && Number.isSafeInteger(page.total_count))) return 'unknown';
        const runs = [...new Map(pages.flatMap(page => page.workflow_runs).map(run => [run.id, run])).values()];
        if (pages.some(page => page.total_count !== runs.length) || runs.length !== 1) return 'unknown';
        const run = runs[0];
        if (run.check_suite_id !== suite || run.repository?.full_name !== repository || typeof run.event !== 'string') return 'unknown';
        return eligibleEvents.has(run.event);
      } catch { return 'unknown'; }
    })());
    return suites.get(suite);
  }
  async function collect(sha) {
    const [runs, statuses] = await Promise.all([
      read(`${prefix}/commits/${sha}/check-runs?per_page=100&filter=all`, { pages: true }),
      read(`${prefix}/commits/${sha}/statuses?per_page=100`, { pages: true }),
    ]);
    if (!runs.every(page => Array.isArray(page.check_runs)) || !statuses.every(Array.isArray)) throw new Error('Incomplete check pages.');
    return [
      ...await Promise.all(runs.flatMap(page => page.check_runs).map(async check => ({ ...check, name: check.name, kind: 'check', appId: check.app?.id, eligibility: await eligibility(check) }))),
      ...statuses.flat().map(check => ({ ...check, name: check.context, kind: 'status', creatorId: check.creator?.id, eligibility: Number.isSafeInteger(check.creator?.id) && check.creator.id > 0 ? true : 'unknown' })),
    ];
  }
  try {
    const mergeSha = pr.potentialMergeCommit?.oid;
    const mergeChecks = mergeSha ? await collect(mergeSha) : [];
    checks.push(...(mergeChecks.length ? mergeChecks : await collect(pr.headRefOid)));
  } catch { complete = false; reason = 'Check results are unavailable or pagination did not complete.'; }
  const unique = [...new Map(requirements.map(item => [`${item.context}:${item.appId}`, item])).values()];
  const required = evaluateRequired(unique, checks, { complete, reason, unsupported });
  if (behind && required.status === 'satisfied') { required.status = 'pending'; required.reason = 'Required checks must include the current base; the task branch is behind it.'; }
  return { observed: observedChecks(latestChecks(checks)), count: checks.length, required };
}
