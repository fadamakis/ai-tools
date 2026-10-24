import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from '../../plugins/shelob/server/index.mjs';
import { ReviewStore } from '../../plugins/shelob/server/store.mjs';

async function client(store) {
  const server = createServer({ store });
  const connection = new Client({ name: 'shelob-browser-fixture', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await connection.connect(b);
  return connection;
}

test('rendered app acknowledges its own resource; another worker verifies that UI and current policy', async ({ page }) => {
  // This is an isolated MCP App host fixture, never native Codex acceptance proof.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-browser-connection-'));
  const ui = await client(new ReviewStore({ root }));
  const worker = new Client({ name: 'separate-shelob-worker', version: '1.0.0' });
  await worker.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('plugins/shelob/tests/helpers/preflight-worker.mjs'), root], stderr: 'pipe' }));
  const calls = [], target = { repository: 'example/repo', prNumber: 42, headSha: 'a'.repeat(40) };
  try {
    expect((await worker.callTool({ name: 'shelob.preflight', arguments: { target } })).structuredContent.status).toBe('ui_unverified');
    const resource = (await ui.readResource({ uri: 'ui://shelob/review/app.html' })).contents[0].text;
    expect((await worker.callTool({ name: 'shelob.preflight', arguments: { target } })).structuredContent.status).toBe('ui_unverified');
    await page.exposeFunction('shelobFixtureCall', async request => {
      calls.push(request.name);
      if (!['shelob.list', 'shelob.settings', 'shelob.approval_policy', 'shelob.ui_heartbeat'].includes(request.name)) throw Error('Unexpected fixture mutation');
      return ui.callTool(request);
    });
    await page.route('https://shelob-fixture.invalid/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><iframe title="Shelob connection fixture" style="width:100%;height:950px" sandbox="allow-scripts"></iframe></body></html>' }));
    await page.goto('https://shelob-fixture.invalid/');
    await page.evaluate(html => {
      const frame = document.querySelector('iframe');
      window.addEventListener('message', async event => {
        if (event.source !== frame.contentWindow || !event.data?.jsonrpc || event.data.id === undefined) return;
        const request = event.data; let result = {};
        if (request.method === 'ui/initialize') result = { protocolVersion: '2026-01-26', hostInfo: { name: 'Isolated Shelob test host', version: '1' }, hostCapabilities: { openLinks: {}, message: { text: {} }, experimental: { 'openai/model-context': {} } }, hostContext: { theme: 'light', displayMode: 'fullscreen' } };
        else if (request.method === 'tools/call') result = await window.shelobFixtureCall(request.params);
        frame.contentWindow.postMessage({ jsonrpc: '2.0', id: request.id, result }, '*');
      });
      frame.srcdoc = html;
    }, resource);
    const app = page.frameLocator('iframe');
    await expect(app.getByRole('heading', { name: 'Your reviews', exact: true })).toBeVisible();
    await expect.poll(async () => (await worker.callTool({ name: 'shelob.preflight', arguments: { target } })).structuredContent.safeToReview).toBe(true);
    await app.getByRole('button', { name: 'More options', exact: true }).click();
    await app.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const panel = app.getByRole('region', { name: 'Review preflight', exact: true });
    await expect(panel).toContainText('This window has acknowledged its Shelob server.');
    const readback = (await worker.callTool({ name: 'shelob.preflight', arguments: { target } })).structuredContent;
    await expect(panel).toContainText(readback.ui.connectionId);
    await expect(panel).toContainText(readback.server.storeFingerprint);
    expect(readback.ui.sameServerProcess).toBe(false);
    expect(readback.policy.enabled).toBe(false);
    await expect(app.locator('#auto-approve-clean')).not.toBeChecked();
    expect(calls).toContain('shelob.ui_heartbeat');
    expect(calls.some(name => /start|finalize|code_review|_save|_post/.test(name))).toBe(false);
    await page.screenshot({ path: 'dist/releases/0.11.8/preflight-fixture.png', fullPage: true });
  } finally {
    if (test.info().status !== test.info().expectedStatus) await test.info().attach('connection-diagnostics', { body: JSON.stringify({ calls, body: await page.frameLocator('iframe').locator('body').innerText(), preflight: (await worker.callTool({ name: 'shelob.preflight', arguments: { target } })).structuredContent }), contentType: 'application/json' });
    await page.close(); await ui.close(); await worker.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
