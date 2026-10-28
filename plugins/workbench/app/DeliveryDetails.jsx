import React, { useState } from 'react';
import { Secondary, Quiet, Checkbox, TextLink } from './ui.jsx';

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
