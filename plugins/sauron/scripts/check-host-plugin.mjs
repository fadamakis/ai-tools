import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';

// Read plugin metadata through the installed host's public app-server protocol.
// This starts a separate diagnostic process, not a desktop UI or dot execution.
const [cliPath, marketplacePath, outputPath, mode] = process.argv.slice(2);
if (!cliPath || !marketplacePath || !outputPath) {
  throw new Error('Usage: node scripts/check-host-plugin.mjs <cli> <marketplace.json> <report.json>');
}
const child = spawn(cliPath, ['app-server', '--stdio', '-c', 'analytics.enabled=false'], {
  stdio: ['pipe', 'pipe', 'ignore'],
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
lines.on('line', line => {
  try {
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (resolve) resolve(message);
  } catch { /* Only protocol responses are relevant to this check. */ }
});
function send(message) { child.stdin.write(JSON.stringify(message) + '\n'); }
async function request(method, params) {
  const id = nextId++;
  let timer;
  const exited = code => pending.get(id)?.({ error: { message: `Diagnostic process exited (${code}).` } });
  try {
    const message = await new Promise(resolve => {
      pending.set(id, resolve);
      child.once('exit', exited);
      timer = setTimeout(() => resolve({ error: { message: 'Diagnostic request timed out.' } }), 20000);
      send({ id, method, params });
    });
    if (message.error) throw new Error(message.error.message);
    return message.result;
  } finally {
    clearTimeout(timer);
    pending.delete(id);
    child.off('exit', exited);
  }
}
try {
  await request('initialize', {
    clientInfo: { name: 'sauron-package-check', version: '0.1.1' },
    capabilities: { experimentalApi: true },
  });
  send({ method: 'initialized', params: {} });
  const result = await request('plugin/read', { marketplacePath, pluginName: 'sauron' });
  const report = { caller: 'Separate app-server using specified CLI; not native desktop or dot', ...result };
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    pluginId: result.plugin.summary.id,
    installed: result.plugin.summary.installed,
    mcpServers: result.plugin.mcpServers,
    skills: result.plugin.skills.map(skill => skill.name),
  }));
  if (!result.plugin.mcpServers.includes('sauron')) throw new Error('Host parser did not discover Sauron MCP service.');
  if (mode === '--inventory') {
    report.mcpInventory = await request('mcpServerStatus/list', {
      serverName: 'sauron', detail: 'full',
    });
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ mcpInventory: report.mcpInventory }));
  }
} finally {
  lines.close();
  child.stdin.end();
  child.kill();
}
