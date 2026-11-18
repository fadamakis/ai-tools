import {devBuildId} from '../shared/build-info.js';
import {operationId} from './operation.js';
import {errorCategories,type ErrorCategory,type SaveOutcome} from '../shared/errors.js';
export const actions=['tasks','task_create','task_decision','task_change','task_plan','task_order','sources','source_check','source_sync','review','review_run','reply_delivery','reply_preparation','reply_read','reply_prepare','reply_save','reply_send','chat_link','open_link','open_chat','connection','display','other'] as const;
export type Action=typeof actions[number];
const events=['sent','saved','failed','retry','blocked','dismissed'] as const;
type EventKind=typeof events[number];
const reasons=['none','wrong_store','disconnected','busy','malformed','review_required'] as const;
type Reason=typeof reasons[number];
export type DiagnosticEvent={version:string;build:string;action:Action;category:ErrorCategory;outcome:SaveOutcome;correlation:string;event:EventKind;reason:Reason;firstAt:string;lastAt:string;count:number};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const key='sauron:diagnostics:v1';
function clean(value:unknown):DiagnosticEvent|null{
  const e=value as DiagnosticEvent;
  if(!e||!actions.includes(e.action)||!errorCategories.includes(e.category)||!events.includes(e.event)||!reasons.includes(e.reason)||!['saved','rejected','unconfirmed'].includes(e.outcome)||!/^diag-[a-f0-9-]{36}$/.test(e.correlation)||!Number.isInteger(e.count)||e.count<1||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.firstAt)||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.lastAt))return null;
  const version=typeof e.version==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(e.version)?e.version:'unknown';
  const build=typeof e.build==='string'&&/^[a-zA-Z0-9._-]{1,160}$/.test(e.build)?e.build:'unknown';
  return {version,build,action:e.action,category:e.category,outcome:e.outcome,correlation:e.correlation,event:e.event,reason:e.reason,firstAt:e.firstAt,lastAt:e.lastAt,count:e.count};
}
export function createDiagnostics(storage?:StorageLike){
  let history:DiagnosticEvent[]=[],active:Partial<Record<Action,DiagnosticEvent>>={};
  try{const saved=JSON.parse(storage?.getItem(key)??'null');history=(Array.isArray(saved?.history)?saved.history:[]).map(clean).filter((e:DiagnosticEvent|null):e is DiagnosticEvent=>!!e).slice(-100);for(const value of Object.values(saved?.active??{})){const e=clean(value);if(e)active[e.action]=e;}}catch{}
  function record(action:Action,event:EventKind,correlation:string,category:ErrorCategory='unknown',outcome:SaveOutcome='unconfirmed',reason:Reason='none'){
    const now=new Date().toISOString();
    const next=clean({version:typeof __SAURON_VERSION__==='undefined'?'unknown':__SAURON_VERSION__,build:devBuildId||'unknown',action,event,correlation,category,outcome,reason,firstAt:now,lastAt:now,count:1});if(!next)return;
    const previous=active[action]?history.slice().reverse().find(e=>e.action===action&&e.correlation===correlation&&e.category===category&&e.outcome===outcome&&e.event==='failed'):undefined;
    if(previous&&event==='failed'&&previous.event===event&&previous.action===action&&previous.category===category&&previous.correlation===correlation&&previous.outcome===outcome){previous.count++;previous.lastAt=now;if(active[action])active[action]={...previous};}
    else {history.push(next);history=history.slice(-100);}
    if(event==='failed'||event==='blocked')active[action]={...(previous&&event==='failed'?previous:next)};
    if(event==='saved'||event==='dismissed')delete active[action];
    try{storage?.setItem(key,JSON.stringify({history,active}));}catch{}
    if(typeof window!=='undefined')window.dispatchEvent(new Event('sauron:diagnostics'));
  }
  return {record,snapshot:()=>({history:history.map(e=>({...e})),active:Object.values(active).map(e=>({...e}))})};
}
let session:StorageLike|undefined;try{session=typeof sessionStorage==='undefined'?undefined:sessionStorage;}catch{}
export const diagnostics=createDiagnostics(session);
const correlations=new Map<string,string>();
export function correlation(key:string){let id=correlations.get(key);if(!id){id='diag-'+operationId();correlations.set(key,id);}return id;}
export function requestCorrelation(action:Action,value:unknown){
  const data=value as {operationId?:unknown;request?:{operationId?:unknown};input?:{operationId?:unknown};args?:{operationId?:unknown}}|undefined;
  const operation=data?.operationId??data?.request?.operationId??data?.input?.operationId??data?.args?.operationId;
  return correlation(action+':'+(typeof operation==='string'?operation:'read'));
}
export const actionForTool=(tool:string):Action=>({list_attention:'tasks',open_attention:'tasks',create_personal_task:'task_create',decide_attention_item:'task_decision',organise_attention_task:'task_change',plan_attention_task:'task_plan',order_attention_tasks:'task_order',configure_attention_sources:'sources',refresh_attention:'source_check',check_local_attention:'source_check',get_slack_reply:'reply_read',prepare_slack_reply:'reply_prepare',save_slack_reply:'reply_save',send_slack_reply:'reply_send',save_attention_discussion_link:'chat_link'} as Record<string,Action>)[tool]??(tool.includes('organisation')||tool.includes('proposal')?'review':'other');
export function diagnosticReport(version:string,build:string|null){return JSON.stringify({version,build,scope:'This panel session only. History may disappear when the panel closes or Codex restarts.',...diagnostics.snapshot()},null,2);}
