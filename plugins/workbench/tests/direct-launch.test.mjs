import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardController, launchMessage } from '../app/controller.mjs';
import { taskChatUrl, taskTicketUrl } from '../app/presentation.mjs';
import { fixture, registered, threadId, otherThread } from './fixtures.mjs';

const title = 'https://issues.example.com/browse/EX-123';

test('a new launch opens one worker draft with its ticket and never uses the active coordinator chat', async () => {
  const messages = [], calls = [];
  const launch = { id: otherThread, taskId: threadId, delivery: 'draft', target: 'new', environment: 'worktree', state: 'prepared' };
  const app = { addEventListener() {}, callServerTool: async request => {
    calls.push(request);
    return { structuredContent: request.name === 'workbench.launch_prepare' ? { launch, task: { key: 'EX-123', title }, repository: { path: '/project' }, dispatch: true } : { launch } };
  } };
  const vm = new BoardController(app, { message: { send: async message => messages.push(message) } }, {});
  await vm.launch({ title, repositoryId: 'a'.repeat(24), environment: 'worktree' });
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]._meta['openai/message'], { target: 'new', send: false });
  assert.match(messages[0].content[0].text, /This chat is the worker; do not create or message another chat/);
  assert.match(messages[0].content[0].text, /https:\/\/issues.example.com\/browse\/EX-123/);
  assert.match(messages[0].content[0].text, /Select this repository and Worktree/);
  assert.match(messages[0].content[0].text, /Autopilot is off/);
  assert.equal(calls[0].arguments.delivery, 'draft');
  assert.equal(calls.some(call => /launch_claim|launch_finish/.test(call.name)), false);
});

test('resume navigates to the exact worker without preparing a request or sending another turn', async () => {
  const urls = [];
  const vm = new BoardController({ addEventListener() {}, openLink: async ({ url }) => urls.push(url), callServerTool: async () => assert.fail('Resume must not prepare a request') }, { message: { send: async () => assert.fail('Resume must not send a message') } }, {});
  await vm.resume({ threadId });
  assert.deepEqual(urls, [`codex://threads/${threadId}`]);
});

test('the submitted draft binds the same task and worker; checkout mismatches preserve the request', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const { repository } = await sample.store.addRepository(sample.repo, false);
  const prepared = await sample.store.prepareLaunch({ repositoryId: repository.id, title, delivery: 'draft', environment: 'worktree' });
  assert.equal(prepared.launch.delivery, 'draft');
  await sample.store.claimLaunch(prepared.launch.id);
  const register = checkout => sample.store.register({ repositoryId: repository.id, key: 'EX-123', title, threadId, checkout, requestId: prepared.launch.id });
  await assert.rejects(register(sample.repo), /Select the requested repository/);
  assert.equal(sample.store.launchGet(prepared.launch.id).launch.state, 'dispatching');
  assert.equal(sample.store.get(prepared.launch.taskId).task.threadId, undefined);
  const checkout = `${sample.directory}/worker`; sample.git('worktree', 'add', '--detach', checkout);
  const worker = await register(checkout);
  assert.equal(worker.id, prepared.launch.taskId); assert.equal(worker.key, 'EX-123'); assert.equal(worker.threadId, threadId);
  assert.equal(sample.store.launchGet(prepared.launch.id).launch.state, 'accepted');
  assert.equal(taskTicketUrl(worker), title);
  assert.equal(taskChatUrl(worker), `codex://threads/${threadId}`);
});

test('direct resumes require navigation and a new continuation remains explicit', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const task = await registered(sample);
  await assert.rejects(sample.store.prepareLaunch({ taskId: task.id, delivery: 'draft' }), /Open the saved worker chat/);
  assert.equal(sample.store.get(task.id).launches.length, 0);
  assert.equal((await sample.store.prepareLaunch({ taskId: task.id, delivery: 'draft', continuation: true })).launch.target, 'new');
});

test('old tasks expose saved ticket links without a migration and reject unsafe references', () => {
  assert.equal(taskTicketUrl({ title }), title);
  assert.equal(taskTicketUrl({ title: 'Review this ticket', sourceUrl: title }), title);
  assert.equal(taskTicketUrl({ title: 'Review EX-123' }), '');
  assert.equal(taskTicketUrl({ sourceUrl: 'javascript:alert(1)' }), '');
  assert.equal(taskTicketUrl({ sourceUrl: 'https://user:secret@issues.example.com' }), '');
  assert.equal(taskChatUrl({ threadId: 'untrusted/path' }), '');
  assert.match(launchMessage({ id: threadId, target: 'existing' }, { key: 'EX-123' }), /Resume task/);
});

test('a pending direct continuation preserves its original worker and requires the new worker request ID', async t => {
  const sample = fixture({ legacy: false }); t.after(sample.cleanup);
  const task = await registered(sample);
  const prepared = await sample.store.prepareLaunch({ taskId: task.id, continuation: true, delivery: 'draft' });
  await sample.store.claimLaunch(prepared.launch.id);
  await registered(sample);
  assert.equal(sample.store.launchGet(prepared.launch.id).launch.state, 'dispatching');
  await assert.rejects(registered(sample, task.key, otherThread), /exact launch request ID/);
  assert.equal(sample.store.get(task.id).task.threadId, threadId);
  const worker = await sample.store.register({ repositoryId: task.repositoryId, key: task.key, title: task.title, threadId: otherThread, checkout: sample.repo, requestId: prepared.launch.id });
  assert.equal(worker.threadId, otherThread);
  assert.equal(sample.store.launchGet(prepared.launch.id).launch.state, 'accepted');
});
