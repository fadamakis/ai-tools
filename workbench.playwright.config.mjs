import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './plugins/workbench/tests/ui', workers: 1, timeout: 30000, reporter: [['list'], ['json', { outputFile: 'dist/workbench-preview-verification/ui-results.json' }]],
  use: { browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, launchOptions: process.env.WORKBENCH_BROWSER ? { executablePath: process.env.WORKBENCH_BROWSER } : {}, trace: 'retain-on-failure' },
  webServer: { command: 'WORKBENCH_PREVIEW_PORT=4372 WORKBENCH_PREVIEW_TEST_MODE=1 node scripts/workbench-preview.mjs', url: 'http://127.0.0.1:4372', reuseExistingServer: false, timeout: 15000 }, outputDir: 'dist/workbench-preview-verification/ui-traces' });
