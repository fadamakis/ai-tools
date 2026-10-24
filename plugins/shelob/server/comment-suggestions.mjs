import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../scripts/lib/git.mjs';

// Suggestions never change a report, the editor's draft, or publication state.
export class CommentSuggestions {
  constructor(store){this.store=store;}
  directory(runId){return path.join(this.store.directory(runId),'comment-suggestions');}
  list(runId,snapshotId){
    const directory=this.directory(runId);
    if(!fs.existsSync(directory))return [];
    return fs.readdirSync(directory).filter(name=>name.endsWith('.json')).flatMap(name=>{
      const value=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
      return value.runId===runId&&value.snapshotId===snapshotId?[value]:[];
    }).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  }
  save({requestId,runId,snapshotId,findingId,originalDraft,draft}){
    const {report}=this.store.get(runId);
    if(report?.snapshot.id!==snapshotId)throw new Error('The review snapshot changed. Request a rewrite from the current finding.');
    if(!report.results.some(result=>result.findings.some(finding=>finding.id===findingId)))throw new Error('This finding is not in the saved review.');
    for(const text of [originalDraft,draft])if(typeof text!=='string'||text.length>600)throw new Error('Keep comment drafts within 600 characters.');
    if(!draft.trim())throw new Error('The proposed comment must contain text.');
    const value={id:randomUUID(),requestId,runId,snapshotId,findingId,originalDraft,draft,createdAt:new Date().toISOString()};
    const directory=this.directory(runId);fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const filename=path.join(directory,digest(JSON.stringify([snapshotId,findingId,requestId]))+'.json'),temporary=filename+'.'+value.id;
    if(fs.existsSync(filename)){
      const previous=JSON.parse(fs.readFileSync(filename,'utf8'));
      if(previous.originalDraft===originalDraft&&previous.draft===draft)return previous;
      throw new Error('A proposal already exists for this rewrite request. Request another rewrite to replace it.');
    }
    fs.writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,filename);
    return value;
  }
}
