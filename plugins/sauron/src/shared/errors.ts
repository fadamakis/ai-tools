export const errorCategories=['conflict','wrong_store','not_found','invalid','unavailable','connection','build_mismatch','unknown'] as const;
export type ErrorCategory=typeof errorCategories[number];
export type SaveOutcome='saved'|'rejected'|'unconfirmed';
export type ErrorDetail={category:ErrorCategory;outcome:Exclude<SaveOutcome,'saved'>};
export function approvedCategory(code:unknown):ErrorCategory{
  if(['conflict','sources_changed','id_reuse','terminal','confirmation_required'].includes(String(code)))return 'conflict';
  if(code==='wrong_store')return 'wrong_store';
  if(code==='not_found')return 'not_found';
  if(['invalid','invalid_parent','invalid_snooze','cycle','self_parent'].includes(String(code)))return 'invalid';
  return errorCategories.includes(code as ErrorCategory)?code as ErrorCategory:'unknown';
}
export class PanelError extends Error{
  constructor(readonly detail:ErrorDetail){super(detail.category);}
}
export function errorDetail(value:unknown):ErrorDetail{
  if(value instanceof PanelError)return value.detail;
  return {category:'unknown',outcome:'unconfirmed'};
}
export function readErrorDetail(value:unknown):ErrorDetail{
  const data=value as Partial<ErrorDetail>|null;
  return {category:approvedCategory(data?.category),outcome:data?.outcome==='rejected'?'rejected':'unconfirmed'};
}
export function failureMessage(action:string,detail:ErrorDetail):string{
  if(detail.category==='wrong_store')return 'This unfinished change belongs to a different task list. Dismiss the old request, then make the change in this list.';
  if(detail.category==='conflict')return `Couldn’t save ${action} because the saved information changed. Load the latest state and review your change before applying it again.`;
  if(detail.category==='not_found')return `Couldn’t save ${action} because the task is no longer available. Reload tasks and choose another task.`;
  if(detail.category==='invalid')return `Couldn’t save ${action}. Check the entered values and selected task before applying it again.`;
  if(detail.category==='build_mismatch')return 'Sauron’s panel and server versions differ. Close Sauron, restart Codex and reopen it.';
  if(detail.category==='unavailable')return 'This action is unavailable in this host. Update Codex, then reopen Sauron.';
  return detail.outcome==='rejected'?`Couldn’t save ${action}. This attempt was rejected. Review the change before trying again.`:`Couldn’t confirm ${action}. It may already be saved. Check saved state or retry the original request.`;
}
