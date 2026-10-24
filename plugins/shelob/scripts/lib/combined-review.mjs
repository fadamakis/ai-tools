import { mergeAssessments } from './rules.mjs';

export const GENERAL_REVIEW_ID = 'CODEX-REVIEW';
const rule = { id: GENERAL_REVIEW_ID, title: 'General code review', category: 'Code review', severity: 'warning', mode: 'contextual', scope: ['**'],
  rationale: 'Codex reviews correctness, regressions, security, and contracts beyond the selected rules.', instructions: 'Validate the native Codex findings and inspect missing supporting context. Only supported material issues block approval.' };

export function combineReview(results, { required, receipt, assessment, snapshotId, repository, description }) {
  for (const result of results) for (const item of result.findings) item.sources = [item.origin === 'deterministic' ? 'Code scan' : `Rule: ${result.ruleId}`];
  if (!required) {
    if (assessment) throw new Error('Native review assessment requires a managed review run.');
    return results;
  }
  const files = repository.files.map(file => file.path);
  const general = { ruleId: rule.id, ...Object.fromEntries(['title', 'category', 'severity', 'mode', 'rationale', 'instructions'].map(key => [key, rule[key]])),
    mode: 'codex',
    matchedFiles: files, status: files.length ? 'not_assessed' : 'not_applicable', findings: [],
    reason: !files.length ? 'No tracked changes to review.' : receipt?.status === 'failed' ? receipt.error : receipt?.status === 'running' ? 'Native Codex review is running.' : receipt?.status === 'completed' ? 'Native review finished. Its findings and missing context still need validation in this conversation.' : 'Native Codex review has not run.',
    reviewMethod: 'Native Codex review, validated in the review conversation.' };
  if (assessment) {
    if (receipt?.status !== 'completed' || receipt.snapshotId !== snapshotId || assessment.outputDigest !== receipt.outputDigest) throw new Error('Native review is missing, unfinished, or bound to different source/output.');
    const partial = assessment.status === 'not_assessed' && assessment.findings?.length;
    mergeAssessments([general], { schemaVersion: '1.0.0', snapshotId, assessments: [{ ...assessment, status: partial ? 'findings' : assessment.status, ruleId: rule.id }] }, snapshotId, repository, { rules: [rule] }, description);
    if (partial) general.status = 'not_assessed';
    general.reviewMethod = 'Native Codex review, validated in the review conversation.';
    for (const item of general.findings) { item.origin = 'codex'; item.sources = ['Codex review']; }
  }
  results.unshift(general);
  // Explicit cause-based deduplication from the visible reviewer. Never collapse
  // unrelated findings merely because they share a line. Keep check references
  // and the strongest severity, but offer only one comment for publication.
  const byId = new Map(results.flatMap(result => result.findings).map(item => [item.id, item]));
  general.findings.forEach((item, index) => byId.set(`CODEX-REVIEW#${index + 1}`, item));
  for (const result of results) {
    result.findings = result.findings.filter(item => {
      if (!item.duplicateOf) return true;
      const target = byId.get(item.duplicateOf);
      if (!target || target === item || target.duplicateOf || !item.evidence.some(e => target.evidence.some(other => other.path === e.path))) throw new Error('A duplicate must reference an existing independent finding with shared source evidence.');
      if (['info', 'warning', 'error'].indexOf(item.severity) > ['info', 'warning', 'error'].indexOf(target.severity)) target.severity = item.severity;
      target.sources = [...new Set([...target.sources, ...item.sources])];
      result.findingRefs = [...new Set([...(result.findingRefs || []), target.id])];
      return false;
    });
  }
  return results;
}
