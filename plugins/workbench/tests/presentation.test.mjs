import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionReason, cardNextAction, displayTitle } from '../app/presentation.mjs';

test('attention explains blockers, failed checks, stale PR snapshots and evidence from another revision', () => {
  const at = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(attentionReason({ stage: 'verify', status: 'blocked', nextAction: 'Make the test account available.' }, at), 'Make the test account available.');
  assert.match(attentionReason({ stage: 'pr', pr: { checks: 'failed' } }, at), /CI failed/);
  assert.match(attentionReason({ stage: 'pr', pr: { checkedAt: '2026-10-18T12:00:00Z' } }, at), /over a day/);
  assert.match(attentionReason({ stage: 'review', head: 'new', evidence: { head: 'old' } }, at), /earlier revision/);
});

test('cards keep specific next actions and omit repeated workflow instructions without changing saved data', () => {
  const task = { stage: 'plan', status: 'paused', nextAction: 'Resume the next incomplete Workbench stage.', summary: 'Scope agreed.' };
  assert.equal(cardNextAction(task), 'Scope agreed.');
  assert.equal(task.nextAction, 'Resume the next incomplete Workbench stage.');
  assert.equal(cardNextAction({ stage: 'backlog', nextAction: 'Start Workbench' }), '');
  assert.equal(cardNextAction({ ...task, nextAction: 'Check keyboard focus.' }), 'Check keyboard focus.');
  assert.equal(cardNextAction({ ...task, stage: 'done' }), '');
  assert.equal(displayTitle({ key: 'test[1]', title: 'test[1]: A literal key' }), 'A literal key');
});

test('completed or archived tasks do not demand attention from historical checks', () => {
  const completed = { stage: 'done', status: 'complete', pr: { checks: 'failed', checkedAt: '2020-01-01T00:00:00Z' } };
  assert.equal(attentionReason(completed), '');
  assert.equal(attentionReason({ ...completed, archivedAt: '2026-10-20T12:00:00Z' }), '');
});

test('card titles avoid a repeated ticket while preserving meaningful text', () => {
  assert.equal(displayTitle({ key: 'EX-123', title: 'EX-123: Preserve the draft' }), 'Preserve the draft');
  assert.equal(displayTitle({ key: 'EX-123', title: 'EX-123' }), 'EX-123');
  assert.equal(displayTitle({ key: 'EX-123', title: 'EX-1234: Another task' }), 'EX-1234: Another task');
});
