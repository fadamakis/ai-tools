import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { contrastRatio } from './contrast.mjs';
const version = JSON.parse(fs.readFileSync('plugins/shelob/plugin.json', 'utf8')).version;
const base = pathToFileURL(path.resolve(`dist/shelob-${version}-preview/index.html`)).href;

for (const theme of ['light', 'dark']) {
  test(`review disclosure and code evidence remain keyboard accessible (${theme})`, async ({ page }) => {
    await page.goto(`${base}?theme=${theme}`);
    const app = page.frameLocator('iframe');
    const disclosure = app.locator('.previous-reviews summary').first();
    await expect(disclosure).toBeVisible();
    expect((await disclosure.boundingBox()).height).toBeGreaterThanOrEqual(32);
    await disclosure.focus();
    await disclosure.press('Enter');
    await expect(app.locator('.previous-reviews').first()).toHaveAttribute('open', '');
    await page.evaluate(() => {
      const report = window.__shelobPreview.fixture.values[1].report;
      report.results.find(result => result.findings.length).findings[0].evidence[0].snippet = 'const example = "' + 'long code '.repeat(80) + '";';
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await app.locator('[data-run="22345678-1234-4123-8123-123456789abc"]').click();
    const evidence = app.getByRole('region', { name: /^Code evidence for/ }).first();
    await evidence.focus();
    await expect(evidence).toBeFocused();
    expect(await evidence.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await evidence.press('ArrowRight');
    await expect.poll(() => evidence.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await evidence.press('ArrowLeft');
    await expect.poll(() => evidence.evaluate(node => node.scrollLeft)).toBe(0);
    const modified = await evidence.evaluate(node => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      return { prevented: event.defaultPrevented, scroll: node.scrollLeft };
    });
    expect(modified).toEqual({ prevented: false, scroll: 0 });
    expect(await evidence.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    await evidence.press('Tab');
    await expect(evidence).not.toBeFocused();
    await app.getByRole('button', { name: 'New review', exact: true }).click();
    expect(await contrastRatio(app.locator('#pr-url'), '::placeholder')).toBeGreaterThanOrEqual(4.5);
  });
}

test('previous review attempts have a touch-sized disclosure', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(base);
    const app = page.frameLocator('iframe');
    const disclosure = app.locator('.previous-reviews summary').first();
    await expect(disclosure).toBeVisible();
    expect((await disclosure.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await disclosure.tap();
    await expect(app.locator('.previous-reviews').first()).toHaveAttribute('open', '');
  } finally { await context.close(); }
});
