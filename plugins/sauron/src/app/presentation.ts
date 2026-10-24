import type { Result, TaskState } from '../shared/contracts.js';

export function mergeSavedView(previous:Result|null,next:Result):Result {
  if(!previous||previous.storeId!==next.storeId)return next;
  const latest=previous.readAt>next.readAt?previous:next;
  const earlier=latest===next?previous:next;
  const items=new Map(earlier.items.map(task=>[task.id,task]));
  for(const task of latest.items){
    const saved=items.get(task.id);
    if(!saved||task.version>=saved.version)items.set(task.id,task);
  }
  // Saved tasks are never deleted. Merge versions per task so delayed host
  // responses cannot undo decisions or hide unrelated newly saved tasks.
  const merged=[...items.values()].sort((a,b)=>a.id.localeCompare(b.id));
  return {...latest,items:merged,syntheticOnly:merged.every(task=>task.provider==='manual')};
}

export const labels: Record<TaskState, string> = {
  needs_you: 'Needs you', waiting: 'Waiting', done: 'Done',
  snoozed: 'Snoozed', dismissed: 'Dismissed',
};
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
});
export const date = (value: string) => dateFormat.format(new Date(value));
