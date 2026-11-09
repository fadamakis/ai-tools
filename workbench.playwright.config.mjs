import { defineConfig } from '@playwright/test';
const port = Number(process.env.WORKBENCH_PREVIEW_PORT || 4372);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a valid Workbench test port.');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({ testDir: './plugins/workbench/tests/ui', workers: 1, timeout: 30000, reporter: [['list'], ['json', { outputFile: 'dist/workbench-preview-verification/ui-results.json' }]],
  use: { baseURL, browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, launchOptions: process.env.WORKBENCH_BROWSER ? { executablePath: process.env.WORKBENCH_BROWSER } : {}, trace: 'retain-on-failure' },
  webServer: { command: `WORKBENCH_PREVIEW_PORT=${port} WORKBENCH_PREVIEW_TEST_MODE=1 node scripts/workbench-preview.mjs`, url: baseURL, reuseExistingServer: false, timeout: 15000 }, outputDir: 'dist/workbench-preview-verification/ui-traces' });
