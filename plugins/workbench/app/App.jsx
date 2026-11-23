import React, { useRef, useState, useSyncExternalStore } from 'react';
import { Markdown } from '@openai/apps-sdk-ui/components/Markdown';
import { stages } from './controller.mjs';
import { attentionReason, cardNextAction, cardStatus, currentLaunches, displayTitle, evidenceLabel, launchStatus, repositoryLocation, taskAction, taskChatUrl, taskTicketUrl, taskLaunch, taskStatus } from './presentation.mjs';
import { Button, Secondary, Quiet, Input, Textarea, Menu, Checkbox, SegmentedControl, Badge, Icon, Dialog, Select, Tooltip, TextLink, Alert, EmptyMessage, LoadingIndicator, submitForm, enterSubmits } from './ui.jsx';
import { HowItWorks } from './HowItWorks.jsx';
import { PublicationDetails, RemoteRunDetails } from './DeliveryDetails.jsx';
import { unresolvedLaunchStates } from '../shared/launch-states.mjs';

const tone = status => ['blocked', 'failed', 'findings', 'uncertain'].includes(status) ? 'warning' : ['passed', 'complete'].includes(status) ? 'success' : 'secondary';
const date = value => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not checked';
const hasCandidates = vm => vm.discovery.repositories?.some(repository => repository.importableTaskCount > 0);

function ActionError({ vm }) {
  if (!vm.error) return null;
  return <Alert className="action-error" role="alert" color="warning" variant="soft" description={<><p>{vm.error}</p>{vm.errorDetails && <details><summary>Technical details</summary><pre>{vm.errorDetails}</pre></details>}</>}/>;
}

function BusyStatus({ vm }) {
  return vm.busy ? <p className="operation-status" role="status" aria-label="Operation progress"><LoadingIndicator/>{vm.busyLabel}</p> : null;
}

function StatusCheckError({ message }) {
  return message ? <Alert role="status" color="warning" variant="soft" description={message}/> : null;
}

function RepositoryTrigger({ label }) { return <><span className="sr-only">Repository: </span>{label}</>; }
function RepositorySelect({ repositories, value, onChange, includeAll = true, disabled }) {
  return <Select value={value} options={[
    ...(includeAll ? [{ value: '', label: 'All repositories' }] : []),
    ...repositories.map(repository => ({ value: repository.id, label: repository.name }))
  ]} onChange={option => onChange(option.value)} TriggerView={RepositoryTrigger} pill={false} size="lg" disabled={disabled}/>;
}

function TaskPrimaryAction({ vm, task, action, card = false }) {
  const run = () => {
    if (action.kind === 'request') return vm.showModal({ kind: 'recovery', launch: action.launch });
    if (action.kind === 'launch') return vm.showModal({ kind: 'launch', task });
    if (action.kind === 'archive') return vm.action(() => vm.archive([task], !task.archivedAt), task.archivedAt ? 'Restoring task…' : 'Archiving task…');
    if (action.kind === 'chat') return vm.action(() => vm.resume(task), 'Opening chat…');
    return vm.action(() => vm.recover(task), 'Preparing recovery request…');
  };
  const Control = card ? Secondary : Button;
  const button = <Control className={card ? 'card-action' : 'workbench-primary'} size={card ? 'sm' : 'md'} disabled={vm.busy} aria-label={card ? `${action.label} · ${displayTitle(task)}` : undefined}
    aria-describedby={!card && action.kind === 'recover' ? 'recovery-draft-help' : undefined} onClick={run}>{action.label}</Control>;
  return card && action.kind === 'recover' ? <Tooltip content="Opens a draft in the Workbench chat">{button}</Tooltip> : button;
}

function TaskCard({ vm, task, repository }) {
  const action = taskAction(task, vm.board.launches);
  const reason = attentionReason(task);
  const title = displayTitle(task);
  const status = cardStatus(task);
  const next = status === 'CI failed' ? cardNextAction(task).replace(/^CI failed\. /, '') : cardNextAction(task);
  const ticket = /^[A-Z][A-Z0-9]+-\d+$/i.test(task.key) ? task.key : '';
  return <article className="task-card" data-status={task.status} data-attention={Boolean(reason)}>
    <button className="card-main" aria-label={`Open ${title}`} disabled={vm.busy} onClick={() => vm.action(() => vm.select(task.id), 'Opening task…')}>
      <div className="card-heading"><h3>{title}</h3></div>
      <div className="card-context">
        <div className="card-meta">{ticket && ticket !== title && <span className="task-key">{ticket}</span>}<span className="repository-name">{repository?.name || 'Repository unavailable'}</span></div>
        <Badge className="card-status" size="sm" color={reason ? 'warning' : tone(task.status)}>{status}</Badge>
      </div>
      {next && <p className={`card-next ${reason ? 'needs-attention' : ''}`}>{next}</p>}
    </button>
    <footer className="card-actions">
      <TaskPrimaryAction vm={vm} task={task} action={action} card/>
      {action.kind !== 'chat' && task.stage !== 'done' && taskChatUrl(task) && <Tooltip content="Open chat">
        <Quiet size="md" uniform disabled={vm.busy} aria-label={`Open chat · ${title}`} onClick={() => vm.action(() => vm.resume(task), 'Opening chat…')}><Icon name="chat"/></Quiet>
      </Tooltip>}
    </footer>
  </article>;
}

