import React, { useState } from 'react';
import { Button, Secondary, Quiet, Input, Checkbox, TextLink } from './ui.jsx';

const date = value => value ? new Date(value).toLocaleString() : 'Not checked';
const request = task => ({ taskId: task.id, expectedRevision: task.revision });
const open = (vm, url) => event => { event.preventDefault(); vm.action(() => vm.openLink(url), 'Opening evidence…'); };

function PublicationAttempt({ vm, task, attempt }) {
  const [reviewed, setReviewed] = useState(false);
  const args = { ...request(task), attemptId: attempt.id, threadId: task.threadId };
  return <div className="delivery-attempt">
    <p><strong>{attempt.state}</strong> · {attempt.branch} · {attempt.actions.join(' → ')}</p>
    <p>Completed: {attempt.completed.join(', ') || 'No confirmed steps'} · {date(attempt.updatedAt)}</p>
    {attempt.error && <p role="status">{attempt.error}</p>}
    {Object.entries(attempt.receipts || {}).map(([action, receipt]) => <p key={action}>{action}: {action === 'pr' ? <TextLink href={receipt.result.url} onClick={open(vm, receipt.result.url)}>Verified pull request</TextLink> : String(receipt.result).slice(0, 12)}</p>)}
    {['running', 'uncertain', 'blocked'].includes(attempt.state) && <Secondary disabled={vm.busy} onClick={() => vm.action(() => vm.delivery('workbench.publication_reconcile', args), 'Reconciling publication…')}>Reconcile publication</Secondary>}
    {['prepared', 'uncertain', 'blocked'].includes(attempt.state) && <>
      <Checkbox checked={reviewed} onCheckedChange={setReviewed} disabled={vm.busy} label="I reviewed this attempt and its Git/GitHub outcome"/>
      <Quiet disabled={vm.busy || !reviewed} onClick={() => vm.action(() => vm.delivery('workbench.publication_close', { ...args, confirmedReviewed: true }), 'Closing local attempt…')}>Close local attempt</Quiet>
    </>}
  </div>;
}

export function PublicationDetails({ vm, task }) {
  if (!task.publications?.length) return null;
  return <section className="task-evidence" aria-label="Publication recovery"><h4>Publication</h4>
    {[...task.publications].reverse().map(attempt => <PublicationAttempt key={attempt.id} vm={vm} task={task} attempt={attempt}/>)}
  </section>;
}

function RemoteBinding({ vm, task }) {
  const [runUrl, setRunUrl] = useState(''), [workflowPath, setWorkflowPath] = useState(''), [botId, setBotId] = useState(''), [prUrl, setPrUrl] = useState('');
  return <details><summary>Link an existing run</summary><form className="remote-binding" onSubmit={event => {
    event.preventDefault();
    vm.action(() => vm.delivery('workbench.remote_bind', { ...request(task), runUrl, workflowPath, botId: Number(botId), ...(prUrl ? { prUrl } : {}) }), 'Checking remote run…');
  }}>
    <label>GitHub Actions run URL<Input required type="url" value={runUrl} onChange={event => setRunUrl(event.target.value)} disabled={vm.busy}/></label>
    <label>Workflow path<Input required placeholder=".github/workflows/automation.yml" value={workflowPath} onChange={event => setWorkflowPath(event.target.value)} disabled={vm.busy}/></label>
    <label>Trusted GitHub bot ID<Input required type="number" min="1" step="1" value={botId} onChange={event => setBotId(event.target.value)} disabled={vm.busy}/></label>
    <label>Pull request URL, if the run does not identify it<Input type="url" value={prUrl} onChange={event => setPrUrl(event.target.value)} disabled={vm.busy}/></label>
    <Button type="submit" disabled={vm.busy}>Link run for observation</Button>
  </form></details>;
}

export function RemoteRunDetails({ vm, task }) {
  const remote = task.remoteRun, observation = remote?.observation;
  const aged = observation?.checkedAt && Date.now() - Date.parse(observation.checkedAt) > 24 * 60 * 60 * 1000;
  return <section className="task-evidence" aria-label="Remote run observation"><h4>Remote run</h4>
    <p className="dialog-copy">Read-only observations. Local verification and task progress remain separate.</p>
    {remote ? <>
      <dl className="task-facts"><dt>Last observation attempt</dt><dd>{date(remote.checkedAt)}</dd>
        {observation && <><dt>Run</dt><dd>{observation.status} · {observation.conclusion || 'No conclusion'}</dd><dt>Checkpoint</dt><dd>{observation.checkpointStatus}{observation.reason && ` · ${observation.reason}`}</dd><dt>Recorded stage</dt><dd>{observation.stage || 'Unverified'}</dd><dt>Implementation commit</dt><dd>{observation.implementationHead || 'Unverified'}</dd><dt>Observation saved</dt><dd>{date(observation.checkedAt)}</dd>{observation.automationRevision && <><dt>Automation revision</dt><dd>{observation.automationRevision}</dd></>}{observation.blocker && <><dt>Blocker</dt><dd>{observation.blocker}</dd></>}</>}
      </dl>
      {remote.error && <p role="status">{remote.error}</p>}
      {aged && <p role="status">This saved observation is over a day old. Check the run for current state.</p>}
      <div className="detail-actions"><Secondary disabled={vm.busy} onClick={() => vm.action(() => vm.delivery('workbench.remote_refresh', request(task)), 'Checking remote run…')}>Check remote run now</Secondary><Quiet disabled={vm.busy} onClick={() => vm.action(() => vm.delivery('workbench.remote_unbind', request(task)), 'Removing local run link…')}>Unlink run</Quiet></div>
      <div className="detail-actions">{[...new Set([remote.binding.url, ...(observation?.evidenceLinks || [])])].map((url, index) => <TextLink key={url} href={url} onClick={open(vm, url)}>{index === 0 ? 'Open workflow run' : index === 1 ? 'Open remote pull request' : 'Open checkpoint evidence'}</TextLink>)}</div>
    </> : <RemoteBinding vm={vm} task={task}/>}
  </section>;
}
