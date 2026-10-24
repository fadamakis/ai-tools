import React from 'react';
import { Dialog, TextLink, Alert, LoadingIndicator } from './ui.jsx';

const guideUrl = 'https://github.com/fadamakis/ai-tools/tree/main/plugins/workbench';
const workflow = [
  ['Backlog', 'Tasks waiting to start or imported without verified evidence. Preparation checks the checkout, branch and local setup.'],
  ['Plan', 'Read the ticket, designs and existing code. Agree on a small change and how to verify it.'],
  ['Build', 'Implement the change and simplify the code.'],
  ['Verify', 'Run relevant checks and inspect the real UI when available. Missing or blocked checks stay explicit.'],
  ['Review', 'Get an independent review when supported, address confirmed findings and rerun affected checks.'],
  ['PR', 'Publish a draft PR when authorized, then address CI failures, comments and conflicts.'],
  ['Done', 'A linked pull request has been verified as merged.'],
];

export function HowItWorks({ vm }) {
  const openGuide = event => { event.preventDefault(); vm.action(() => vm.openLink(guideUrl), 'Opening guide…'); };
  return <Dialog title="How it works" close={() => vm.closeModal()} busy={vm.busy} returnFocus={vm.modal?.returnFocus} wide>
    <article className="how-it-works">
      <div className="help-intro"><p>See what a ticket needs next and continue in the right Workbench chat.</p><TextLink href={guideUrl} onClick={openGuide}>Read the Workbench guide</TextLink></div>
      <section><h3>Start or resume</h3><ol>
        <li><strong>Add your repository.</strong> Import detected Workbench notes or choose a folder. Importing reads existing notes without changing them.</li>
        <li><strong>Choose New task.</strong> Enter a ticket, link or desired outcome. Choose a native Local or Worktree chat in a saved Codex project. Autopilot is off by default.</li>
        <li><strong>Continue from a card.</strong> Choose Resume or Start task, then confirm the chat and mode. The original chat keeps its environment; a new continuation chat is an explicit choice. Open the card for notes and evidence.</li>
      </ol><p>Workbench checks current state and picks up the next unfinished stage. You can also start from a project chat:</p><code className="help-command">/workbench:start TASK-123</code></section>
      <section><h3>Follow the stages</h3><dl className="help-stages">{workflow.map(([stage, description]) => <div key={stage}><dt>{stage}</dt><dd>{description}</dd></div>)}</dl></section>
      <section><h3>Choose how much to delegate</h3><p><strong>Normal mode</strong> follows your requested scope: a plan, a review or implementation. Starting a task does not authorize pushing or posting. Ask to publish when you want a commit, push and draft PR.</p><p><strong>Autopilot</strong> continues through the active work, including commits, ordinary pushes, a draft PR and replies to addressed review comments. It stops when waiting for CI, reviews or a missing decision. Monitoring requires a separate request.</p><p>You keep the merge decision. Workbench never marks a PR ready, merges or deploys automatically.</p></section>
      <section><h3>Read the board</h3><ul>
        <li><strong>Cards are saved checkpoints.</strong> Opening the board does not start work. Needs attention filters tasks with blockers or evidence that needs checking. In a narrow window, choose a stage above the cards; every stage shows its task count.</li>
        <li><strong>Check the evidence.</strong> Imported tasks stay unverified until usable evidence is found. Task details show when PR checks were recorded; Check PR now refreshes that snapshot.</li>
        <li><strong>Keep completed work in Archive.</strong> Archive a Done task or use Archive all for the filtered Done column. Restore to Done and Undo bring cards back; notes and chats are preserved.</li>
      </ul></section>
      <section><h3>App version and updates</h3><p>This panel is running <strong>v{__WORKBENCH_VERSION__}</strong>.</p><p>Refresh board checks saved task progress. After installing an app update, close the Workbench panel and open it again from the sidebar. Check the version in its header. If it still shows the old version, quit and reopen Codex, then open Workbench again. Your saved tasks are kept.</p></section>
      <p className="help-source">Use <code>/workbench:</code> commands from a Codex project chat.</p>
      {vm.busy && <p className="operation-status" role="status"><LoadingIndicator/>{vm.busyLabel}</p>}
      {vm.error && <Alert color="warning" variant="soft" role="alert" description={vm.error}/>}
    </article>
  </Dialog>;
}