function ChatRequests({ vm }) {
  const requests = currentLaunches(vm.board.tasks, vm.board.launches);
  const latest = requests.find(request => request.id === vm.lastLaunch?.id) || requests[0];
  if (!latest) return null;
  const task = vm.board.tasks.find(task => task.id === latest.taskId);
  const description = latest.error || (latest.state === 'accepted' ? 'The worker confirmed this task in its chat.' : latest.state === 'sent' ? 'The request was delivered. Waiting for the worker to confirm the task.' : latest.state === 'prepared' ? 'Review the draft in the Codex composer and press Send to start.' : 'Check the board chat before retrying. Unconfirmed requests are never resent automatically.');
  const earlier = requests.filter(request => request.id !== latest.id);
  return <section className="launch-status" aria-label="Chat handoff">
    <div className="launch-notice">
      <div role="status" className="launch-notice-copy">
        <p className="launch-notice-state" data-state={latest.state}>{launchStatus[latest.state]}</p>
        {task && <p className="launch-notice-title">{displayTitle(task)}</p>}
        <p>{description}</p>
      </div>
      <div className="launch-request-actions">
        {task && <Secondary size="sm" disabled={vm.busy} onClick={() => vm.action(() => vm.select(latest.taskId), 'Opening task…')}>View task</Secondary>}
        {taskChatUrl(task || {}) && <Quiet size="sm" disabled={vm.busy} onClick={() => vm.action(() => vm.resume(task), 'Opening chat…')}>Open saved worker chat</Quiet>}
        {unresolvedLaunchStates.includes(latest.state) && <Quiet size="sm" disabled={vm.busy} onClick={() => vm.showModal({ kind: 'recovery', launch: latest })}>Release request</Quiet>}
      </div>
    </div>
    {earlier.length > 0 && <details><summary>{earlier.length} earlier chat request{earlier.length === 1 ? '' : 's'}</summary>{earlier.map(launch => <div className="launch-row" key={launch.id}><Quiet size="sm" onClick={() => vm.action(() => vm.select(launch.taskId), 'Opening task…')}>{vm.board.tasks.find(task => task.id === launch.taskId)?.title || 'View task'}</Quiet><Badge color={tone(launch.state)}>{launchStatus[launch.state]}</Badge>{launch.error && <span>{launch.error}</span>}</div>)}</details>}
  </section>;
}

function DeliveryBoard({ vm, tasks, repositories, filterKey, hideDone }) {
  const [selection, setSelection] = useState(null);
  const groups = stages.filter(([key]) => key !== 'done' || !hideDone).map(([key, label]) => {
    const cards = tasks.filter(task => task.stage === key);
    return { key, label, cards, blocked: cards.filter(task => task.status === 'blocked').length };
  });
  const active = selection?.filterKey === filterKey ? selection.stage : 'all';
  return <div className="delivery-board">
    <nav className="stage-navigation" aria-label="Filter by delivery stage">
      <Quiet size="md" pill={false} aria-pressed={active === 'all'} onClick={() => setSelection(null)}>All stages</Quiet>
      {groups.map(({ key, label, cards, blocked }) => <Quiet key={key} size="md" pill={false} aria-pressed={active === key} onClick={() => setSelection({ filterKey, stage: key })}>
        {label}
        {(!blocked || blocked !== cards.length) && <span className="column-count">{cards.length}<span className="sr-only"> tasks</span></span>}
        {blocked > 0 && <Badge size="sm" color="warning">{blocked} blocked</Badge>}
      </Quiet>)}
    </nav>
    <div className="board-scroll" role="region" aria-label="Delivery stages"><div className="board"
      style={{ '--stage-tracks': groups.map(group => group.cards.length ? 'minmax(0, 1fr)' : '5.75rem').join(' ') }}>
      {groups.map(({ key, label, cards, blocked }) => (
        <section className="column" data-stage={key} data-empty={cards.length === 0} data-active={active === key || (active === 'all' && cards.length > 0)} key={key} aria-label={`${label}, ${cards.length} tasks`}>
          <header className="column-header">
            <div><h2>{label}</h2>{(!blocked || blocked !== cards.length) && <span className="column-count">{cards.length}</span>}{blocked > 0 && <Badge size="sm" color="warning">{blocked} blocked</Badge>}</div>
            {key === 'done' && cards.length > 0 && <Quiet size="sm" disabled={vm.busy} aria-label={`Archive ${cards.length} done task${cards.length === 1 ? '' : 's'}`} onClick={() => vm.action(() => vm.archive(cards), 'Archiving completed tasks…')}>Archive all</Quiet>}
          </header>
          <div className="column-cards">
            {cards.map(task => <TaskCard key={task.id} vm={vm} task={task} repository={repositories.find(repository => repository.id === task.repositoryId)}/>)}
            {!cards.length && <p className="empty-stage">No tasks in {label}.</p>}
          </div>
        </section>
      ))}
    </div></div>
  </div>;
}

