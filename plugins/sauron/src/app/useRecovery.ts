import {useEffect,useRef,useState} from 'react';
import type {Client} from './client.js';
import type {Result} from '../shared/contracts.js';
import {errorDetail,readErrorDetail,type ErrorDetail} from '../shared/errors.js';
import {diagnostics,requestCorrelation,type Action} from './diagnostics.js';
export type Run=(work:()=>Promise<Result>,success?:(saved:Result)=>void,failure?:(error:unknown)=>void)=>Promise<Result|undefined>;
export function readRecord<T>(key:string,parse:(value:unknown)=>T):{value:T|null;malformed:boolean}{
  let raw:string|null;try{raw=sessionStorage.getItem(key);}catch{return {value:null,malformed:false};}
  try{if(!raw&&key==='attention:pending:v2'){const legacy=sessionStorage.getItem('attention:pending:v1');if(legacy)raw=JSON.stringify({kind:'decision',input:JSON.parse(legacy)});}if(!raw)return {value:null,malformed:false};return {value:parse(JSON.parse(raw)),malformed:false};}catch{return {value:null,malformed:true};}
}
export function useRecovery<T>(options:{key:string;parse:(value:unknown)=>T;action:Action|((value:T)=>Action);label:(value:T)=>string;store:(value:T)=>string|undefined;view:Result|null;client:Client|null;run:Run;execute:(client:Client,value:T)=>Promise<Result>;prepare:(value:T,latest:Result)=>T|null;summary:(value:T,latest:Result)=>string;receipt?:(value:T)=>{id:string;payload:unknown};onSaved?:(saved:Result,value:T)=>void}){
  const [initial]=useState(()=>readRecord(options.key,options.parse));
  const [pending,setPending]=useState<T|null>(initial.value);
  const [malformed,setMalformed]=useState(initial.malformed);
  const [recovering,setRecovering]=useState(!!initial.value);
  const [failure,setFailureState]=useState<ErrorDetail|null>(()=>{try{const raw=sessionStorage.getItem(options.key+':failure');return raw?readErrorDetail(JSON.parse(raw)):null;}catch{return null;}});
  const setFailure=(detail:ErrorDetail|null)=>{setFailureState(detail);try{if(detail)sessionStorage.setItem(options.key+':failure',JSON.stringify(detail));else sessionStorage.removeItem(options.key+':failure');}catch{}};
  const [noLongerApplicable,setNoLongerApplicable]=useState(false);
  const [readFailed,setReadFailed]=useState(false);
  const [checked,setChecked]=useState(false);
  const [saving,setSaving]=useState(false);
  const [review,setReview]=useState<{value:T;summary:string}|null>(null);
  const action=typeof options.action==='function'?(pending?options.action(pending):'other'):options.action;
  const id=requestCorrelation(action,pending);
  const inFlight=useRef(false);
  const remember=(value:T|null)=>{setPending(value);try{if(value)sessionStorage.setItem(options.key,JSON.stringify(value));else sessionStorage.removeItem(options.key);}catch{}};
  const missingStore=!!pending&&!options.store(pending);
  const mismatch=!!pending&&!!options.view&&!!options.store(pending)&&options.store(pending)!==options.view.storeId;
  const detail:ErrorDetail=mismatch||missingStore?{category:'wrong_store',outcome:'rejected'}:failure??{category:'unknown',outcome:'unconfirmed'};
  function dismiss(record=true){remember(null);setMalformed(false);setRecovering(false);setFailure(null);setReview(null);try{sessionStorage.removeItem(options.key);if(options.key==='attention:pending:v2')sessionStorage.removeItem('attention:pending:v1');}catch{}if(record)diagnostics.record(action,'dismissed',id);}
  function blocked(reason:'wrong_store'|'disconnected'|'review_required',category:ErrorDetail['category']){setRecovering(true);setFailure({category,outcome:reason==='disconnected'?'unconfirmed':'rejected'});diagnostics.record(action,'blocked',id,category,reason==='disconnected'?'unconfirmed':'rejected',reason);}
  async function submit(value:T,retry=false){
    if(inFlight.current){diagnostics.record(action,'blocked',id,'unknown','unconfirmed','busy');return;}
    if(retry)diagnostics.record(action,'retry',id);
    if(pending&&value!==pending&&value!==review?.value){diagnostics.record(action,'blocked',id,'unavailable','unconfirmed','busy');return;}
    if(!options.client||!options.view){blocked('disconnected','connection');return;}
    if(!options.store(value)||options.store(value)!==options.view.storeId){blocked('wrong_store','wrong_store');return;}
    if(retry&&detail.outcome==='rejected'){blocked('review_required',detail.category);return;}
    inFlight.current=true;remember(value);setSaving(true);setFailure(null);setReview(null);setChecked(false);setReadFailed(false);setNoLongerApplicable(false);
    let invoked=false;
    try{const saved=await options.run(()=>{invoked=true;return options.execute(options.client!,value);},saved=>{dismiss(false);options.onSaved?.(saved,value);},error=>{setFailure(errorDetail(error));setRecovering(true);});if(!invoked){setFailure({category:'unknown',outcome:'rejected'});setRecovering(true);diagnostics.record(action,'blocked',id,'unknown','rejected','busy');}return saved;}finally{inFlight.current=false;setSaving(false);}
  }
  async function loadLatest(){
    if(!pending)return;
    if(!options.client||!options.view){blocked('disconnected','connection');return;}
    if(mismatch){blocked('wrong_store','wrong_store');return;}
    return options.run(()=>options.client!.call('list_attention'),latest=>{
      if(options.store(pending)&&options.store(pending)!==latest.storeId){blocked('wrong_store','wrong_store');return;}
      const next=options.prepare(pending,latest);
      if(next)setReview({value:next,summary:options.summary(next,latest)});
      else setNoLongerApplicable(true);
    },()=>setReadFailed(true));
  }
  async function checkSaved(){
    if(!pending||!options.view)return;
    if(!options.client){blocked('disconnected','connection');return;}
    if(mismatch){blocked('wrong_store','wrong_store');return;}
    const check=options.receipt?.(pending);
    return options.run(()=>options.client!.call('list_attention',check?{checkSave:{...check,expectedStoreId:options.store(pending)??options.view!.storeId}}:{}),saved=>{
      if(check&&saved.receipt?.id===check.id){diagnostics.record(action,'saved',id,'unknown','saved');dismiss(false);options.onSaved?.(saved,pending);}
      else setChecked(true);
    },()=>setReadFailed(true));
  }
  useEffect(()=>{
    if(malformed)diagnostics.record(action,'blocked',id,'invalid','unconfirmed','malformed');
    else if(mismatch||missingStore)diagnostics.record(action,'blocked',id,'wrong_store','rejected','wrong_store');
  },[malformed,mismatch,missingStore]);
  useEffect(()=>{
    if(!pending||saving||!options.client||!options.view||!options.receipt||mismatch)return;
    let active=true;const check=options.receipt(pending);
    void options.client.call('list_attention',{checkSave:{...check,expectedStoreId:options.store(pending)??options.view.storeId}}).then(saved=>{if(active&&saved.receipt?.id===check.id){diagnostics.record(action,'saved',id,'unknown','saved');dismiss(false);options.onSaved?.(saved,pending);}}).catch(()=>{});
    return()=>{active=false;};
  },[options.client,options.view?.taskViewRevision,pending,mismatch]);
  return {pending,malformed,visible:malformed||!!pending&&recovering,missingStore,saving,noLongerApplicable,readFailed,checked,checkSaved,detail,review,label:pending?options.label(pending):'unfinished change',
    submit,retry:()=>pending?submit(pending,true):undefined,loadLatest,reapply:()=>review?submit(review.value):undefined,dismiss:()=>dismiss()};
}
