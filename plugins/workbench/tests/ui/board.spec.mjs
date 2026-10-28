import { test, expect } from '@playwright/test';
import { contrastRatio } from '../../../../tests/ui/contrast.mjs';

async function open(page, query = '') {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:4372/${query}`);
  const app = page.frameLocator('iframe'); await expect(app.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible();
  return { app, errors };
}

async function revealFilters(app) {
  const toggle = app.getByRole('button', { name: /^Filters/ });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}

async function openHeaderAction(app, name) {
  const button = app.getByRole('button', { name, exact: true });
  if (await button.isVisible()) return button.click();
  await app.getByRole('button', { name: 'More options', exact: true }).click();
  await app.getByRole('menuitem', { name, exact: true }).click();
}

for (const [theme, width] of [['light', 1440], ['dark', 390]]) {
  test(`How it works preserves the board and opens its reference through the host (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { app, errors } = await open(page, `?theme=${theme}`);
    await revealFilters(app);
    await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-112');
    const cardsBefore = await app.locator('.task-card').allTextContents();
    await openHeaderAction(app, 'How it works');
    const help = app.getByRole('dialog', { name: 'How it works', exact: true });
    await expect(help).toBeVisible();
    await expect(help.getByRole('heading', { name: 'Choose how much to delegate' })).toBeVisible();
    const guide = help.getByRole('link', { name: 'Read the Workbench guide' });
    const url = 'https://github.com/fadamakis/ai-tools/tree/main/plugins/workbench';
    await expect(guide).toHaveAttribute('href', url); await guide.click();
    await expect.poll(() => page.evaluate(() => window.__workbenchPreview.openedLinks)).toEqual([url]);
    expect(await page.evaluate(() => window.__workbenchPreview.messages)).toEqual([]);
    const dimensions = await help.evaluate(dialog => ({ width: dialog.getBoundingClientRect().width, viewport: innerWidth, scroll: dialog.scrollWidth, client: dialog.clientWidth }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport); expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
    await help.getByRole('button', { name: 'Close how it works' }).press('Escape');
    await expect(help).toHaveCount(0);
    await expect(app.getByRole('button', { name: width <= 760 ? 'More options' : 'How it works', exact: true })).toBeFocused();
    await expect(app.getByRole('textbox', { name: 'Search tasks' })).toHaveValue('WEB-112');
    expect(await app.locator('.task-card').allTextContents()).toEqual(cardsBefore);
    expect(errors).toEqual([]);
  });
}