function EmptyResults({ archived, filtering, archivedCount, clear, showArchive, start, hiddenDone, showDone }) {
  const title = hiddenDone ? 'No active tasks' : filtering ? 'No matching tasks' : archived ? 'No archived tasks' : archivedCount ? 'All caught up.' : 'Ready for your next task.';
  const copy = filtering ? 'Try another search or clear your filters.' : archived ? 'Archive completed tasks to keep the board focused. You can restore them here.' : archivedCount ? 'Your completed work is saved in Archive.' : '';
  return <section className="empty-results"><EmptyMessage><EmptyMessage.Icon><Icon name={filtering ? 'search' : archived || archivedCount ? 'archive' : 'board'}/></EmptyMessage.Icon><EmptyMessage.Title><h2>{title}</h2></EmptyMessage.Title>{copy && !hiddenDone && <EmptyMessage.Description>{copy}</EmptyMessage.Description>}<EmptyMessage.ActionRow>{hiddenDone ? <Secondary onClick={showDone}>Show completed tasks</Secondary> : filtering ? <Secondary onClick={clear}>Clear filters</Secondary> : archivedCount && !archived ? <Secondary onClick={showArchive}>View archive</Secondary> : !archived && <Button onClick={start}>New task</Button>}</EmptyMessage.ActionRow></EmptyMessage></section>;
}

