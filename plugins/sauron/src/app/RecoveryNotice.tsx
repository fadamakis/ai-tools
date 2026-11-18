import {Button} from '@ai-tools/ui';
import {failureMessage,type ErrorDetail} from '../shared/errors.js';
type Recovery={visible:boolean;noLongerApplicable:boolean;readFailed:boolean;missingStore:boolean;saving:boolean;checked:boolean;checkSaved:()=>unknown;malformed:boolean;label:string;detail:ErrorDetail;review:{summary:string}|null;retry:()=>unknown;loadLatest:()=>unknown;reapply:()=>unknown;dismiss:()=>void};
export function RecoveryNotice({recovery,busy,connected}:{recovery:Recovery;busy:boolean;connected:boolean}){
  if(!recovery.visible)return null;
  const {detail,review,malformed}=recovery;
  return <aside className="inbox-message" role="alert" aria-label="Save recovery">
    <strong>{malformed?'An unfinished request could not be read':`Check ${recovery.label}`}</strong>
    <p>{malformed?'This unfinished request cannot be retried. Dismiss it, then check your task before making the change again.':recovery.noLongerApplicable?'This change no longer applies to the latest saved state. Dismiss this retry, then review the task or suggestions again.':recovery.missingStore?'This older unfinished request does not identify its task list. Dismiss it, then check your tasks before making the change again.':failureMessage(recovery.label,detail)}</p>
    {recovery.saving&&<p role="status">Saving the original request…</p>}
    {recovery.readFailed&&<p>Couldn’t load the latest saved state. Your original change is retained. Try checking again when Sauron reconnects.</p>}
    {recovery.checked&&<p>The save could not be confirmed. The original request is retained. Retry it or dismiss this request after checking your tasks.</p>}
    {review&&<p>{review.summary}</p>}
    {!connected&&<p>Reconnect Sauron before checking or retrying this change.</p>}
    <div className="inbox-detail-actions">
      {!malformed&&!recovery.noLongerApplicable&&detail.outcome==='unconfirmed'&&<Button size="sm" color="secondary" variant="outline" disabled={busy||!connected} onClick={()=>void recovery.checkSaved()}>Check saved state</Button>}
      {!malformed&&!recovery.noLongerApplicable&&detail.category!=='wrong_store'&&detail.category!=='not_found'&&detail.category!=='build_mismatch'&&detail.category!=='unavailable'&&(review?
        <Button size="sm" color="primary" disabled={busy||!connected} onClick={()=>void recovery.reapply()}>Apply reviewed change</Button>:
        detail.outcome==='rejected'?<Button size="sm" color="secondary" disabled={busy||!connected} onClick={()=>void recovery.loadLatest()}>Review latest tasks</Button>:
        <Button size="sm" color="secondary" disabled={busy||!connected} onClick={()=>void recovery.retry()}>Retry save</Button>)}
      {!recovery.noLongerApplicable&&detail.category==='not_found'&&<Button size="sm" color="secondary" disabled={busy||!connected} onClick={()=>void recovery.loadLatest()}>Reload tasks</Button>}
      <Button size="sm" color="secondary" variant="ghost" disabled={busy} onClick={recovery.dismiss}>{detail.category==='wrong_store'?'Dismiss old request':'Dismiss retry'}</Button>
    </div><p>Dismissal clears this retry request. It does not undo saved changes.</p>
  </aside>;
}
