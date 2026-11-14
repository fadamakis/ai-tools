import type {Task} from '../shared/contracts.js';
import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {defaultReviewState,type ReviewState,type ReviewRun,type ProposalChange} from '../shared/review-contracts.js';

export const organisationTaskEvidence=(task:Task)=>'task-evidence:'+task.id+':'+createHash('sha256').update(JSON.stringify([task.sourceNextAction??task.nextAction,task.plannedAction??null,task.sourceState,'resolved' in task?task.resolved:false,task.userDecision,task.workflowState,task.parentId,[...(task.directTopicIds??[])].sort(),task.descendantSummary])).digest('hex');
export const changeIdentity=(change:ProposalChange)=>{
  const subject=change.kind==='create'?change.title.toLocaleLowerCase():change.kind==='track'?change.threadId:change.taskRef;
  const target=change.kind==='track'||change.kind==='move'?change.parentRef:change.kind==='topics'?[...change.topics].map(topic=>topic.toLocaleLowerCase()).sort():null;
  return createHash('sha256').update(JSON.stringify([change.kind,subject,target])).digest('hex');
};
export class ReviewStore{
  constructor(private db:DatabaseSync){}
  private read<T>(key:string,fallback:T):T{const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);return row?JSON.parse(row.value as string) as T:fallback;}
  private write(key:string,value:unknown){this.db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  state():ReviewState{return this.read('organisation_review',defaultReviewState());}
  save(state:ReviewState){this.write('organisation_review',{...state,revision:this.state().revision+1});}
  requireLease(runId:string,leaseId:string):ReviewRun{
    const run=this.state().run;if(!run||run.id!==runId||run.leaseId!==leaseId||run.status!=='running')throw Error('Organisation review lease expired.');return run;
  }
  dismissals():Record<string,string[]>{return this.read('organisation_dismissals',{});}
  allowed(change:ProposalChange){const previous=this.dismissals()[changeIdentity(change)];return !previous||change.evidenceIds.some(id=>!previous.includes(id));}
  dismiss(change:ProposalChange){const dismissals=this.dismissals();dismissals[changeIdentity(change)]=change.evidenceIds;this.write('organisation_dismissals',dismissals);}
  corrections():unknown[]{return this.read('organisation_corrections',[]);}
  correction(value:unknown){this.write('organisation_corrections',[...this.corrections().slice(-99),value]);}
}
