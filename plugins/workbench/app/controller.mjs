export const stages = [
  ['backlog', 'Backlog', 'Ready to begin'], ['plan', 'Plan', 'Scope & decisions'], ['build', 'Build', 'Implement & simplify'],
  ['verify', 'Verify', 'Behavior & evidence'], ['review', 'Review', 'Independent review'], ['pr', 'PR', 'CI & feedback'], ['done', 'Done', 'Merge verified']
];

export function launchMessage(launch, task) {
  const destination = launch.target === 'existing' ? 'Resume' : 'Start';
  const target = launch.target === 'existing' ? 'in its original chat' : `in one new native Codex ${launch.environment} chat`;
  const mode = launch.autopilot ? 'Autopilot is on: commits, ordinary pushes, a draft PR and addressed review replies are authorized. Never merge.' : 'Autopilot is off. No commits, pushes, PR publication or review replies are authorized.';
  return `Use /workbench:start board-request ${launch.id}.\n${destination} task ${JSON.stringify(task.key)} ${target}. ${mode} This click authorizes only this one launch.`;
}

export class BoardController {
  constructor(app, extensions, themeHelpers) {
    this.app = app; this.extensions = extensions; this.themeHelpers = themeHelpers;
    this.board = { repositories: [], tasks: [], launches: [] }; this.selected = null; this.modal = null;
    this.error = ''; this.errorDetails = ''; this.notice = ''; this.undoArchive = null; this.connected = false; this.hasBoard = false; this.busy = false; this.busyLabel = ''; this.lastLaunch = null; this.version = 0;
    this.listeners = new Set(); this.epoch = 0; this.detailEpoch = 0; this.disposed = false;
    this.discovery = { repositories: [], pickerAvailable: true }; this.discovering = false; this.discoveryError = '';
    app.ontoolresult = result => this.consume(result);
    app.addEventListener('hostcontextchanged', context => this.hostContext(context));
    app.onteardown = async () => { this.disposed = true; clearTimeout(this.timer); this.epoch++; this.detailEpoch++; return {}; };
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  snapshot = () => this.version;
  publish() { if (!this.disposed) { this.version++; for (const listener of this.listeners) listener(); } }
  async call(name, args = {}, options) {
    const result = await this.app.callServerTool({ name, arguments: args }, options);
    if (result.isError) throw Object.assign(new Error(result.content?.find(item => item.type === 'text')?.text || 'Workbench Preview could not complete this action.'), { details: result.structuredContent?.error?.details });
    return result.structuredContent;
  }
  consume(result) {
    const value = result.structuredContent || {};
    if (value.entrypoint) { this.epoch++; this.detailEpoch++; this.modal = null; this.selected = value.selected || null; }
    if (value.tasks) { this.board = value; this.hasBoard = true; }
    this.publish();
    if (this.connected) this.context().catch(() => {});
  }
  async refresh() {
    const epoch = ++this.epoch;
    const board = await this.call('workbench.list');
    if (epoch !== this.epoch || this.disposed) return;
    this.board = board; this.hasBoard = true; this.publish();
    if (this.lastLaunch && !['accepted', 'failed'].includes(this.lastLaunch.state)) {
      const requestId = this.lastLaunch.id;
      try {
        const { launch } = await this.call('workbench.launch_get', { requestId });
        if (epoch === this.epoch && this.lastLaunch?.id === requestId) { this.lastLaunch = { ...this.lastLaunch, ...launch }; this.publish(); }
      } catch { /* Keep the last known receipt. A failed read does not confirm delivery. */ }
    }
    if (epoch !== this.epoch || this.disposed) return;
    if (this.selected) await this.select(this.selected.task.id, false);
  }
  async select(taskId, clearError = true) {
    const epoch = ++this.detailEpoch;
    if (clearError) this.error = '';
    const selected = await this.call('workbench.get', { taskId });
    if (epoch !== this.detailEpoch || this.disposed) return;
    this.selected = selected; this.publish(); await this.context();
  }
  closeDetail() { this.detailEpoch++; this.selected = null; this.error = ''; this.errorDetails = ''; this.publish(); this.context().catch(() => {}); }
  showModal(value) { this.modal = value; this.error = ''; this.errorDetails = ''; this.publish(); if (value.kind === 'repository') void this.discover(); }
  closeModal() { if (!this.busy) { this.modal = null; this.error = ''; this.errorDetails = ''; this.publish(); } }
  async action(callback, label = 'Working…') {
    if (this.busy) return;
    this.busy = true; this.busyLabel = label; this.error = ''; this.errorDetails = ''; this.notice = ''; this.epoch++; this.publish();
    try { await callback(); }
    catch (error) { this.error = error.message || String(error); this.errorDetails = error.details || ''; }
    finally { this.busy = false; this.busyLabel = ''; this.publish(); this.schedule(); }
  }
  async addRepository(path, importExisting) {
    this.undoArchive = null;
    const result = await this.call('workbench.repository_add', { path, importExisting }, { timeout: 90000 });
    this.modal = null; this.notice = `Added ${result.repository.name}. ${result.imported} existing task${result.imported === 1 ? '' : 's'} imported read-only.`;
    if (result.reconciliation) {
      this.notice += ` ${result.reconciliation.checked} linked PR${result.reconciliation.checked === 1 ? '' : 's'} checked against GitHub.`;
      if (result.reconciliation.unverified) this.notice += ` ${result.reconciliation.unverified} imported task${result.reconciliation.unverified === 1 ? ' still needs' : 's still need'} verification.`;
    }
    await this.refresh(); await this.discover();
  }
  async discover() {
    if (this.discovering) return;
    this.discovering = true; this.discoveryError = ''; this.publish();
    try { this.discovery = await this.call('workbench.repository_discover'); }
    catch (error) { this.discoveryError = error.message || 'Repository discovery is unavailable. Choose a folder to import.'; }
    finally { this.discovering = false; this.publish(); }
  }
  async chooseFolder(onSelected) {
    const result = await this.call('workbench.repository_pick', {}, { timeout: 125000 });
    if (!result.cancelled && result.path) onSelected(result.path);
  }
  async browseRepository() {
    let selected;
    await this.chooseFolder(path => { selected = path; });
    if (selected) this.showModal({ kind: 'repository', path: selected });
  }
  async archive(tasks, archived = true) {
    const result = await this.call('workbench.archive', { tasks: tasks.map(task => ({ taskId: task.id, expectedRevision: task.revision })), archived });
    this.detailEpoch++; this.selected = null;
    this.undoArchive = archived ? result.tasks : null;
    this.notice = `${result.tasks.length} task${result.tasks.length === 1 ? '' : 's'} ${archived ? 'archived' : 'restored to Done'}.`;
    await this.refresh();
    await this.context();
  }
  async launch(args) {
    this.undoArchive = null;
    if (!this.extensions.message) throw new Error('This Codex version cannot launch chats from the board. Update Codex, or use /workbench:start in a native project chat.');
    const result = await this.call('workbench.launch_prepare', args);
    if (!result.dispatch) { this.modal = null; this.notice = 'This task already has a pending or unconfirmed launch. Check the board chat before trying again.'; await this.refresh(); return; }
    const task = result.task || (await this.call('workbench.launch_get', { requestId: result.launch.id })).task;
    this.lastLaunch = { ...result.launch, title: task.title }; this.publish();
    try {
      await this.extensions.message.send({ role: 'user', content: [{ type: 'text', text: launchMessage(result.launch, task) }], _meta: { 'openai/message': { target: 'active', send: true } } });
    } catch (error) {
      await this.call('workbench.launch_uncertain', { requestId: result.launch.id });
      this.lastLaunch = { ...this.lastLaunch, state: 'uncertain' }; this.publish();
      throw new Error(`Launch delivery is unconfirmed. Check the board chat; Workbench Preview will not resend it automatically. ${error.message || ''}`);
    }
    this.modal = null; await this.refresh();
  }
  async refreshPr() {
    const id = this.selected.task.id;
    await this.call('workbench.pr_refresh', { taskId: id });
    await this.refresh();
  }
  async resolveLaunch(launch) {
    const result = await this.call('workbench.launch_resolve', { requestId: launch.id, expectedState: launch.state, expectedUpdatedAt: launch.updatedAt, confirmedNotDelivered: true });
    if (this.lastLaunch?.id === launch.id) this.lastLaunch = { ...this.lastLaunch, ...result.launch };
    this.modal = null;
    this.notice = 'Request released. Start or resume again when ready.';
    await this.refresh();
  }
  async openLink(url) { await this.app.openLink({ url }); }
  async context() {
    // This optional host hint cannot make a saved selection fail or stop local
    // refreshes when a host advertises the capability but cannot accept it.
    try {
      await this.extensions.modelContext?.update({ structuredContent: { page: this.selected ? 'task' : 'board', preview: true, ...(this.selected ? { taskId: this.selected.task.id, repository: this.selected.repository.path, stage: this.selected.task.stage, archived: Boolean(this.selected.task.archivedAt) } : { taskCount: this.board.tasks.filter(task => !task.archivedAt).length, archivedCount: this.board.tasks.filter(task => task.archivedAt).length }) } });
    } catch { /* The board and its authoritative saved state remain usable. */ }
  }
  hostContext(context) {
    if (context?.theme) { this.themeHelpers.applyDocumentTheme(context.theme); document.documentElement.dataset.theme = context.theme; }
    if (context?.styles?.variables) this.themeHelpers.applyHostStyleVariables(context.styles.variables);
    for (const edge of ['top', 'right', 'bottom', 'left']) document.documentElement.style.setProperty(`--safe-${edge}`, `${context?.safeAreaInsets?.[edge] || 0}px`);
    const route = context?.['openai/deepLink']?.url;
    const id = route?.match(/^\/tasks\/([a-f0-9-]{36})$/)?.[1];
    if (this.connected && id && id !== this.selected?.task.id) this.action(() => this.select(id));
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.disposed || !this.connected) return;
    this.timer = setTimeout(async () => {
      if (!document.hidden && !this.busy) { try { await this.refresh(); } catch (error) { this.error = error.message; this.publish(); } }
      this.schedule();
    }, 2000);
  }
  async connect() {
    if (!this.connected) await this.app.connect(); this.connected = true;
    this.hostContext(this.app.getHostContext());
    if (!this.hasBoard) await this.refresh();
    await this.discover();
    this.publish(); await this.context(); this.schedule();
  }
}
