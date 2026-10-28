import { test, expect } from '@playwright/test';

for (const [theme, width] of [['light', 1440], ['dark', 390]]) {
  test(`delivery details separate required CI, remote evidence and recovery (${theme})`, async ({ page }) => {
    const calls = []; let linked = true;
    await page.route('**/rpc', async route => {
      const input = route.request().postDataJSON(); calls.push(input.name);
      if (['workbench.remote_refresh', 'workbench.remote_unbind', 'workbench.publication_reconcile'].includes(input.name)) {
        if (input.name === 'workbench.remote_unbind') linked = false;
        return route.fulfill({ json: { structuredContent: {}, content: [] } });
      }
      const response = await route.fetch(), result = await response.json();
      if (input.name === 'workbench.get') {
        const task = result.structuredContent.task;
        task.pr = { state: 'OPEN', head: 'a'.repeat(40), checks: 'passed', checkCount: 1, checkedAt: new Date().toISOString(), requiredCi: { status: 'pending', reason: 'Required integration has not reported.' }, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE' };
        task.publications = [{ id: '12345678-1234-4123-8123-123456789abc', state: 'uncertain', branch: 'task-branch', actions: ['commit', 'push', 'pr'], completed: ['commit'], updatedAt: new Date().toISOString(), error: 'Push receipt is unconfirmed.' }];
        if (linked) task.remoteRun = { binding: { url: 'https://github.com/example/repository/actions/runs/100' }, checkedAt: new Date().toISOString(), error: 'Remote access is unavailable. Last observation retained.', observation: { status: 'completed', conclusion: 'success', checkpointStatus: 'stale', stage: 'review_ready', implementationHead: 'a'.repeat(40), reason: 'The PR head moved.', checkedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() } };
      }
      return route.fulfill({ json: result });
    });
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`http://127.0.0.1:4372/?theme=${theme}`);
    const app = page.frameLocator('iframe');
    if (width < 1404) await app.getByRole('navigation', { name: 'Jump to delivery stage' }).getByRole('button', { name: /^PR/ }).click();
    await app.getByRole('button', { name: 'Open Fix keyboard navigation in the editor' }).click();
    const detail = app.getByRole('dialog', { name: 'Task details', exact: true });
    await expect(detail.getByText('Observed CI', { exact: true })).toBeVisible();
    await expect(detail.getByText('Required CI', { exact: true })).toBeVisible();
    await expect(detail.getByText(/Required integration has not reported/)).toBeVisible();
    await expect(detail.getByText('Human review', { exact: true })).toBeVisible();
    await expect(detail.getByText(/Remote access is unavailable/)).toBeVisible();
    await expect(detail.getByText(/saved observation is over a day old/)).toBeVisible();
    await detail.getByRole('button', { name: 'Check remote run now' }).click();
    await expect.poll(() => calls.filter(name => name === 'workbench.remote_refresh').length).toBe(1);
    await detail.getByRole('button', { name: 'Reconcile publication' }).click();
    await expect.poll(() => calls.filter(name => name === 'workbench.publication_reconcile').length).toBe(1);
    expect(calls).not.toContain('workbench.publication_execute');
    const bounds = await detail.evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth })); expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
    await page.screenshot({ path: `dist/workbench-preview-verification/delivery-${theme}.png`, fullPage: true });
    await detail.getByRole('button', { name: 'Unlink run' }).click();
    await expect(detail.getByText('Link an existing run')).toBeVisible();
  });
}