function BoardToolbar({ vm, view, setView, archivedCount, repositoryId, setRepositoryId, query, setQuery, setAttention, filtering, clear }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterCount = Number(Boolean(repositoryId)) + Number(Boolean(query));
  return <section className="toolbar" aria-label="Board filters">
    <SegmentedControl aria-label="Task views" value={view} onChange={value => { setView(value); if (value === 'archive') setAttention(false); }} size="lg" pill={false}>
      <SegmentedControl.Option value="board">Board</SegmentedControl.Option><SegmentedControl.Option value="archive">Archive <span className="view-count">{archivedCount}</span></SegmentedControl.Option>
    </SegmentedControl>
    <Quiet className="filter-toggle" size="lg" pill={false} aria-expanded={filtersOpen} aria-controls="board-filter-fields" onClick={() => setFiltersOpen(!filtersOpen)}><Icon name="filters"/>Filters{filterCount > 0 && <Badge size="sm">{filterCount}<span className="sr-only"> active</span></Badge>}</Quiet>
    <div className="filters" id="board-filter-fields" data-open={filtersOpen}><div className="repository-filter"><RepositorySelect repositories={vm.board.repositories} value={repositoryId} onChange={setRepositoryId}/></div><Input className="task-search" size="lg" pill={false} aria-label="Search tasks" placeholder="Find a task…" value={query} onChange={event => setQuery(event.target.value)} startAdornment={<Icon name="search"/>} endAdornment={query ? <Quiet uniform size="sm" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close"/></Quiet> : undefined}/>{filtering && <Quiet size="sm" onClick={clear}>Clear filters</Quiet>}</div>
    <div className="toolbar-actions">
      {vm.board.reconciliation?.available && <Tooltip content="Linked PRs are checked every five minutes while this board is open. Jira and chat evidence need a connected check.">
        <Quiet size="lg" pill={false} disabled={vm.busy || vm.statusChecking} loading={vm.statusChecking} onClick={() => vm.action(() => vm.reconcile(true), 'Checking delivery status…')}><Icon name="status"/>Check delivery status</Quiet>
      </Tooltip>}
      <Menu>
        <Menu.Trigger><Quiet uniform size="lg" pill={false} aria-label="Board options" loading={vm.busy && vm.busyLabel === 'Reloading saved board…'} disabled={vm.busy}><Icon name="more"/></Quiet></Menu.Trigger>
        <Menu.Content align="end"><Menu.Item onSelect={() => vm.action(() => vm.refresh(), 'Reloading saved board…')}>Reload saved board</Menu.Item></Menu.Content>
      </Menu>
    </div>
  </section>;
}

function AttentionFilter({ count, active, onChange }) {
  return <Quiet className="attention-filter" size="md" pill={false} aria-pressed={active} disabled={!count && !active} onClick={() => onChange(!active)}>Needs attention <Badge size="sm" color={count ? 'warning' : 'secondary'}>{count}</Badge></Quiet>;
}

function BoardContent({ vm, archived, archivedCount, filtered, filtering, clear, showArchive, start, filterKey, hideDone, hiddenDone, showDone }) {
  if (!vm.hasBoard) return <section className="connecting" aria-label="Connecting to Workbench">{vm.error ? <><ActionError vm={vm}/><Secondary disabled={vm.busy} onClick={() => vm.action(() => vm.connect(), 'Reconnecting…')}>Try again</Secondary></> : <p role="status"><LoadingIndicator/>Loading your saved work…</p>}</section>;
  return <>
    {vm.error && !vm.modal && !vm.selected && <ActionError vm={vm}/>}
    {vm.notice && <Alert className="notice-banner" role="status" aria-label="Board update" color="info" variant="soft" description={vm.notice} actions={vm.undoArchive ? <Quiet size="sm" disabled={vm.busy} onClick={() => vm.action(() => vm.archive(vm.undoArchive, false), 'Restoring tasks…')}>Undo</Quiet> : undefined}/>}
    {!vm.modal && !vm.selected && <BusyStatus vm={vm}/>}
    {!archived && <ChatRequests vm={vm}/>}
    {!vm.board.repositories.length ? <RepositoryEntry vm={vm}/> :
      !filtered.length ? <EmptyResults {...{ archived, filtering, archivedCount, clear, showArchive, start, hiddenDone, showDone }}/> : archived ? <div className="archive-grid" role="region" aria-label="Archived tasks">{filtered.map(task => <TaskCard key={task.id} vm={vm} task={task} repository={vm.board.repositories.find(repository => repository.id === task.repositoryId)}/>)}</div> : <DeliveryBoard vm={vm} tasks={filtered} repositories={vm.board.repositories} filterKey={filterKey} hideDone={hideDone}/>}
  </>;
}

function AppHeader({ vm, start, hasRepositories }) {
  const more = useRef(null);
  const open = kind => vm.showModal({ kind, returnFocus: more.current });
  return <header className="product-bar"><div className="product-bar-inner app-header"><div className="brand"><span className="brand-mark"><Icon name="board"/></span><h1>Workbench</h1><Quiet className="version-info" size="sm" aria-label={`About Workbench ${__WORKBENCH_VERSION__}`} onClick={() => vm.showModal({ kind: 'help' })}><Badge variant="outline">v{__WORKBENCH_VERSION__}</Badge></Quiet></div>
    <div className="header-actions"><Quiet className="header-secondary" onClick={() => vm.showModal({ kind: 'help' })}>How it works</Quiet><Quiet className="header-secondary" onClick={() => vm.showModal({ kind: 'repository' })}>Add repository</Quiet><Button className="workbench-primary" disabled={vm.busy || !hasRepositories} onClick={start}><Icon name="plus"/>New task</Button>
      <div className="header-more"><Menu><Menu.Trigger><Quiet ref={more} uniform aria-label="More options"><Icon name="more"/></Quiet></Menu.Trigger><Menu.Content align="end" minWidth={200}><Menu.Item onSelect={() => open('help')}>How it works</Menu.Item><Menu.Item onSelect={() => open('repository')}>Add repository</Menu.Item></Menu.Content></Menu></div>
    </div>
  </div></header>;
}

export function AppView({ vm }) {
  useSyncExternalStore(vm.subscribe, vm.snapshot, vm.snapshot);
  const [repositoryId, setRepositoryId] = useState(''), [query, setQuery] = useState('');
  const [view, setView] = useState('board'), [attention, setAttention] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const { repositories, tasks } = vm.board;
  const archived = view === 'archive', archivedCount = tasks.filter(task => task.archivedAt).length;
  const base = tasks.filter(task => Boolean(task.archivedAt) === archived && (!repositoryId || task.repositoryId === repositoryId) && `${task.title} ${task.key} ${task.branch || ''}`.toLowerCase().includes(query.toLowerCase()));
  const attentionCount = base.filter(task => attentionReason(task)).length;
  const canHideDone = !archived && tasks.some(task => task.stage === 'done' && !task.archivedAt);
  const filtered = archived ? base : base.filter(task => (!attention || attentionReason(task)) && (!hideDone || task.stage !== 'done'));
  const hiddenDone = !archived && hideDone && !attention && base.some(task => task.stage === 'done');
  const filtering = Boolean(repositoryId || query || attention && !archived);
  const clear = () => { setRepositoryId(''); setQuery(''); setAttention(false); };
  const start = () => vm.showModal({ kind: 'launch' });
  return <>
    <AppHeader vm={vm} start={start} hasRepositories={repositories.length > 0}/>
    <main className="main-content">
      {repositories.length > 0 && <div className="results-heading">
        <h2>{archived ? 'Archived tasks' : 'Delivery board'}</h2>
        <span className="results-count">{filtered.length} task{filtered.length === 1 ? '' : 's'}</span>
        {!archived && <div className="board-view-actions">
          {(canHideDone || hideDone) && <Quiet size="sm" onClick={() => setHideDone(!hideDone)}>{hideDone ? 'Show Done' : 'Hide Done'}</Quiet>}
          <AttentionFilter count={attentionCount} active={attention} onChange={setAttention}/>
        </div>}
      </div>}
      {vm.hasBoard && <BoardToolbar {...{ vm, view, setView, archivedCount, repositoryId, setRepositoryId, query, setQuery, setAttention, filtering: filtering && filtered.length > 0, clear }}/>}
      <StatusCheckError message={vm.statusError}/>
      <BoardContent {...{ vm, archived, archivedCount, filtered, filtering, clear, start, hideDone, hiddenDone }} showDone={() => setHideDone(false)} showArchive={() => setView('archive')} filterKey={`${repositoryId}|${query}|${attention}|${hideDone}`}/>
    </main>
    {vm.selected && !vm.modal && <TaskDetail vm={vm} selected={vm.selected}/>}
    {vm.modal?.kind === 'repository' && <RepositoryForm vm={vm}/>}
    {vm.modal?.kind === 'launch' && <LaunchForm key={vm.modal.task?.id || 'new'} vm={vm} task={vm.modal.task} initialRepositoryId={repositoryId}/>}
    {vm.modal?.kind === 'recovery' && <LaunchRecovery key={vm.modal.launch.id} vm={vm} launch={vm.modal.launch}/>}
    {vm.modal?.kind === 'help' && <HowItWorks vm={vm}/>}
  </>;
}

function DiscoverySuggestions({ vm, showEmpty = false }) {
  const candidates = (vm.discovery.repositories || []).filter(repository => repository.importableTaskCount > 0);
  if (!candidates.length && !vm.discovering && !vm.discoveryError && !showEmpty) return null;
  return <section className="discovery-panel" aria-label="Detected Workbench repositories">
    <div className="discovery-heading"><h3>Existing Workbench tasks</h3><Quiet size="sm" disabled={vm.discovering || vm.busy} onClick={() => vm.discover()}>Scan again</Quiet></div>
    {vm.discovering && <p className="operation-status" role="status"><LoadingIndicator/>Looking in your configured repositories…</p>}
    {vm.discoveryError && <Alert color="warning" variant="soft" description={vm.discoveryError}/>}
    {!vm.discovering && !vm.discoveryError && !candidates.length && showEmpty && <p className="discovery-message">No new notes found. Choose a repository folder.</p>}
    <div className="discovery-list">{candidates.map(repository => <div className="discovery-item" key={repository.id}>
      <div><strong>{repository.name}</strong><span>{repositoryLocation(repository.path)}</span><details className="repository-path-details"><summary aria-label={`Show full path for ${repository.name}`}>Full path</summary><code>{repository.path}</code></details></div>
      <Button size="md" disabled={vm.busy} aria-label={`Import ${repository.importableTaskCount} ${repository.importableTaskCount === 1 ? 'task' : 'tasks'} from ${repository.name}`} onClick={() => vm.action(() => vm.addRepository(repository.path, true), 'Importing repository…')}>Import {repository.importableTaskCount} {repository.importableTaskCount === 1 ? 'task' : 'tasks'}</Button>
    </div>)}</div>
  </section>;
}

function RepositoryEntry({ vm }) {
  const FolderButton = hasCandidates(vm) ? Secondary : Button;
  return <section className="empty-board"><EmptyMessage><EmptyMessage.Icon><Icon name="folder" width="24" height="24"/></EmptyMessage.Icon><EmptyMessage.Title><h2>Bring your work here.</h2></EmptyMessage.Title><EmptyMessage.Description>Import saved tasks or choose a repository. Original notes stay read-only.</EmptyMessage.Description></EmptyMessage>
    <DiscoverySuggestions vm={vm}/>
    <FolderButton disabled={vm.busy || vm.discovery.pickerAvailable === false} onClick={() => vm.action(() => vm.browseRepository(), 'Waiting for folder selection…')}>Choose folder…</FolderButton>
    <Quiet size="sm" onClick={() => vm.showModal({ kind: 'repository', manual: true })}>Enter a path manually</Quiet>
  </section>;
}

function RepositoryForm({ vm }) {
  const [path, setPath] = useState(vm.modal.path || ''), [importExisting, setImportExisting] = useState(true);
  const save = () => { if (path.trim()) return vm.action(() => vm.addRepository(path, importExisting), 'Importing repository…'); };
  const choose = () => vm.action(() => vm.chooseFolder(setPath), 'Waiting for folder selection…');
  const FolderButton = !path && !hasCandidates(vm) ? Button : Secondary;
  return <Dialog title="Add repository" close={() => vm.closeModal()} busy={vm.busy} returnFocus={vm.modal.returnFocus}>
    {!path && <DiscoverySuggestions vm={vm} showEmpty/>}
    <form onSubmit={event => submitForm(event, save)} onKeyDown={event => enterSubmits(event, save)}>
      <div className="folder-picker"><FolderButton disabled={vm.busy || vm.discovery.pickerAvailable === false} onClick={choose}>{path ? 'Choose another folder…' : 'Choose folder…'}</FolderButton>
        {path && <div className="selected-folder"><span>Selected folder</span><output aria-live="polite">{path}</output></div>}
      </div>
      <details className="manual-path" open={vm.modal.manual || undefined}><summary>Enter a path manually</summary><label htmlFor="repository-path" className="field-label">Repository path</label><Input id="repository-path" value={path} placeholder="/Users/you/projects/my-app" onChange={event => setPath(event.target.value)} disabled={vm.busy}/></details>
      {path && <div className="checkbox-field"><Checkbox id="import-existing" checked={importExisting} onCheckedChange={setImportExisting} label="Import existing tasks (read-only)" disabled={vm.busy}/></div>}
      <ActionError vm={vm}/><BusyStatus vm={vm}/>
      <div className="dialog-actions"><Quiet onClick={() => vm.closeModal()} disabled={vm.busy}>Cancel</Quiet>{path.trim() && <Button onClick={event => submitForm(event, save)} loading={vm.busy} disabled={vm.busy}>Add repository</Button>}</div>
    </form>
  </Dialog>;
}

function LaunchForm({ vm, task, initialRepositoryId }) {
  const [title, setTitle] = useState(''), [repositoryId, setRepositoryId] = useState(initialRepositoryId || vm.board.repositories[0]?.id || '');
  const [environment, setEnvironment] = useState('local'), [autopilot, setAutopilot] = useState(false);
  const continuation = Boolean(task?.threadId);
  const { title: modalTitle, description } = taskLaunch(task, continuation);
  const submit = () => vm.action(() => vm.launch({ ...(task ? { taskId: task.id } : { repositoryId, title }), environment, autopilot, continuation }), 'Preparing chat request…');
  return <Dialog title={modalTitle} close={() => vm.closeModal()} busy={vm.busy}>
    <form className="launch-form" onSubmit={event => submitForm(event, submit)} onKeyDown={event => enterSubmits(event, submit)}>
      {task ? <div className="resume-task"><span className="task-key">{task.key}</span><h3>{displayTitle(task)}</h3><p className="dialog-copy">{description}</p></div> : <>
        <label className="field-label" htmlFor="task-description">Ticket or desired outcome</label><Textarea id="task-description" size="lg" rows={2} maxRows={8} autoResize required maxLength={2000} value={title} onChange={event => setTitle(event.target.value)} placeholder="A ticket, link, or what you want to build" disabled={vm.busy}/>
        <p className="field-label">Repository</p><RepositorySelect includeAll={false} repositories={vm.board.repositories} value={repositoryId} onChange={setRepositoryId} disabled={vm.busy}/>
      </>}
      <p className="field-label">Run in</p><SegmentedControl aria-label="Native Codex environment" pill={false} value={environment} onChange={setEnvironment} disabled={vm.busy}><SegmentedControl.Option value="local">Local</SegmentedControl.Option><SegmentedControl.Option value="worktree">Worktree</SegmentedControl.Option></SegmentedControl>
      <p className="dialog-copy launch-environment-help">Choose the same repository and run mode in Codex when the draft opens.</p>
      <div className="autopilot-field"><Checkbox id="autopilot" checked={autopilot} onCheckedChange={setAutopilot} label="Autopilot" disabled={vm.busy}/><p>{autopilot ? 'Includes commits, ordinary pushes, a draft PR and addressed review replies during this run. Stops when waiting for CI or review. Never merges.' : 'Continue the next Workbench stage. Commits, pushes, PR publication and review replies require separate authorization.'}</p></div>
      {!vm.extensions.message && <Alert color="warning" variant="soft" description="This host does not support launching chats from the board. Use /workbench:start in a native project chat."/>}
      <ActionError vm={vm}/><BusyStatus vm={vm}/>
      <div className="launch-footer">
        {vm.extensions.message && <p className="dialog-copy launch-send-help" id="launch-send-help">Review and press Send in Codex to start.</p>}
        <div className="dialog-actions">
          <Quiet pill={false} onClick={() => vm.closeModal()} disabled={vm.busy}>Cancel</Quiet>
          <Button className="workbench-primary" aria-describedby={vm.extensions.message ? 'launch-send-help' : undefined} loading={vm.busy} disabled={vm.busy || !vm.extensions.message} onClick={event => submitForm(event, submit)}>Open chat draft</Button>
        </div>
      </div>
    </form>
  </Dialog>;
}

function LaunchRecovery({ vm, launch }) {
  const [confirmed, setConfirmed] = useState(false);
  return <Dialog title="Release chat request" close={() => vm.closeModal()} busy={vm.busy}>
    <p className="dialog-copy">Check your Codex chats and the chat composer before continuing. Remove any unsent draft for this request before releasing it. Releasing does not cancel a chat that has already started, and it will not send another request.</p>
    <p>Saved status: {launchStatus[launch.state]}</p>
    <Checkbox id="confirm-not-delivered" checked={confirmed} onCheckedChange={setConfirmed} disabled={vm.busy} label="I checked that this request was not delivered"/>
    <ActionError vm={vm}/><BusyStatus vm={vm}/>
    <div className="dialog-actions"><Quiet disabled={vm.busy} onClick={() => vm.closeModal()}>Cancel</Quiet><Button disabled={!confirmed || vm.busy} loading={vm.busy} onClick={() => vm.action(() => vm.resolveLaunch(launch), 'Releasing request…')}>Release request</Button></div>
  </Dialog>;
}

function TaskEvidence({ task }) {
  return <section className="task-evidence" aria-label="Verification and review"><h4>Evidence</h4><dl className="task-facts"><dt>Updated</dt><dd>{date(task.updatedAt)}</dd><dt>Verification</dt><dd>{evidenceLabel(task, 'verify')}</dd><dt>Code review</dt><dd>{evidenceLabel(task, 'review')}</dd>
    {['verify', 'review'].map(kind => task.evidenceChecks?.[kind]?.checkedAt && <React.Fragment key={kind}><dt>{kind === 'verify' ? 'Verification checked' : 'Review checked'}</dt><dd>{date(task.evidenceChecks[kind].checkedAt)}</dd></React.Fragment>)}
    {task.pr && <><dt>PR snapshot</dt><dd>{date(task.pr.checkedAt)} · {task.pr.state.toLowerCase()}</dd><dt>{task.stage === 'done' ? 'Historical observed CI' : 'Observed CI'}</dt><dd>{task.pr.checks} · {task.pr.checkCount} reported checks</dd><dt>Required CI</dt><dd>{task.pr.requiredCi?.status === 'none' ? 'No requirements' : task.pr.requiredCi?.status || 'unknown'}{task.pr.requiredCi?.reason && ` · ${task.pr.requiredCi.reason}`}</dd><dt>Mergeability</dt><dd>{task.pr.mergeable?.toLowerCase() || 'unknown'}</dd><dt>Human review</dt><dd>{task.pr.reviewDecision.toLowerCase().replaceAll('_', ' ')}</dd></>}
    {task.archivedAt && <><dt>Archived</dt><dd>{date(task.archivedAt)}</dd></>}
  </dl></section>;
}

function TaskReconciliation({ vm, task, link }) {
  if (!vm.board.reconciliation?.available && !task.reconciliation && !task.completion) return null;
  const check = task.reconciliation;
  return <section className="task-evidence" aria-label="Delivery status">
  <header className="evidence-heading"><h4>Delivery status</h4>{vm.board.reconciliation?.available && <Quiet size="sm" pill={false} disabled={vm.busy || vm.statusChecking} onClick={() => vm.action(() => vm.reconcile(true, task.id), 'Checking delivery status…')}>Check status now</Quiet>}</header>
  <dl className="task-facts">
    <dt>Last checked</dt><dd>{date(check?.checkedAt)}</dd>
    {check?.reason && <><dt>Result</dt><dd>{check.reason}</dd></>}
    {task.completion?.artifactUrl && <><dt>Completed artifact</dt><dd><TextLink href={task.completion.artifactUrl} onClick={link(task.completion.artifactUrl)}>Open verified result</TextLink></dd></>}
  </dl>
    {check?.history?.length > 0 && <details><summary>Status history</summary><ul>{[...check.history].reverse().map(item => <li key={`${item.checkedAt}:${item.outcome}:${item.reason}`}>{date(item.checkedAt)} · {item.reason}</li>)}</ul></details>}
  </section>;
}

function TechnicalDetails({ task, repository }) {
  return <details className="task-technical"><summary>Technical details</summary><dl className="task-facts"><dt>Repository path</dt><dd>{repository.path}</dd>{task.branch && <><dt>Branch</dt><dd>{task.branch}</dd></>}</dl></details>;
}

function TaskDetail({ vm, selected }) {
  const { task, repository, note, noteIsLegacy, launches } = selected;
  const action = taskAction(task, vm.board.launches);
  const currentRequestIds = new Set(currentLaunches([task], launches).map(launch => launch.id));
  const next = cardNextAction(task);
  const canStartNewChat = task.threadId && task.stage !== 'done';
  const stage = stages.find(([key]) => key === task.stage)?.[1] || 'Unverified';
  const link = url => event => { event.preventDefault(); vm.action(() => vm.openLink(url), 'Opening link…'); };
  return <Dialog title="Task details" close={() => vm.closeDetail()} busy={vm.busy} wide>
    <div className="detail-title"><h3>{displayTitle(task)}</h3><div className="detail-badges"><div className="card-meta"><span className="task-key">{task.key}</span><span className="repository-name">{repository.name}</span></div><Badge>{task.archivedAt ? 'Archived' : stage}</Badge><Badge color={tone(task.status)}>{taskStatus(task)}</Badge></div></div>
    {task.summary && <p className="dialog-copy">{task.summary}</p>}
    {task.stage === 'done' ? <p className="merge-confirmed">{task.completion?.kind === 'artifact' ? 'Accepted scope and artifact verification recorded.' : `Merged ${date(task.pr?.mergedAt)}.`} Checks below are a historical snapshot.</p> : next && next !== task.summary && <section className="next-action" data-blocked={task.status === 'blocked'}><h4>Next action</h4><p>{next}</p></section>}
    <div className="detail-actions">
      <TaskPrimaryAction vm={vm} task={task} action={action}/>
      {action.kind !== 'chat' && task.stage !== 'done' && taskChatUrl(task) && <Secondary pill={false} disabled={vm.busy} onClick={() => vm.action(() => vm.resume(task), 'Opening chat…')}>Open chat</Secondary>}
      {canStartNewChat && <Menu>
        <Menu.Trigger><Quiet uniform aria-label="Task options" disabled={vm.busy}><Icon name="more"/></Quiet></Menu.Trigger>
        <Menu.Content align="start"><Menu.Item onSelect={() => vm.showModal({ kind: 'launch', task })}>Start new chat</Menu.Item></Menu.Content>
      </Menu>}
      {task.stage === 'done' && taskChatUrl(task) && <TextLink href={taskChatUrl(task)} onClick={link(taskChatUrl(task))}>Open chat</TextLink>}
      {taskTicketUrl(task) && <TextLink href={taskTicketUrl(task)} onClick={link(taskTicketUrl(task))}>Open ticket</TextLink>}
      {task.threadId && task.requirements && task.stage !== 'done' && <Secondary disabled={vm.busy} onClick={() => vm.action(() => vm.refreshEvidence(), 'Checking evidence freshness…')}>Recheck evidence</Secondary>}
      {task.prUrl && <><Secondary disabled={vm.busy} loading={vm.busy && vm.busyLabel === 'Checking pull request…'} onClick={() => vm.action(() => vm.refreshPr(), 'Checking pull request…')}>Check PR now</Secondary><TextLink href={task.prUrl} onClick={link(task.prUrl)}>Open pull request</TextLink></>}
    </div>
    {action.kind === 'recover' && <p className="dialog-copy recovery-draft-help" id="recovery-draft-help">Review and press Send in the Workbench chat to run the check.</p>}
    <BusyStatus vm={vm}/>
    {launches.filter(launch => unresolvedLaunchStates.includes(launch.state) || launch.state === 'failed').map(launch => <Alert className="request-errors" color={currentRequestIds.has(launch.id) ? 'warning' : 'info'} variant="soft" key={launch.id} title={`${currentRequestIds.has(launch.id) ? '' : 'Historical · '}${launchStatus[launch.state]}`} description={launch.error || 'Check the board chat before retrying.'} actions={unresolvedLaunchStates.includes(launch.state) ? <Quiet disabled={vm.busy} onClick={() => vm.showModal({ kind: 'recovery', launch })}>Release request</Quiet> : undefined}/>)}
    <TaskReconciliation vm={vm} task={task} link={link}/>
    <TaskEvidence task={task}/>
    <PublicationDetails vm={vm} task={task}/>
    <RemoteRunDetails key={task.id} vm={vm} task={task}/>
    <section className="task-note"><header><h4>Task note</h4>{noteIsLegacy && note && <Badge>Original · read-only</Badge>}</header>
      {note ? <Markdown includeMath={false} skipHtml components={{ a: ({ href, children }) => /^https?:\/\//.test(href || '') ? <TextLink href={href} onClick={link(href)}>{children}</TextLink> : <span>{children}</span>, img: ({ alt }) => <span>{alt || 'Image reference'}</span> }}>{note}</Markdown> : <p className="dialog-copy">No saved note yet. Scope and evidence will appear here when work starts.</p>}
    </section><TechnicalDetails task={task} repository={repository}/><ActionError vm={vm}/>
  </Dialog>;
}
