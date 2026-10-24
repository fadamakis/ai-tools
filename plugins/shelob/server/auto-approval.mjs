import fs from 'node:fs';
import path from 'node:path';
import { digest } from '../scripts/lib/git.mjs';
import { atomicJson } from './settings.mjs';
import { reviewVerdict } from '../assets/report-model.mjs';
import { reviewExecution } from '../assets/review-execution.mjs';

export class ApprovalPolicy {
  constructor(root){this.file=path.join(root,'approval-policy.json');}
  get(){
    const data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{enabled:false};
    if(typeof data.enabled!=='boolean')throw new Error('Approval settings are invalid. Automatic approval is disabled until settings are repaired.');
    return {enabled:data.enabled,revision:digest(JSON.stringify(data))};
  }
  save({enabled,revision}){
    if(typeof enabled!=='boolean')throw new Error('Choose whether to automatically approve clean reviews.');
    const lock=this.file+'.save';let fd;
    try{fd=fs.openSync(lock,'wx',0o600);}catch{throw new Error('Approval settings are being saved. Try again.');}
    try{if(this.get().revision!==revision)throw new Error('Approval settings changed in another window. Reload Settings before saving.');atomicJson(this.file,{enabled});return this.get();}
    finally{fs.closeSync(fd);fs.rmSync(lock,{force:true});}
  }
}
export function cleanApprovalEligible({run,report}){
  if(run.state!=='complete'||run.source.kind!=='github_pr'||!report||report.freshness?.status!=='current')return false;
  if(reviewExecution(report,{runState:run.state}).state!=='completed')return false;
  if(reviewVerdict(report.results,{report,runState:run.state}).state!=='approve')return false;
  if(report.results.some(result=>result.findings.length||result.findingRefs?.length||!['assessed','not_applicable'].includes(result.status)))return false;
  return report.analysis.codeReview?.required===true&&report.analysis.codeReview.status==='completed';
}
export class AutoApproval {
  constructor(store,publisher){this.store=store;this.publisher=publisher;this.policy=new ApprovalPolicy(store.root);}
  file(runId){return path.join(this.store.directory(runId),'auto-approval.json');}
  status(runId){return fs.existsSync(this.file(runId))?JSON.parse(fs.readFileSync(this.file(runId),'utf8')):null;}
  async afterFinalize(value){
    if(!this.policy.get().enabled||!cleanApprovalEligible(value))return;
    const runId=value.run.id,file=this.file(runId);
    // Claim once per run. A crash or uncertain delivery never causes an automatic retry.
    let fd;try{fd=fs.openSync(file+'.claim','wx',0o600);}catch(error){if(error.code==='EEXIST')return;throw error;}
    const attempt={state:'checking',snapshotId:value.report.snapshot.id,startedAt:new Date().toISOString()};
    try{fs.writeFileSync(fd,String(process.pid));}finally{fs.closeSync(fd);}
    atomicJson(file,attempt);
    try{
      if(this.publisher.status(runId).approval){atomicJson(file,{...attempt,state:'skipped',message:'An approval attempt already exists. Check its receipt.'});return;}
      const preview=await this.publisher.preview({runId,event:'APPROVE',comments:[],body:'All applicable Shelob checks completed with no findings. Automatically approved under the enabled clean-review setting.'});
      if(!this.policy.get().enabled){atomicJson(file,{...attempt,state:'skipped',message:'Automatic approval was disabled before delivery.'});return;}
      // Standing permission comes from the explicit approval-policy setting.
      // The publisher still rechecks the exact PR head/base/body before delivery.
      const receipt=await this.publisher.post({runId,previewId:preview.id,confirmed:true});
      atomicJson(file,{...attempt,state:'posted',url:receipt.url,finishedAt:new Date().toISOString()});
    }catch(error){atomicJson(file,{...attempt,state:'stopped',message:error.message,finishedAt:new Date().toISOString()});}
  }
}
