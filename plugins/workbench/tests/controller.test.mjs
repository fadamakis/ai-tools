import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { BoardController, launchMessage } from '../app/controller.mjs';

const id = '12345678-1234-4123-8123-123456789abc';
function setup(t, handler, send = async () => ({})) {
  const dom = new JSDOM('<html><body></body></html>'), before = globalThis.document; globalThis.document = dom.window.document;
  const requests = [], messages = [], contexts = [];
  const app = { addEventListener() {}, connect: async () => {}, getHostContext: () => ({ theme: 'dark' }), callServerTool: async request => { requests.push(request); return { structuredContent: await handler?.(request) || { repositories: [], tasks: [], launches: [] } }; } };
  const extensions = { message: { send: async message => { messages.push(message); return send(message); } }, modelContext: { update: async context => contexts.push(context) } };
  const vm = new BoardController(app, extensions, { applyDocumentTheme() {}, applyHostStyleVariables() {} });
  t.after(() => { vm.disposed = true; clearTimeout(vm.timer); globalThis.document = before; dom.window.close(); });
  return { vm, app, requests, messages, contexts };
}

test('board actions request a native handoff with exact run permission and destination', () => {
  const task = { key: 'EX-123', title: 'Save the draft' }, threadId = '22345678-1234-4123-8123-123456789abc';
  const normal = launchMessage({ id, taskId: threadId, target: 'existing', threadId, autopilot: false }, task);
  assert.match(normal, /board-request 12345678/); assert.match(normal, /Resume task "EX-123" in its original chat/);
  assert.match(normal, /Autopilot is off\. No commits, pushes, PR publication or review replies/);
  assert.equal(normal.includes(threadId), false); assert.equal(normal.match(/[a-f0-9-]{36}/g).length, 1);
  const auto = launchMessage({ id, taskId: id, target: 'new', environment: 'worktree', autopilot: true }, task);
  assert.match(auto, /one new native Codex worktree chat/); assert.match(auto, /Autopilot is on: commits, ordinary pushes, a draft PR and addressed review replies/);
  assert.match(auto, /Never merge/); assert.match(auto, /authorizes only this one launch/);
});

test('launch sends exactly once through the active board chat after saving the request', async t => {
  const launch = { id, taskId: id, target: 'new', environment: 'local', autopilot: false };
  const { vm, messages, requests } = setup(t, request => request.name === 'workbench.launch_prepare' ? { launch, task: { key: 'EX-123', title: 'Save the draft' }, dispatch: true } : { launch });
  await vm.launch({ title: 'EX-123', repositoryId: 'a'.repeat(24), autopilot: false });
  assert.equal(messages.length, 1); assert.deepEqual(messages[0]._meta['openai/message'], { target: 'active', send: true });
  assert.equal(requests[0].name, 'workbench.launch_prepare');
});

test('pending launch and missing host capability never send messages', async t => {
  const { vm, messages, requests } = setup(t, () => ({ launch: { id }, dispatch: false }));
  await vm.launch({ taskId: id }); assert.equal(messages.length, 0);
  vm.extensions.message = undefined; const count = requests.length;
  await assert.rejects(() => vm.launch({ taskId: id }), /cannot launch/);
  assert.equal(requests.length, count);
});

test('send failure records uncertainty and does not resend', async t => {
  const { vm, requests, messages } = setup(t, request => request.name === 'workbench.launch_prepare' ? { launch: { id, taskId: id, target: 'new', environment: 'local' }, task: { key: 'EX-123' }, dispatch: true } : {}, async () => { throw new Error('connection lost'); });
  await assert.rejects(() => vm.launch({ taskId: id }), /unconfirmed/);
  assert.equal(messages.length, 1); assert.equal(requests.filter(request => request.name === 'workbench.launch_uncertain').length, 1);
});

test('receipt is confirmed only by a saved worker acceptance and receipt-read errors retain pending state', async t => {
  let state = 'sent', failReceipt = false;
  const { vm, messages } = setup(t, request => {
    if (request.name === 'workbench.launch_get') { if (failReceipt) throw new Error('Disconnected'); return { launch: { id, taskId: id, state } }; }
    return { repositories: [], tasks: [], launches: [] };
  });
  vm.lastLaunch = { id, taskId: id, state: 'prepared', title: 'Save the draft' };
  await vm.refresh(); assert.equal(vm.lastLaunch.state, 'sent');
  failReceipt = true; await vm.refresh(); assert.equal(vm.lastLaunch.state, 'sent');
  failReceipt = false; state = 'accepted'; await vm.refresh(); assert.equal(vm.lastLaunch.state, 'accepted');
  assert.equal(messages.length, 0);
});

test('connection does not report an empty board before saved work has loaded', async t => {
  let release;
  const { vm, app } = setup(t);
  app.connect = () => new Promise(resolve => { release = resolve; });
  const pending = vm.connect(); assert.equal(vm.hasBoard, false);
  release(); await pending; assert.equal(vm.hasBoard, true);
});

test('a fresh sidebar launch resets an old selection and ignores late detail reads', async t => {
  let release; const { vm, app } = setup(t, () => new Promise(resolve => { release = resolve; }));
  const pending = vm.select(id);
  app.ontoolresult({ structuredContent: { entrypoint: 'global', repositories: [], tasks: [], launches: [], selected: null } });
  release({ task: { id } }); await pending;
  assert.equal(vm.selected, null);
});

test('closing details ignores a late selected-task response', async t => {
  let release; const { vm } = setup(t, () => new Promise(resolve => { release = resolve; }));
  const pending = vm.select(id); vm.closeDetail(); release({ task: { id } }); await pending;
  assert.equal(vm.selected, null);
});

test('reading the board never performs a remote PR check or starts work', async t => {
  const { vm, requests, messages } = setup(t);
  await vm.refresh();
  assert.deepEqual(requests.map(request => request.name), ['workbench.list']); assert.equal(messages.length, 0);
});

test('releasing a request records confirmation and never sends a chat message', async t => {
  const launch = { id, state: 'uncertain', updatedAt: '2026-10-20T10:00:00.000Z' };
  const { vm, messages, requests } = setup(t, request => request.name === 'workbench.launch_resolve' ? { launch: { ...launch, state: 'failed' } } : { repositories: [], tasks: [], launches: [] });
  vm.lastLaunch = launch;
  await vm.resolveLaunch(launch);
  assert.equal(messages.length, 0);
  assert.deepEqual(requests[0].arguments, { requestId: id, expectedState: launch.state, expectedUpdatedAt: launch.updatedAt, confirmedNotDelivered: true });
  assert.equal(vm.lastLaunch.state, 'failed');
});

test('an optional model-context failure cannot stop board polling or make a successful selection fail', async t => {
  const { vm } = setup(t, request => request.name === 'workbench.get' ? { task: { id, stage: 'plan' }, repository: { path: '/fixture' } } : null);
  vm.extensions.modelContext.update = async () => { throw new Error('Host context temporarily unavailable'); };
  await vm.connect();
  assert.ok(vm.timer, 'local polling remains scheduled');
  await vm.select(id);
  assert.equal(vm.selected.task.id, id);
});
