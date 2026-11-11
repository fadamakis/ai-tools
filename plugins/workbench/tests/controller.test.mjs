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
  assert.match(auto, /Never merge/); assert.match(auto, /I authorize only this one launch/);
});

test('launch prepares one editable draft without submitting it or claiming delivery', async t => {
  const launch = { id, taskId: id, target: 'new', environment: 'local', autopilot: false, state: 'prepared' };
  const { vm, messages, requests } = setup(t, request => request.name === 'workbench.launch_prepare' ? { launch, task: { key: 'EX-123', title: 'Save the draft' }, dispatch: true } : { launch });
  await vm.launch({ title: 'EX-123', repositoryId: 'a'.repeat(24), autopilot: false });
  assert.equal(messages.length, 1); assert.deepEqual(messages[0]._meta['openai/message'], { target: 'new', send: false });
  assert.equal(requests[0].name, 'workbench.launch_prepare');
  assert.equal(requests.some(request => ['workbench.launch_claim', 'workbench.launch_finish'].includes(request.name)), false);
  assert.equal(vm.lastLaunch.state, 'prepared');
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
  await assert.rejects(() => vm.launch({ taskId: id }), /Could not confirm the launch draft/);
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

test('opening a visible compatible board checks delivery once and ordinary refreshes remain read-only', async t => {
  const board = { repositories: [], tasks: [{ id, stage: 'plan', status: 'blocked' }], launches: [], reconciliation: { available: true } };
  const { vm, requests, messages } = setup(t, request => request.name === 'workbench.reconcile' ? { status: 'checked', checked: 1 } : board);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await vm.connect();
  assert.equal(requests.filter(request => request.name === 'workbench.reconcile').length, 1);
  const count = requests.length;
  await vm.refresh(); await vm.refresh();
  assert.deepEqual(requests.slice(count).map(request => request.name), ['workbench.list', 'workbench.list']);
  assert.deepEqual(vm.board.tasks, board.tasks);
  assert.equal(messages.length, 0);
  assert.deepEqual([...new Set(requests.map(request => request.name))].sort(), ['workbench.list', 'workbench.reconcile', 'workbench.repository_discover']);
});

test('older servers and hidden panels do not perform automatic delivery checks', async t => {
  const { vm, requests, messages } = setup(t);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await vm.connect(); await vm.reconcile(true);
  assert.equal(requests.some(request => request.name === 'workbench.reconcile'), false);
  vm.board.reconciliation = { available: true };
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await vm.connect();
  assert.equal(requests.some(request => request.name === 'workbench.reconcile'), false);
  assert.equal(messages.length, 0);
});

test('an automatic check and a concurrent manual check share one in-flight operation', async t => {
  let release;
  const board = { repositories: [], tasks: [{ id, stage: 'plan', status: 'blocked' }], launches: [], reconciliation: { available: true } };
  const { vm, requests, messages } = setup(t, request => request.name === 'workbench.reconcile' ? new Promise(resolve => { release = resolve; }) : board);
  await vm.refresh();
  const automatic = vm.reconcile();
  await vm.reconcile(true, id);
  assert.equal(vm.statusChecking, true);
  assert.equal(requests.filter(request => request.name === 'workbench.reconcile').length, 1);
  release({ status: 'checked', checked: 1 }); await automatic;
  assert.equal(vm.statusChecking, false);
  assert.equal(vm.board.tasks[0].id, id);
  assert.equal(messages.length, 0);
});

test('a failed automatic status read preserves the board and a manual failure remains visible to its caller', async t => {
  const board = { repositories: [], tasks: [{ id, stage: 'plan', status: 'blocked', nextAction: 'Wait for the test account.' }], launches: [], reconciliation: { available: true } };
  const { vm, requests, messages } = setup(t, request => {
    if (request.name === 'workbench.reconcile') throw new Error('GitHub is unavailable');
    return board;
  });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await vm.connect();
  assert.deepEqual(vm.board, board);
  assert.equal(vm.statusChecking, false);
  assert.equal(vm.statusError, 'GitHub is unavailable');
  assert.equal(vm.error, '');
  assert.equal(requests.filter(request => request.name === 'workbench.reconcile').length, 1);
  await assert.rejects(() => vm.reconcile(true, id), /GitHub is unavailable/);
  assert.deepEqual(vm.board, board);
  assert.equal(vm.statusChecking, false);
  assert.equal(messages.length, 0);
});

test('visible polling checks delivery after five minutes and pauses remote checks while hidden', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-29T08:00:00Z') });
  const board = { repositories: [], tasks: [], launches: [], reconciliation: { available: true } };
  const { vm, requests, messages } = setup(t, request => request.name === 'workbench.reconcile' ? { status: 'checked', checked: 0 } : board);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await vm.connect();
  const checks = () => requests.filter(request => request.name === 'workbench.reconcile').length;
  t.mock.timers.tick(2000); await new Promise(setImmediate);
  assert.equal(checks(), 1);
  t.mock.timers.tick(298000); await new Promise(setImmediate);
  assert.equal(checks(), 2);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  t.mock.timers.tick(300000); await new Promise(setImmediate);
  assert.equal(checks(), 2);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  t.mock.timers.tick(2000); await new Promise(setImmediate);
  assert.equal(checks(), 3);
  assert.equal(messages.length, 0);
});
