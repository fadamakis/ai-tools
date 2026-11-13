import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => { expect((await request.post('/reset')).ok()).toBe(true); });

for (const [theme, width] of [['light', 1800], ['dark', 390]]) {
  test(`state-specific recovery survives stale checkpoints without launching another worker (${theme})`, async ({ page }) => {
    await page.route('**/rpc', async route => {
      const input = route.request().postDataJSON(), response = await route.fetch(), result = await response.json();
      if (input.name === 'workbench.list') {
        const board = result.structuredContent, task = board.tasks.find(task => task.key === 'WEB-118');
        task.pr = { ...task.pr, state: 'MERGED', checks: 'failed' };
        task.reconciliation = { outcome: 'conflict', reason: 'Current owning-worker activity is unknown.' };
        const continued = board.tasks.find(task => task.key === 'WEB-104');
        board.launches.push({ id: '22345678-1234-4123-8123-123456789abc', taskId: continued.id, state: 'failed', updatedAt: '2020-01-01T00:00:00Z', error: 'Historical failed handoff' });
      }
      await route.fulfill({ json: result });
    });
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`/?theme=${theme}`);
    const app = page.frameLocator('iframe');
    await expect(app.getByRole('heading', { name: 'Delivery board', exact: true })).toBeVisible();
    await expect(app.getByText('Historical failed handoff')).toHaveCount(0);
    if (width < 1404) await app.getByRole('navigation', { name: 'Jump to delivery stage' }).getByRole('button', { name: /^PR/ }).click();
    const card = app.locator('.task-card').filter({ has: app.getByRole('heading', { name: 'Fix keyboard navigation in the editor', exact: true }) });
    await expect(card).toContainText('Merged · confirm delivery');
    await expect(card).toContainText('PR merged. Confirm the remaining scope and delivery evidence.');
    await expect(card.getByRole('button', { name: /^Confirm delivery/ })).toBeVisible();
    const bounds = await card.evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client); expect(bounds.page).toBeLessThanOrEqual(bounds.viewport);
    await page.screenshot({ path: `dist/workbench-preview-verification/recovery-${theme}.png`, fullPage: true });
    await card.getByRole('button', { name: /^Confirm delivery/ }).click();
    await expect.poll(() => page.evaluate(() => window.__workbenchPreview.messages.length)).toBe(1);
    const [draft] = await page.evaluate(() => window.__workbenchPreview.messages);
    expect(draft._meta['openai/message']).toEqual({ target: 'active', send: false });
    expect(draft.content[0].text).toContain('Recover and resume task "WEB-118"');
    expect(draft.content[0].text).toContain('Recheck blockers');
    expect(draft.content[0].text).toContain('Autopilot is off');
    expect(await page.evaluate(() => window.__workbenchPreview.submissions)).toEqual([]);
    await expect(card.getByRole('button', { name: /^Review request/ })).toBeVisible();
    await card.getByRole('button', { name: /^Review request/ }).click();
    await expect(app.getByRole('dialog', { name: 'Release chat request', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__workbenchPreview.messages.length)).toBe(1);
  });
}

test('blocked cards retain the full unblock action and prepare a bounded recheck', async ({ page }) => {
  await page.goto('/'); const app = page.frameLocator('iframe');
  const card = app.locator('.task-card').filter({ has: app.getByRole('heading', { name: 'Show a useful empty state', exact: true }) });
  await expect(card).toContainText('Make the test account available, then rerun verification.');
  expect(await card.locator('.card-next').evaluate(node => getComputedStyle(node).webkitLineClamp)).toBe('none');
  await card.getByRole('button', { name: /^Recheck blocker/ }).click();
  await expect.poll(() => page.evaluate(() => window.__workbenchPreview.messages.length)).toBe(1);
  expect((await page.evaluate(() => window.__workbenchPreview.messages))[0].content[0].text).toContain('do not assume they are fixed');
});
