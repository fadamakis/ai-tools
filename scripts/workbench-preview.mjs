import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../plugins/workbench/server/index.mjs';
import { fixture, seedBoard } from '../plugins/workbench/tests/fixtures.mjs';
import { discoverRepositories } from '../plugins/workbench/server/repository-import.mjs';
import { readPr } from '../plugins/workbench/server/store.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appHtml = fs.readFileSync(path.join(workspace, 'plugins/workbench/app/dist/index.html'), 'utf8');
const testMode = process.env.WORKBENCH_PREVIEW_TEST_MODE === '1';
const firstRun = testMode && process.env.WORKBENCH_PREVIEW_FIRST_RUN === '1';
const sample = fixture({ legacy: false, prReader: url => url.startsWith('https://github.com/example/repository/') ? ({ url, title: /\/(123|124)$/.test(url) ? `EX-${url.split('/').at(-1)}: Imported delivery task` : 'Fixture pull request', state: /\/(117|123)$/.test(url) ? 'MERGED' : 'OPEN', mergedAt: /\/(117|123)$/.test(url) ? '2026-10-19T12:00:00Z' : null, headRefOid: 'a'.repeat(40), reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', statusCheckRollup: [{ status: 'IN_PROGRESS' }] }) : readPr(url) });
const restoreDirectory = process.env.WORKBENCH_PREVIEW_RESTORE_DIR;
if (restoreDirectory) {
  const metadata = JSON.parse(fs.readFileSync(path.join(restoreDirectory, 'metadata.json'), 'utf8'));
  fs.cpSync(path.join(restoreDirectory, 'fixture'), sample.directory, { recursive: true });
  const restored = JSON.parse(fs.readFileSync(sample.store.filename, 'utf8'));
  const storedFixtureRoots = restored.repositories.filter(repository => /\/workbench-preview-test-[^/]+\/project$/.test(repository.path)).map(repository => path.dirname(repository.path));
  const sourceRoots = [...new Set([metadata.originalDirectory, ...storedFixtureRoots].flatMap(root => [root, root.replace(/^\/var\//, '/private/var/'), root.replace(/^\/private\/var\//, '/var/')]))];
  const targetRoot = fs.realpathSync(sample.directory);
  const relocated = JSON.parse(JSON.stringify(restored, (_, value) => {
    if (typeof value !== 'string') return value;
    const source = sourceRoots.find(root => value.startsWith(`${root}/`));
    return source ? targetRoot + value.slice(source.length) : value;
  }));
  for (const repository of relocated.repositories) {
    const oldId = repository.id;
    repository.id = createHash('sha256').update(repository.commonDir).digest('hex').slice(0, 24);
    for (const record of [...relocated.tasks, ...relocated.launches]) if (record.repositoryId === oldId) record.repositoryId = repository.id;
  }
  fs.writeFileSync(sample.store.filename, JSON.stringify(relocated, null, 2) + '\n', { mode: 0o600 });
} else if (!firstRun) (await seedBoard(sample));
const importSample = testMode ? fixture() : null;
if (firstRun) {
  const note = path.join(path.dirname(importSample.legacyNote), 'EX-124.md');
  fs.renameSync(importSample.legacyNote, note);
  fs.writeFileSync(note, '# Workbench EX-124\n\nImported delivery task.\nhttps://github.com/example/repository/pull/124\n');
}
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const mcp = createServer({ store: sample.store, appHtml,
  ...(testMode ? { repositoryPicker: async () => ({ path: sample.repo, cancelled: false }), repositoryDiscovery: options => discoverRepositories({ ...options, roots: [sample.repo, importSample.repo] }) } : {}) });
await mcp.connect(serverTransport);
const client = new Client({ name: 'workbench-browser-test', version: '1.0.0' }); await client.connect(clientTransport);
const initial = await client.callTool({ name: 'workbench.open', arguments: {} });
const fixturePath = JSON.stringify(sample.repo).replaceAll('<', '\\u003c');
const hostScript = `
const frame=document.querySelector('iframe');
window.__workbenchPreview={requests:[],messages:[],openedLinks:[],fixturePath:${fixturePath},errors:{}};
const state=window.__workbenchPreview;
function send(value){frame.contentWindow.postMessage({jsonrpc:'2.0',...value},'*');}
state.notify=(method,params)=>send({method,params});
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow||!event.data?.jsonrpc)return;
 const request=event.data;state.requests.push(request);if(request.id===undefined)return;
 try{
  let result={};
  if(request.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostInfo:{name:'Workbench browser test',version:'26.1019.1'},hostCapabilities:{openLinks:{},message:{text:{}},experimental:{'openai/modelContext':{},...new URLSearchParams(location.search).has('noMessages')?{}:{'openai/message':{}}}},hostContext:{theme:new URLSearchParams(location.search).get('theme')||'light',displayMode:'fullscreen'}};
  if(request.method==='ui/update-model-context'&&new URLSearchParams(location.search).has('contextFailure'))throw new Error('Host context temporarily unavailable');
  if(request.method==='tools/call'){
   if(state.errors[request.params.name])result={isError:true,content:[{type:'text',text:state.errors[request.params.name]}]};
   else if(request.params.name==='workbench.repository_pick'&&state.pickerCancelled)result={structuredContent:{cancelled:true},content:[]};
   else result=await (await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request.params)})).json();
  }
  if(request.method==='ui/message'){
   state.messages.push(request.params);
   document.querySelector('#host-status').textContent='Native handoff simulated. No Codex chat was created.';
   const requestId=request.params.content?.[0]?.text?.match(/board-request ([a-f0-9-]{36})/)?.[1];
   if(requestId){await fetch('/simulate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,mode:new URLSearchParams(location.search).get('handoff')})});}
  }
  if(request.method==='ui/open-link')state.openedLinks.push(request.params.url);
  send({id:request.id,result});
  if(request.method==='ui/initialize'&&!new URLSearchParams(location.search).has('deferBoard'))queueMicrotask(()=>send({method:'ui/notifications/tool-result',params:${JSON.stringify(initial).replaceAll('<', '\\u003c')}}));
 }catch(error){send({id:request.id,error:{code:-32603,message:error.message}});}
});`;
const host = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workbench Preview · Browser test</title><style>html,body{height:100%;margin:0;font:11px system-ui}body{display:flex;flex-direction:column}aside{padding:9px 16px;background:#eef3ef;color:#405f5a;display:flex;gap:12px;align-items:center;flex-wrap:wrap}aside a{color:inherit}iframe{width:100%;flex:1;border:0;min-height:0}</style></head><body><aside><strong>Browser test</strong><span id="host-status">${testMode ? 'Disposable repositories and simulated folder selection.' : 'Local folders import read-only. Browser test data is temporary.'} Native chat actions are simulated.</span><a href="?theme=light">Light</a><a href="?theme=dark">Dark</a></aside><iframe title="Workbench Preview" sandbox="allow-scripts allow-same-origin" src="/app"></iframe><script>${hostScript}</script></body></html>`;
const server = http.createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  try {
    if (request.method === 'GET' && request.url === '/app') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(appHtml); return; }
    if (request.method === 'GET' && (request.url === '/' || request.url.startsWith('/?'))) { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(host); return; }
    if (request.method === 'POST' && ['/rpc', '/simulate'].includes(request.url)) {
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 128 * 1024) throw new Error('Request too large.'); }
      const args = JSON.parse(body); let result;
      if (request.url === '/rpc') result = await client.callTool(args);
      else {
        (await sample.store.claimLaunch(args.requestId));
        if (testMode && args.mode === 'success') {
          const { launch, task, repository } = sample.store.launchGet(args.requestId);
          const threadId = launch.target === 'existing' ? launch.threadId : randomUUID();
          let checkout = task.checkout || repository.path;
          if (launch.target === 'new' && launch.environment === 'worktree') {
            checkout = path.join(sample.directory, `simulated-worktree-${launch.id}`);
            sample.git('worktree', 'add', '--detach', checkout);
          }
          const worker = (await sample.store.register({ repositoryId: repository.id, key: task.key, title: task.title, threadId, checkout }));
          (await sample.store.progress({ taskId: task.id, expectedRevision: worker.revision, stage: 'plan', status: 'paused', summary: 'Simulated worker checkpoint. No native chat was created.', nextAction: 'Fixture handoff complete.', threadId }));
          result = (await sample.store.finishLaunch({ requestId: args.requestId, state: 'sent', threadId }));
        } else result = (await sample.store.finishLaunch({ requestId: args.requestId, state: 'failed', error: 'Browser test only. No native chat was created.' }));
      }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result)); return;
    }
    response.writeHead(404); response.end('Not found');
  } catch (error) { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ isError: true, content: [{ type: 'text', text: error.message }] })); }
});
const port = Number(process.env.WORKBENCH_PREVIEW_PORT || 4371);
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, fixture: sample.repo, pid: process.pid, testMode, nativeChatActions: 'simulated' })));
async function shutdown() { server.close(); await client.close(); await mcp.close(); await sample.cleanup(); await importSample?.cleanup(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
