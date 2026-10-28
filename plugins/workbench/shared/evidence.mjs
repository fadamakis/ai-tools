export const evidenceKinds = ['verify', 'review'];

export function evidenceChecks(task) {
  if (task.evidenceChecks) return task.evidenceChecks;
  const legacy = task.evidence;
  return Object.fromEntries(evidenceKinds.filter(kind => legacy?.[kind] !== undefined).map(kind => [kind, {
    result: legacy[kind], checkedAt: legacy.checkedAt, ...(legacy.head ? { head: legacy.head } : {})
  }]));
}

export function normalizeTaskEvidence(task) {
  return task.evidence || task.evidenceChecks ? { ...task, evidenceChecks: evidenceChecks(task) } : task;
}

export function updateEvidence(task, evidence) {
  const checks = { ...evidenceChecks(task) };
  for (const kind of evidenceKinds) if (evidence[kind] !== undefined) checks[kind] = {
    result: evidence[kind], checkedAt: evidence.checkedAt, ...(evidence.head ? { head: evidence.head } : {}), ...(evidence.snapshot ? { snapshot: evidence.snapshot } : {})
  };
  task.evidenceChecks = checks;
  const records = Object.values(checks);
  const sameHead = records.length && records.every(check => check.head && check.head === records[0].head);
  task.evidence = {
    ...Object.fromEntries(Object.entries(checks).map(([kind, check]) => [kind, check.result])),
    ...(records.length ? { checkedAt: records.map(check => check.checkedAt).filter(Boolean).sort().at(-1) } : {}),
    ...(sameHead ? { head: records[0].head } : {})
  };
}

export function evidenceFreshness(task, kind) {
  const check = evidenceChecks(task)[kind];
  if (!check?.snapshot) return { status: 'unbound', reason: 'No content fingerprint was recorded.' };
  if (task.workspace?.status !== 'available') return { status: 'unavailable', reason: task.workspace?.reason || 'Recheck the assigned checkout.' };
  const current = task.workspace.snapshot, saved = check.snapshot;
  if (saved.version !== 1 || current?.version !== 1) return { status: 'unavailable', reason: 'Unsupported evidence version.' };
  if (saved.requirementsDigest !== task.requirements?.digest || ['repositoryId', 'checkout', 'branch', 'head', 'base', 'tree', 'requirementsDigest'].some(key => saved[key] !== current[key]) || task.head !== current.head || task.pr?.base && task.pr.base !== current.base) return { status: 'stale', reason: 'Content, revision, base or requirements changed.' };
  return { status: 'current', reason: `Content matched at ${current.checkedAt}.` };
}
