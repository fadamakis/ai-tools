export const stateLabels = { preparing: 'Reading changes', awaiting_review: 'Review in progress', complete: 'Review saved', failed: 'Review could not start', interrupted: 'Review interrupted' };
export function groupReviews(reviews) {
  const groups = new Map();
  for (const run of [...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const key = run.source?.url?.replace(/\/$/, '').toLowerCase() || run.reviewKey || run.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  return [...groups.values()];
}

export function recoveryMessage(run) {
  if (run.state === 'interrupted') return 'Preparation stopped before a source snapshot was saved. Start a fresh review.';
  if (/fetch failed: timed out/.test(run.error || '')) return 'The repository took too long to download. Review the PR diff without a local copy, or retry the download.';
  if (/auth|access|executable not found/.test(run.error || '')) return 'Shelob could not read this PR. Check GitHub CLI access with gh auth status, then retry.';
  if (/budget|limit|incomplete.*diff/.test(run.error || '')) return 'Shelob could not collect the complete change. Try a local copy or a smaller change. No partial review was approved.';
  return 'Shelob could not prepare this review. Retry with a fresh source snapshot.';
}