test('desktop columns stay equal and stationary when a task empties a stage or search filters its contents', async ({ page }) => {
  const { app } = await open(page);
  const board = (await (await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.list', arguments: {} } })).json()).structuredContent;
  const original = board.tasks.find(task => task.key === 'WEB-104');
  const geometry = () => app.locator('.column').evaluateAll(columns => columns.map(column => {
    const { x, y, width } = column.getBoundingClientRect();
    return { stage: column.dataset.stage, x, y, width };
  }));
  const before = await geometry();
  expect(before).toHaveLength(7);
  expect(Math.max(...before.map(column => column.width)) - Math.min(...before.map(column => column.width))).toBeLessThan(1);
  let current;
  try {
    const moved = await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.progress', arguments: { taskId: original.id, expectedRevision: original.revision, stage: 'implement', status: original.status, summary: original.summary, nextAction: original.nextAction, threadId: original.threadId } } });
    const result = await moved.json(); expect(result.isError).not.toBe(true); current = result.structuredContent.task;
    await expect(app.locator('.column[data-stage=plan] .task-card')).toHaveCount(0, { timeout: 6000 });
    await expect(app.locator('.column[data-stage=build] .task-card')).toHaveCount(2);
    expect(await geometry()).toEqual(before);
    await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-104');
    await expect(app.locator('.task-card')).toHaveCount(1);
    expect(await geometry()).toEqual(before);
  } finally {
    if (current) await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.progress', arguments: { taskId: original.id, expectedRevision: current.revision, stage: original.workbenchStage, status: original.status, summary: original.summary, nextAction: original.nextAction, threadId: original.threadId } } });
  }
});

test('board fits all stages on desktop and uses stage selection before horizontal overflow at smaller widths', async ({ page }) => {
  const { app, errors } = await open(page);
  const visibleColumns = app.locator('.column:visible');
  const stageNavigation = app.getByRole('navigation', { name: 'Jump to delivery stage' });
  const assertNoOverflow = async () => {
    const bounds = await app.locator('.board-scroll').evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
    expect(bounds.page).toBeLessThanOrEqual(bounds.viewport);
  };
  for (const width of [2861, 1800, 1440, 1404, 1403, 1280, 980, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width >= 1404) {
      await expect(visibleColumns).toHaveCount(7);
      await expect(stageNavigation).not.toBeVisible();
      const columns = await visibleColumns.evaluateAll(nodes => nodes.map(node => {
        const { left, right, width } = node.getBoundingClientRect();
        return { left, right, width };
      }));
      expect(Math.min(...columns.map(column => column.left))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...columns.map(column => column.right))).toBeLessThanOrEqual(width);
      expect(Math.max(...columns.map(column => column.width)) - Math.min(...columns.map(column => column.width))).toBeLessThan(1);
    } else {
      await expect(visibleColumns).toHaveCount(1);
      await expect(stageNavigation.getByRole('button')).toHaveCount(7);
      await stageNavigation.getByRole('button', { name: /^Done/ }).click();
      await expect(app.locator('.column[data-stage=done]')).toBeVisible();
    }
    await expect(app.getByRole('button', { name: /Archive \d+ done tasks?/ })).toBeInViewport({ ratio: 1 });
    await assertNoOverflow();
    if ([2861, 390].includes(width)) await page.screenshot({ path: `dist/workbench-preview-verification/no-horizontal-scroll/board-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await app.locator('html').evaluate(root => { root.style.fontSize = '200%'; });
  await expect(visibleColumns).toHaveCount(1);
  await expect(stageNavigation).toBeVisible();
  await assertNoOverflow();
  expect(errors).toEqual([]);
});

test('board renders all stages, filters tasks and reads the original note without external requests', async ({ page }) => {
  const { app, errors } = await open(page);
  await expect(app.locator('.column')).toHaveCount(7);
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-112');
  await expect(app.locator('.task-card')).toHaveCount(1); await app.locator('.task-card').click();
  const detail = app.getByRole('dialog', { name: 'Task details' });
  await expect(detail.getByRole('heading', { name: 'Show a useful empty state', level: 3 })).toBeVisible();
  await expect(detail).toContainText('Make the test account available');
  await app.getByRole('button', { name: 'Close task details' }).click();
  expect(errors).toEqual([]);
});

test('Autopilot is off each time and native environment plus explicit consent travel with one launch', async ({ page }) => {
  const { app, errors } = await open(page);
  await app.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(app.getByRole('checkbox', { name: 'Autopilot', exact: true })).not.toBeChecked();
  await app.getByLabel('Ticket or desired outcome').fill(`UI-${Date.now()} Test action`);
  await app.getByRole('radio', { name: 'Worktree', exact: true }).click();
  await app.getByRole('checkbox', { name: 'Autopilot', exact: true }).check();
  await app.getByRole('button', { name: 'Start new chat with Autopilot', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Start a task' })).toHaveCount(0);
  const messages = await page.evaluate(() => window.__workbenchPreview.messages);
  expect(messages).toHaveLength(1); expect(messages[0].content[0].text).toContain('native Codex worktree chat'); expect(messages[0].content[0].text).toContain('Autopilot is on: commits');
  await app.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(app.getByRole('checkbox', { name: 'Autopilot', exact: true })).not.toBeChecked();
  await expect(app.getByRole('radio', { name: 'Local', exact: true })).toBeChecked(); expect(errors).toEqual([]);
});

test('resume preserves the original chat and hides new-environment controls until continuation is chosen', async ({ page }) => {
  const { app } = await open(page);
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-104'); await app.locator('.task-card').click();
  await app.getByRole('button', { name: 'Resume original chat', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Resume original chat', exact: true })).toBeVisible();
  await expect(app.getByRole('radiogroup', { name: 'Native Codex environment' })).toHaveCount(0);
  await app.getByRole('checkbox', { name: 'Use a new chat instead' }).check();
  await expect(app.getByRole('radiogroup', { name: 'Native Codex environment' })).toBeVisible();
  await expect(app.getByRole('button', { name: 'Start new chat', exact: true })).toBeVisible();
});

test('save errors preserve the repository draft, and Enter works without sandbox allow-forms', async ({ page }) => {
  const { app } = await open(page);
  await page.evaluate(() => { window.__workbenchPreview.errors['workbench.repository_add'] = 'Cannot access this repository.'; });
  await app.getByRole('button', { name: 'Add repository', exact: true }).click();
  await app.getByText('Enter a path manually', { exact: true }).click();
  await app.getByLabel('Repository path').fill('/missing/repository'); await app.getByLabel('Repository path').press('Enter');
  await expect(app.getByRole('alert')).toContainText('Cannot access'); await expect(app.getByLabel('Repository path')).toHaveValue('/missing/repository');
  await page.evaluate(() => { delete window.__workbenchPreview.errors['workbench.repository_add']; });
  const fixture = await page.evaluate(() => window.__workbenchPreview.fixturePath);
  await app.getByLabel('Repository path').fill(fixture); await app.getByLabel('Repository path').press('Enter');
  await expect(app.getByRole('dialog', { name: 'Add repository' })).toHaveCount(0);
});

test('unsupported message capability disables launch and explains the fallback', async ({ page }) => {
  const { app } = await open(page, '?noMessages');
  await app.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Start new chat', exact: true })).toBeDisabled();
  await expect(app.getByRole('dialog')).toContainText('does not support launching chats');
  expect(await page.evaluate(() => window.__workbenchPreview.messages.length)).toBe(0);
});

test('dark and narrow layouts keep controls reachable, trap focus and restore the opener', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { app, errors } = await open(page, '?theme=dark');
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  await app.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(app.getByRole('dialog')).toBeVisible();
  await app.getByLabel('Ticket or desired outcome').fill('NARROW-123 Preserve layout');
  await app.getByLabel('Ticket or desired outcome').press('Escape');
  await expect(app.getByRole('dialog')).toHaveCount(0); await expect(app.getByRole('button', { name: 'New task', exact: true })).toBeFocused();
  const dimensions = await app.locator('body').evaluate(body => ({ width: body.clientWidth, viewport: innerWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport); expect(errors).toEqual([]);
});

test('visible board picks up a real saved checkpoint on the next local refresh', async ({ page }) => {
  const { app } = await open(page);
  const response = await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.list', arguments: {} } });
  const board = (await response.json()).structuredContent, task = board.tasks.find(task => task.key === 'WEB-104');
  await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.progress', arguments: { taskId: task.id, expectedRevision: task.revision, stage: 'implement', status: 'paused', summary: 'Updated from a worker checkpoint.', nextAction: 'Verify.', threadId: task.threadId } } });
  const card = app.locator('.column[data-stage=build] .task-card').filter({ hasText: 'WEB-104' });
  await expect(card).toContainText('Verify.', { timeout: 6000 });
  await card.click(); await expect(app.getByRole('dialog', { name: 'Task details' })).toContainText('Updated from a worker checkpoint.');
});

test('task details label passed evidence from an earlier revision after a new checkpoint', async ({ page }) => {
  const { app } = await open(page);
  const response = await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.list', arguments: {} } });
  let task = (await response.json()).structuredContent.tasks.find(task => task.key === 'WEB-115');
  for (const [head, evidence] of [['a'.repeat(40), { verify: 'passed', review: 'passed', checkedAt: new Date().toISOString(), head: 'a'.repeat(40) }], ['b'.repeat(40), undefined]]) {
    const saved = await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.progress', arguments: { taskId: task.id, expectedRevision: task.revision, stage: 'review', status: 'paused', summary: 'Revision changed after verification.', nextAction: 'Recheck the change.', threadId: task.threadId, head, ...(evidence ? { evidence } : {}) } } });
    task = (await saved.json()).structuredContent.task;
  }
  await app.getByRole('button', { name: 'Refresh board', exact: true }).click();
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-115');
  await app.locator('.task-card').click();
  const details = app.getByRole('dialog', { name: 'Task details' });
  await expect(details.locator('dt').filter({ hasText: /^Verification$/ }).locator('+ dd')).toHaveText('passed · unbound · earlier revision');
  await expect(details.locator('dt').filter({ hasText: /^Code review$/ }).locator('+ dd')).toHaveText('passed · unbound · earlier revision');
  await expect(details.getByRole('button', { name: 'Resume original chat', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'repair-evidence/evidence-revision-after.png', fullPage: true });
});

test('board Start and Resume complete a bounded simulated handoff and preserve the same worker checkout', async ({ page }) => {
  const { app, errors } = await open(page, '?handoff=success');
  const key = `BRIDGE-${Date.now()}`;
  await app.getByRole('button', { name: 'New task', exact: true }).click();
  await app.getByLabel('Ticket or desired outcome').fill(`${key} Simulated handoff only`);
  await app.getByRole('radio', { name: 'Worktree', exact: true }).click();
  await app.getByRole('button', { name: 'Start new chat', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Start a task' })).toHaveCount(0);
  await app.getByRole('textbox', { name: 'Search tasks' }).fill(key);
  await expect(app.locator('.column[data-stage=plan] .task-card')).toContainText(key);
  const list = async () => (await (await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.list', arguments: {} } })).json()).structuredContent;
  const before = await list(), task = before.tasks.find(task => task.key === key);
  expect(task.checkout).toContain('simulated-worktree-');
  expect(before.launches.filter(launch => launch.taskId === task.id)).toHaveLength(0);
  await app.locator('.task-card').click();
  await expect(app.getByRole('dialog', { name: 'Task details' })).toContainText('Simulated worker checkpoint');
  await app.getByRole('button', { name: 'Resume original chat', exact: true }).click();
  await app.getByRole('button', { name: 'Resume original chat', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Resume task' })).toHaveCount(0);
  const after = await list(), resumed = after.tasks.find(candidate => candidate.id === task.id);
  expect(resumed.threadId).toBe(task.threadId); expect(resumed.checkout).toBe(task.checkout); expect(resumed.revision).toBeGreaterThan(task.revision);
  expect(await page.evaluate(() => window.__workbenchPreview.messages.length)).toBe(2);
  expect(errors).toEqual([]);
});

test('rejected optional host context keeps the board polling and task details usable', async ({ page }) => {
  const { app, errors } = await open(page, '?contextFailure');
  await expect.poll(() => page.evaluate(() => window.__workbenchPreview.requests.filter(request => request.method === 'ui/update-model-context').length)).toBeGreaterThan(0);
  const count = await page.evaluate(() => window.__workbenchPreview.requests.filter(request => request.params?.name === 'workbench.list').length);
  await expect.poll(() => page.evaluate(() => window.__workbenchPreview.requests.filter(request => request.params?.name === 'workbench.list').length), { timeout: 6000 }).toBeGreaterThan(count);
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-112');
  await app.locator('.task-card').click();
  await expect(app.getByRole('dialog', { name: 'Task details' })).toContainText('Make the test account available');
  await expect(app.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('compact board makes attention actionable and provides one recoverable no-results state', async ({ page }) => {
  const { app } = await open(page);
  const bounds = await app.locator('.task-card').first().boundingBox(); expect(bounds.y).toBeLessThan(340);
  await expect(app.getByText('Keep work moving.', { exact: true })).toHaveCount(0);
  await app.getByRole('button', { name: /Needs attention/ }).click();
  await expect(app.locator('.task-card')).toHaveCount(1);
  await expect(app.locator('.task-card')).toContainText('Make the test account available');
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('no-such-task');
  await expect(app.getByRole('heading', { name: 'No matching tasks' })).toBeVisible();
  await expect(app.getByText('No tasks here', { exact: true })).toHaveCount(0);
  await app.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(app.locator('.task-card').filter({ hasText: 'WEB-108' })).toBeVisible();
});

test('folder errors retain the draft and hide command diagnostics behind details', async ({ page }) => {
  const { app } = await open(page);
  await app.getByRole('button', { name: 'Add repository', exact: true }).click();
  await expect(app.getByRole('dialog').getByRole('button', { name: 'Add repository', exact: true })).toHaveCount(0);
  await app.getByText('Enter a path manually', { exact: true }).click();
  await app.getByLabel('Repository path').fill('/tmp/workbench-preview-missing-folder-ui');
  await app.getByRole('dialog').getByRole('button', { name: 'Add repository', exact: true }).click();
  await expect(app.getByRole('alert').getByText('That folder is unavailable. Choose another folder.', { exact: true })).toBeVisible();
  await expect(app.getByLabel('Repository path')).toHaveValue('/tmp/workbench-preview-missing-folder-ui');
  await expect(app.getByRole('alert').locator('pre')).not.toBeVisible();
  await app.getByText('Technical details', { exact: true }).click();
  await expect(app.getByRole('alert').locator('pre')).toContainText('ENOENT');
});

test('a Done card shows merge completion separately from historical checks and can be archived, restored and undone', async ({ page }) => {
  const { app, errors } = await open(page);
  const card = app.locator('.task-card').filter({ hasText: 'WEB-101' });
  await expect(card).toContainText('Merged'); await expect(card).not.toContainText('pending');
  await card.click();
  const details = app.getByRole('dialog', { name: 'Task details' });
  await expect(details).toContainText('Historical observed CI'); await expect(details).toContainText('pending');
  await details.getByRole('button', { name: 'Archive task', exact: true }).click();
  await expect(app.locator('.task-card').filter({ hasText: 'WEB-101' })).toHaveCount(0);
  await expect(app.getByRole('status', { name: 'Board update' })).toContainText('1 task archived');
  await app.getByRole('radio', { name: /^Archive \d+$/ }).click();
  await app.locator('.task-card').filter({ hasText: 'WEB-101' }).click();
  await app.getByRole('button', { name: 'Restore to Done', exact: true }).click();
  await app.getByRole('radio', { name: 'Board', exact: true }).click();
  await expect(app.locator('.column[data-stage=done] .task-card').filter({ hasText: 'WEB-101' })).toBeVisible();
  await app.getByRole('button', { name: /Archive \d+ done tasks?/ }).click();
  await expect(app.locator('.column[data-stage=done] .task-card')).toHaveCount(0);
  await app.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(app.locator('.column[data-stage=done] .task-card').filter({ hasText: 'WEB-101' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('first-run folder choice opens the picker before the import confirmation', async ({ page }) => {
  const { app } = await open(page);
  await page.evaluate(() => window.__workbenchPreview.notify('ui/notifications/tool-result', { structuredContent: { entrypoint: 'global', repositories: [], tasks: [], launches: [], selected: null }, content: [] }));
  await app.getByRole('button', { name: 'Choose folder…', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Add repository' })).toBeVisible();
  const fixturePath = await page.evaluate(() => window.__workbenchPreview.fixturePath);
  await expect(app.locator('.selected-folder output')).toHaveText(fixturePath);
  expect(await page.evaluate(() => window.__workbenchPreview.requests.filter(request => request.params?.name === 'workbench.repository_add').length)).toBe(0);
  await app.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('capture desktop and dark board views', async ({ page }) => {
  const { app } = await open(page); await expect(app.locator('.task-card').first()).toBeVisible();
  await page.screenshot({ path: 'dist/workbench-preview-verification/board-light.png', fullPage: true });
  await open(page, '?theme=dark'); await page.screenshot({ path: 'dist/workbench-preview-verification/board-dark.png', fullPage: true });
});

test('folder picker selects a repository without importing until Add is clicked', async ({ page }) => {
  const { app } = await open(page);
  await app.getByRole('button', { name: 'Add repository', exact: true }).click();
  await expect(app.getByLabel('Repository path')).not.toBeVisible();
  await app.getByRole('button', { name: 'Choose folder…', exact: true }).click();
  const fixturePath = await page.evaluate(() => window.__workbenchPreview.fixturePath);
  await expect(app.locator('.selected-folder output')).toHaveText(fixturePath);
  let adds = await page.evaluate(() => window.__workbenchPreview.requests.filter(request => request.params?.name === 'workbench.repository_add'));
  expect(adds).toHaveLength(0);
  await app.getByRole('dialog', { name: 'Add repository' }).getByRole('button', { name: 'Add repository', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Add repository' })).toHaveCount(0);
  adds = await page.evaluate(() => window.__workbenchPreview.requests.filter(request => request.params?.name === 'workbench.repository_add'));
  expect(adds).toHaveLength(1); expect(adds[0].params.arguments.path).toBe(fixturePath);
});

test('cancelling folder selection keeps the current selection and never imports', async ({ page }) => {
  const { app } = await open(page);
  await app.getByRole('button', { name: 'Add repository', exact: true }).click();
  await app.getByText('Enter a path manually', { exact: true }).click();
  await app.getByLabel('Repository path').fill('/keep/my/selection');
  await page.evaluate(() => { window.__workbenchPreview.pickerCancelled = true; });
  await app.getByRole('button', { name: 'Choose another folder…', exact: true }).click();
  await expect(app.getByLabel('Repository path')).toHaveValue('/keep/my/selection');
  expect(await page.evaluate(() => window.__workbenchPreview.requests.filter(request => request.params?.name === 'workbench.repository_add').length)).toBe(0);
});

test('initial discovery offers existing notes for explicit one-click import', async ({ page }) => {
  const { app } = await open(page);
  await page.evaluate(() => window.__workbenchPreview.notify('ui/notifications/tool-result', { structuredContent: { entrypoint: 'global', repositories: [], tasks: [], launches: [], selected: null }, content: [] }));
  await expect(app.getByRole('button', { name: 'Import 1 task from project', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__workbenchPreview.requests.filter(request => request.params?.name === 'workbench.repository_add').length)).toBe(0);
  await app.getByRole('button', { name: 'Import 1 task from project', exact: true }).click();
  await expect(app.locator('.task-card').filter({ hasText: 'EX-123' })).toBeVisible();
  await expect(app.locator('.column[data-stage=done] .task-card').filter({ hasText: 'EX-123' })).toBeVisible();
  await expect(app.getByRole('status', { name: 'Board update' })).toContainText('1 existing task imported read-only');
  await expect(app.getByRole('status', { name: 'Board update' })).toContainText('1 linked PR checked against GitHub');
});

test('compact board keeps every stage reachable and Done archive inline beside the chat-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 900 });
  const { app, errors } = await open(page);
  const stages = app.getByRole('navigation', { name: 'Jump to delivery stage' });
  await expect(stages.getByRole('button')).toHaveCount(7);
  await stages.getByRole('button', { name: /^Done/ }).click();
  const column = app.locator('.column[data-stage=done]');
  await expect(column).toBeVisible();
  const archive = column.getByRole('button', { name: /Archive \d+ done tasks?/ });
  await expect(archive).toBeInViewport();
  const top = await column.locator('h2').boundingBox(), action = await archive.boundingBox();
  expect(Math.abs(top.y + top.height / 2 - action.y - action.height / 2)).toBeLessThan(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(stages.getByRole('button', { name: /^Done/ })).toBeInViewport();
  await expect(archive).toBeInViewport();
  await page.screenshot({ path: 'dist/workbench-preview-verification/sdk-implementation/compact-done.png' });
  const sizes = await app.locator('body').evaluate(body => ({ scroll: body.scrollWidth, viewport: innerWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.viewport); expect(errors).toEqual([]);
});

test('card Resume opens confirmation directly, keeps Autopilot off and confirms exactly one same-chat request', async ({ page }) => {
  const { app } = await open(page, '?handoff=success');
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-104');
  await app.getByRole('button', { name: 'Resume original chat · Clarify the first-run setup', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Task details' })).toHaveCount(0);
  await expect(app.getByRole('checkbox', { name: 'Autopilot', exact: true })).not.toBeChecked();
  await expect(app.getByRole('button', { name: 'Resume original chat', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__workbenchPreview.messages)).toHaveLength(0);
  await app.getByRole('button', { name: 'Resume original chat', exact: true }).click();
  await expect(app.getByRole('region', { name: 'Chat handoff' })).toContainText('Chat confirmed');
  const messages = await page.evaluate(() => window.__workbenchPreview.messages);
  expect(messages).toHaveLength(1);
  expect(messages[0].content[0].text).toContain('Resume task "WEB-104" in its original chat');
  expect(messages[0].content[0].text).toContain('Autopilot is off');
  expect(messages[0].content[0].text.match(/[a-f0-9-]{36}/g)).toHaveLength(1);
});

test('SDK repository selector stays inside the modal focus flow and Escape closes only its open menu', async ({ page }) => {
  const { app, errors } = await open(page);
  await app.getByRole('button', { name: 'New task', exact: true }).click();
  const dialog = app.getByRole('dialog', { name: 'Start a task' });
  const close = dialog.getByRole('button', { name: 'Close start a task', exact: true });
  const submit = dialog.getByRole('button', { name: 'Start new chat', exact: true });
  await close.press('Shift+Tab'); await expect(submit).toBeFocused();
  await submit.press('Tab'); await expect(close).toBeFocused();
  const repository = dialog.getByRole('button', { name: /^Repository:/ });
  await expect(repository.locator('input,select,textarea,button,[role="button"]')).toHaveCount(0);
  await repository.press('Space');
  const option = app.getByRole('option').first();
  await expect(option).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(option).not.toBeVisible();
  await expect(dialog).toBeVisible(); await expect(repository).toBeFocused();
  await repository.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'New task', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

for (const theme of ['light', 'dark']) {
  test(`active field hints and merged status have readable contrast (${theme})`, async ({ page }) => {
    const { app } = await open(page, `?theme=${theme}`);
    expect(await contrastRatio(app.getByRole('button', { name: /^Repository: All repositories/ }))).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(app.locator('[data-color="success"][data-variant="soft"]').filter({ hasText: 'Merged' }).first())).toBeGreaterThanOrEqual(4.5);
    for (const label of await app.locator('[data-color="warning"][data-variant="soft"],.needs-attention').all()) {
      expect(await contrastRatio(label)).toBeGreaterThanOrEqual(4.5);
    }
    await app.getByRole('button', { name: 'New task', exact: true }).click();
    expect(await contrastRatio(app.locator('#task-description'), '::placeholder')).toBeGreaterThanOrEqual(4.5);
  });
}

test('help keeps its close control visible after reading the last section and uses visible list markers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { app } = await open(page, '?theme=dark');
  await openHeaderAction(app, 'How it works');
  const help = app.getByRole('dialog', { name: 'How it works' });
  await help.locator('.help-source').scrollIntoViewIfNeeded();
  await expect(help.getByRole('button', { name: 'Close how it works' })).toBeInViewport();
  expect(await help.locator('ol').evaluate(list => getComputedStyle(list).listStyleType)).toBe('decimal');
  await page.screenshot({ path: 'dist/workbench-preview-verification/sdk-implementation/help-dark.png' });
  await help.getByRole('button', { name: 'Close how it works' }).click();
  await expect(app.getByRole('button', { name: 'More options', exact: true })).toBeFocused();
});

test('connection has its own loading state, retains saved work on refresh and shows progress for a slow PR check', async ({ page }) => {
  let releaseConnect;
  const connection = new Promise(resolve => { releaseConnect = resolve; });
  await page.route('**/rpc', async route => {
    if (route.request().postDataJSON().name === 'workbench.list') await connection;
    await route.continue();
  });
  const { app } = await open(page, '?deferBoard');
  await expect(app.getByText('Loading your saved work…', { exact: true })).toBeVisible();
  await expect(app.getByText('Bring your work here.', { exact: true })).toHaveCount(0);
  releaseConnect();
  await expect(app.locator('.task-card').first()).toBeVisible();
  let releaseRefresh;
  const refresh = new Promise(resolve => { releaseRefresh = resolve; });
  await page.route('**/rpc', async route => {
    if (route.request().postDataJSON().name === 'workbench.list') await refresh;
    await route.continue();
  });
  const cardsBefore = await app.locator('.task-card').allTextContents();
  await app.getByRole('button', { name: 'Refresh board', exact: true }).click();
  await expect(app.getByRole('status', { name: 'Operation progress' })).toContainText('Checking saved progress');
  expect(await app.locator('.task-card').allTextContents()).toEqual(cardsBefore);
  releaseRefresh();
  await expect(app.getByRole('button', { name: 'Refresh board', exact: true })).toBeEnabled();
  let releaseCheck;
  const check = new Promise(resolve => { releaseCheck = resolve; });
  await page.route('**/rpc', async route => {
    if (route.request().postDataJSON().name === 'workbench.pr_refresh') await check;
    await route.continue();
  });
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-101'); await app.locator('.card-main').click();
  await app.getByRole('button', { name: 'Check PR now', exact: true }).click();
  await expect(app.getByRole('dialog').getByRole('status')).toContainText('Checking pull request');
  await expect(app.getByRole('button', { name: 'Check PR now', exact: true })).toBeDisabled();
  releaseCheck();
  await expect(app.getByRole('button', { name: 'Check PR now', exact: true })).toBeEnabled();
});

test('long saved keys stay searchable and readable in details while enlarged text keeps narrow controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const { app } = await open(page, '?theme=dark');
  const board = (await (await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.list', arguments: {} } })).json()).structuredContent;
  const key = 'WB_PREVIEW_SMOKE_20261020_DESIGN';
  await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.task_register', arguments: { repositoryId: board.repositories[0].id, key, title: 'A useful human task title', threadId: '33345678-1234-4123-8123-123456789abc', checkout: board.repositories[0].path } } });
  await app.getByRole('button', { name: 'Refresh board', exact: true }).click();
  await revealFilters(app);
  await app.getByRole('textbox', { name: 'Search tasks' }).fill(key);
  await expect(app.locator('.task-card')).toHaveCount(1);
  await expect(app.locator('.task-card')).not.toContainText(key);
  await app.locator('html').evaluate(root => { root.style.fontSize = '200%'; });
  const size = await app.locator('body').evaluate(body => ({ scroll: body.scrollWidth, viewport: innerWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.viewport);
  await app.getByRole('button', { name: 'Open A useful human task title', exact: true }).click();
  await expect(app.getByRole('dialog')).toContainText(key);
  await expect(app.getByRole('button', { name: 'Close task details', exact: true })).toBeInViewport();
});

test('long discovered paths keep Import visible and the complete path keyboard accessible without horizontal modal scrolling', async ({ page }) => {
  const fullPath = `/Users/designer/${'a-long-workspace-folder/'.repeat(8)}same-named-repository`;
  await page.route('**/rpc', async route => {
    if (route.request().postDataJSON().name !== 'workbench.repository_discover') return route.continue();
    await route.fulfill({ json: { structuredContent: { pickerAvailable: true, repositories: [{ id: 'long-path', name: 'same-named-repository', path: fullPath, importableTaskCount: 3 }] }, content: [] } });
  });
  const { app, errors } = await open(page);
  await app.getByRole('button', { name: 'Add repository', exact: true }).click();
  const dialog = app.getByRole('dialog', { name: 'Add repository' });
  const button = dialog.getByRole('button', { name: 'Import 3 tasks from same-named-repository' });
  const pathToggle = dialog.getByLabel('Show full path for same-named-repository', { exact: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(button).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByText('same-named-repository', { exact: true })).toBeVisible();
    await pathToggle.press('Enter');
    await expect(dialog.locator('.repository-path-details code')).toHaveText(fullPath);
    const bounds = await dialog.locator('.dialog-body').evaluate(body => ({ scroll: body.scrollWidth, client: body.clientWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
    await expect(button).toBeInViewport({ ratio: 1 });
    await pathToggle.press('Enter');
  }
  expect(errors).toEqual([]);
});

test('an unstarted task keeps Start task across card details and confirmation without claiming a saved note', async ({ page }) => {
  const { app } = await open(page);
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-121');
  await expect(app.getByRole('button', { name: 'Start task · Add a clearer save confirmation', exact: true })).toBeVisible();
  await app.getByRole('button', { name: 'Open Add a clearer save confirmation', exact: true }).click();
  const details = app.getByRole('dialog', { name: 'Task details' });
  await expect(details.getByText('Paused', { exact: true })).toBeVisible();
  await expect(details).not.toContainText('Start Workbench');
  await expect(details).toContainText('No saved note yet.');
  await details.getByRole('button', { name: 'Start task', exact: true }).click();
  const launch = app.getByRole('dialog', { name: 'Start task', exact: true });
  await expect(launch.getByRole('button', { name: 'Start task', exact: true })).toBeVisible();
  await expect(launch).not.toContainText('continuation');
  await expect(launch).not.toContainText('saved note');
  await expect(launch.getByRole('checkbox', { name: 'Autopilot', exact: true })).not.toBeChecked();
  expect(await page.evaluate(() => window.__workbenchPreview.messages)).toHaveLength(0);
  await launch.getByRole('button', { name: 'Close start task' }).press('Escape');
});

test('the visible version opens update guidance that distinguishes refreshing tasks from loading an app update', async ({ page }) => {
  const { app } = await open(page);
  const version = app.getByRole('button', { name: /^About Workbench/ });
  const label = await version.innerText();
  await version.click();
  const help = app.getByRole('dialog', { name: 'How it works' });
  await expect(help).toContainText(`This panel is running ${label}`);
  await expect(help).toContainText('Refresh board checks saved task progress.');
  await expect(help).toContainText('quit and reopen Codex');
  await help.getByRole('button', { name: 'Close how it works' }).press('Escape');
  await expect(version).toBeFocused();
});

test('mobile header keeps work visible and collapsed filters retain their count and results', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { app, errors } = await open(page);
  const filters = app.getByRole('button', { name: /^Filters/ });
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await expect(app.getByRole('textbox', { name: 'Search tasks' })).not.toBeVisible();
  const firstCardTop = await app.locator('.task-card:visible').first().evaluate(card => card.getBoundingClientRect().top);
  expect(firstCardTop).toBeLessThan(360);
  const brand = await app.getByRole('heading', { name: 'Workbench', exact: true }).boundingBox();
  const newTask = await app.getByRole('button', { name: 'New task', exact: true }).boundingBox();
  expect(Math.abs(brand.y + brand.height / 2 - newTask.y - newTask.height / 2)).toBeLessThan(2);
  await page.screenshot({ path: 'dist/workbench-preview-verification/frontend-implementation/board-390.png', fullPage: true });
  await filters.click();
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-112');
  await expect(app.locator('.task-card:visible')).toHaveCount(1);
  await filters.click();
  await expect(filters).toContainText('1');
  await expect(app.getByRole('textbox', { name: 'Search tasks' })).not.toBeVisible();
  await expect(app.locator('.task-card:visible')).toContainText('WEB-112');
  await filters.click();
  await app.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(filters).not.toContainText('1');
  await filters.click();
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(app.getByRole('button', { name: 'New task', exact: true })).toBeInViewport({ ratio: 1 });
    const geometry = await app.locator('body').evaluate(body => ({ scroll: body.scrollWidth, viewport: innerWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport);
  }
  expect(errors).toEqual([]);
});

test('mobile More menu is keyboard accessible and repository dialog returns focus after Escape and outside click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { app, errors } = await open(page, '?theme=dark');
  const more = app.getByRole('button', { name: 'More options', exact: true });
  await more.press('Enter');
  await expect(app.getByRole('menuitem', { name: 'How it works', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(app.getByRole('menu')).toHaveCount(0);
  await expect(more).toBeFocused();
  for (const dismissal of ['escape', 'outside']) {
    await openHeaderAction(app, 'Add repository');
    const dialog = app.getByRole('dialog', { name: 'Add repository', exact: true });
    await expect(dialog).toBeVisible();
    await expect(app.getByRole('menu')).toHaveCount(0);
    if (dismissal === 'escape') await page.keyboard.press('Escape');
    else await app.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } });
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
  }
  await page.screenshot({ path: 'dist/workbench-preview-verification/frontend-implementation/board-dark-390.png', fullPage: true });
  expect(await page.evaluate(() => window.__workbenchPreview.messages)).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('desired outcome grows across lines and Enter never starts a chat before the explicit action', async ({ page }) => {
  const { app, errors } = await open(page, '?handoff=success');
  await app.getByRole('button', { name: 'New task', exact: true }).click();
  const outcome = app.getByLabel('Ticket or desired outcome');
  const startHeight = await outcome.evaluate(field => field.getBoundingClientRect().height);
  await outcome.fill('MULTILINE-123 Preserve the draft');
  await outcome.press('End');
  await outcome.press('Enter');
  await outcome.pressSequentially('Keep the search and repository selection.');
  await outcome.press('Enter');
  await outcome.pressSequentially('Verify with keyboard navigation.');
  await expect(outcome).toHaveValue('MULTILINE-123 Preserve the draft\nKeep the search and repository selection.\nVerify with keyboard navigation.');
  expect(await outcome.evaluate(field => field.getBoundingClientRect().height)).toBeGreaterThan(startHeight);
  expect(await page.evaluate(() => window.__workbenchPreview.messages)).toHaveLength(0);
  await expect(app.getByRole('checkbox', { name: 'Autopilot', exact: true })).not.toBeChecked();
  await page.screenshot({ path: 'dist/workbench-preview-verification/frontend-implementation/new-task.png', fullPage: true });
  await app.getByRole('button', { name: 'Start new chat', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Start a task', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__workbenchPreview.messages)).toHaveLength(1);
  const board = (await (await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.list', arguments: {} } })).json()).structuredContent;
  expect(board.tasks.find(task => task.key === 'MULTILINE-123').title).toContain('\nKeep the search');
  expect(errors).toEqual([]);
});

test('task evidence precedes the saved note and full technical facts expand only on request', async ({ page }) => {
  const { app, errors } = await open(page);
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-112');
  await app.getByRole('button', { name: 'Open Show a useful empty state', exact: true }).click();
  const dialog = app.getByRole('dialog', { name: 'Task details', exact: true });
  await expect(dialog.getByRole('button', { name: 'Resume original chat', exact: true })).toBeEnabled();
  const evidence = dialog.getByRole('region', { name: 'Verification and review' });
  await expect(evidence).toContainText('Verification');
  await expect(evidence).toContainText('Code review');
  await expect(dialog.getByText('Repository path', { exact: true })).not.toBeVisible();
  await expect(dialog.locator('.task-note')).toContainText('A disposable preview task.');
  const ordering = await dialog.evaluate(node => {
    const evidence = node.querySelector('.task-evidence'), note = node.querySelector('.task-note'), technical = node.querySelector('.task-technical');
    return { evidenceBeforeNote: Boolean(evidence.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING), noteBeforeTechnical: Boolean(note.compareDocumentPosition(technical) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  expect(ordering).toEqual({ evidenceBeforeNote: true, noteBeforeTechnical: true });
  await page.screenshot({ path: 'dist/workbench-preview-verification/frontend-implementation/task-details.png', fullPage: true });
  await dialog.locator('.task-technical summary').press('Enter');
  await expect(dialog.getByText('Repository path', { exact: true })).toBeVisible();
  await expect(dialog.locator('.task-technical')).toContainText('web-112');
  await expect(dialog.locator('.task-technical dd').first()).toContainText('workbench-preview-test-');
  expect(errors).toEqual([]);
});

test('attention stays near the board and a zero-result selection can always be switched off', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { app } = await open(page);
  await app.getByRole('navigation', { name: 'Jump to delivery stage' }).getByRole('button', { name: /^Build/ }).click();
  const attention = app.getByRole('button', { name: /Needs attention/ });
  await expect(app.locator('.results-heading').getByRole('button', { name: /Needs attention/ })).toBeVisible();
  await attention.click();
  await expect(attention).toHaveAttribute('aria-pressed', 'true');
  await expect(app.locator('.task-card:visible')).toContainText('Blocked');
  await app.getByRole('textbox', { name: 'Search tasks' }).fill('WEB-101');
  await expect(app.getByRole('heading', { name: 'No matching tasks' })).toBeVisible();
  await expect(attention).toBeEnabled();
  await attention.click();
  await expect(app.locator('.task-card:visible')).toContainText('Merged');
  await expect(attention).toBeDisabled();
});

test('release pending request requires confirmation and never dispatches a chat', async ({ page }) => {
  const { app } = await open(page);
  const listing = await (await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.list', arguments: {} } })).json();
  const repositoryId = listing.structuredContent.repositories[0].id;
  const prepared = await (await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.launch_prepare', arguments: { repositoryId, title: 'REC-901 Recover an undelivered request', autopilot: true } } })).json();
  expect(prepared.isError).not.toBe(true);
  await app.getByRole('button', { name: 'Refresh board', exact: true }).click();
  await app.getByRole('button', { name: 'Review pending request', exact: true }).click();
  const dialog = app.getByRole('dialog', { name: 'Release chat request' });
  await expect(dialog.getByRole('button', { name: 'Release request', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'I checked that this request was not delivered' }).check();
  await page.screenshot({ path: test.info().outputPath('recovery-dialog.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Release request', exact: true }).click();
  await expect(dialog).toBeHidden();
  const result = await (await page.request.post('http://127.0.0.1:4372/rpc', { data: { name: 'workbench.launch_get', arguments: { requestId: prepared.structuredContent.launch.id } } })).json();
  expect(result.structuredContent.launch.state).toBe('failed');
  expect(result.structuredContent.launch.resolution.kind).toBe('not_delivered');
  expect(await page.evaluate(() => window.__workbenchPreview.messages.length)).toBe(0);
  const card = app.locator('.task-card').filter({ hasText: 'REC-901' });
  await card.getByRole('button', { name: /Start/ }).click();
  await expect(app.getByRole('checkbox', { name: 'Autopilot', exact: true })).not.toBeChecked();
});
