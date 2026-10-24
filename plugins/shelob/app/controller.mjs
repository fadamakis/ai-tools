import { applyContext, reviewMessage, rewriteMessage, reviewRoute, sendReview } from './bridge.mjs';
import { createReportSession, reviewVerdict } from '../assets/report-model.mjs';
import { reviewDecision } from '../assets/review-decision.mjs';
import { reviewExecution } from '../assets/review-execution.mjs';

export class ShelobController {
  constructor(app,extensions,themeHelpers,{appVersion}={}){
    this.app=app;this.extensions=extensions;this.themeHelpers=themeHelpers;
    this.entrypoint='global';this.reviews=[];this.selected=null;this.connected=false;this.page='reviews';
    this.ruleModel=null;this.modal=null;this.error='';this.busy=false;this.version=0;this.generation=0;
    this.listeners=new Set();this.conversationRuns=new Set();this.reportSessions=new Map();
    this.newDraft={url:'',rules:'',reviewMode:'pr_only',requesterName:'',requestUrl:''};this.readingReview=false;this.historyScroll=0;
    this.appVersion=appVersion;this.connection=null;this.connectionError='';this.runtime=null;
    this.visibilityChanged=()=>{if(this.connected)this.refreshConnection();};
    app.addEventListener('hostcontextchanged',value=>this.hostContext(value));
    app.ontoolresult=result=>this.consume(result,true);
    app.ontoolcancelled=()=>{this.error='Review paused. Your findings are saved. Choose Continue review to resume.';this.publish();};
    app.onteardown=async()=>{this.connected=false;clearTimeout(this.timer);clearTimeout(this.connectionTimer);document.removeEventListener('visibilitychange',this.visibilityChanged);this.generation++;return {};};
  }
  subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  snapshot=()=>this.version;
  publish(){this.version++;for(const listener of this.listeners)listener();}
  async call(name,args={}){
    const result=await this.app.callServerTool({name,arguments:args});
    if(result.isError)throw new Error(result.content?.find(item=>item.type==='text')?.text||'Shelob could not complete this action.');
    return result;
  }
  openLink=async url=>{try{await this.app.openLink({url});}catch(error){this.error=error.message||'The source link could not be opened.';this.publish();}};
  async action(callback){
    if(this.busy)return;this.busy=true;this.error='';this.publish();
    try{return await callback();}catch(error){this.error=error.message||String(error);}
    finally{this.busy=false;this.publish();this.schedule();}
  }
  clearSelection(){this.generation++;clearTimeout(this.timer);this.selected=null;this.page='reviews';}
  async home(){this.generation++;this.page='reviews';this.readingReview=false;this.modal=null;this.publish();await this.loadHistory();this.publish();await this.context();this.schedule();}
  async rules(model){
    const generation=++this.generation;clearTimeout(this.timer);this.page='rules';this.ruleModel=model||null;this.publish();
    if(!model){const result=(await this.call('shelob.rules')).structuredContent;if(generation!==this.generation||this.page!=='rules')return;this.ruleModel=result;this.publish();}
    await this.context();
  }
  async settings(){await this.refreshConnection();const [model,policy]=await Promise.all([this.call('shelob.settings'),this.call('shelob.approval_policy')]);this.modal={kind:'settings',model:model.structuredContent,policy:policy.structuredContent};this.publish();}
  async refreshConnection(){
    clearTimeout(this.connectionTimer);if(!this.runtime||!this.connected)return;
    try{
      const result=await this.call('shelob.ui_heartbeat',{resourceNonce:this.runtime.resourceNonce,connectionId:this.connectionId,appVersion:this.appVersion,visible:!document.hidden});
      if(!this.connected)return;
      this.connection=result.structuredContent;this.connectionError='';await this.context();
    }catch(error){this.connection=null;this.connectionError=error.message;}
    finally{if(this.connected){this.publish();this.connectionTimer=setTimeout(()=>this.refreshConnection(),15000);}}
  }
  closeModal(){this.modal=null;this.publish();}
  newReview(){this.modal={kind:'new'};this.publish();}
  rerun(){this.modal={kind:'rerun'};this.publish();}
  async start(){
    const {url,rules,reviewMode,requesterName='',requestUrl=''}=this.newDraft;
    if(requestUrl.trim()&&!requesterName.trim())throw new Error('Add the name of the person who requested the review.');
    const requester=requesterName.trim()?{name:requesterName.trim(),...requestUrl.trim()?{url:requestUrl.trim()}:{}}:undefined;
    const result=await this.call('shelob.start',{kind:'github_pr',url:url.trim(),reviewMode,...rules.trim()?{rules:rules.trim()}:{},...requester?{requester}:{}});
    this.modal=null;this.newDraft={url:'',rules:'',reviewMode:'pr_only',requesterName:'',requestUrl:''};this.consume(result);
    await sendReview(this.extensions.message,reviewMessage({id:result.structuredContent.run.id,source:{url:url.trim(),...requester?{requester}:{}}}),'new');
    await this.loadHistory();this.publish();
  }
  local(){return sendReview(this.extensions.message,reviewMessage({local:true}),'active');}
  async launch(chosenMode,{fresh=false}={}){
    const {run,request}=this.selected;
    const active=this.entrypoint==='thread'&&this.conversationRuns.has(run.id);
    const target=active?'active':'new',savedMode=request?.reviewMode||run.source.reviewMode||'local_copy';
    if(!fresh&&!run.requiresRerun&&run.state==='awaiting_review'&&(!chosenMode||chosenMode===savedMode))return sendReview(this.extensions.message,reviewMessage({id:run.id,source:run.source}),target);
    if(!request)throw new Error('This saved review has no launch settings. Start a new review from All reviews.');
    const result=await this.call('shelob.start',{...request,...chosenMode?{reviewMode:chosenMode}:{}});
    if(active)this.conversationRuns.add(result.structuredContent.run.id);
    this.consume(result);await sendReview(this.extensions.message,reviewMessage({id:result.structuredContent.run.id,source:run.source}),target);await this.loadHistory();this.publish();
  }
  async prepareReview(event,comments){
    const runId=this.selected.run.id;
    const preview=(await this.call('shelob.review_preview',{runId,event,comments})).structuredContent;
    this.modal={kind:'post',runId,preview};this.publish();
  }
  async discuss(findingId,discussed){
    const {run,report}=this.selected;
    await this.call('shelob.comment_discussed',{runId:run.id,snapshotId:report.snapshot.id,findingId,discussed});
    await this.loadRun(run.id);
  }
  async rewrite({findingId,draft,instruction}){
    if(!this.extensions.message)throw new Error('This Codex version cannot ask Shelob to rewrite a comment. Edit the draft directly.');
    const {run,report}=this.selected,session=this.session();
    const finding=report.results.flatMap(result=>result.findings).find(item=>item.id===findingId);
    if(!finding)throw new Error('This finding is no longer in the selected review.');
    const requestId=crypto.randomUUID();
    session.pendingRewrite={requestId,findingId,originalDraft:draft,until:Date.now()+10*60_000};delete session.rewriteError;
    try{await sendReview(this.extensions.message,rewriteMessage({requestId,runId:run.id,snapshotId:report.snapshot.id,finding,draft,instruction}),this.entrypoint==='thread'&&this.conversationRuns.has(run.id)?'active':'new');}
    catch(error){delete session.pendingRewrite;throw error;}
  }
  session(){const key=`${this.selected.run.id}:${this.selected.report.snapshot.id}`;if(!this.reportSessions.has(key))this.reportSessions.set(key,createReportSession());return this.reportSessions.get(key);}
  async loadHistory(){const generation=this.generation;const result=(await this.call('shelob.list')).structuredContent.reviews;if(generation===this.generation)this.reviews=result;}
  async loadRun(id,{open=true}={}){const generation=++this.generation;const result=await this.call('shelob.get',{runId:id});if(generation===this.generation){if(open)this.readingReview=true;this.consume(result);}}
  async context(){
    await this.extensions.modelContext?.update({structuredContent:{page:this.page==='rules'?'rules':this.selected?'review':'history',entrypoint:this.entrypoint,
      ...(this.connection?{uiConnection:this.connection.connection}:{}),
      ...this.page==='rules'?{rulePackRevision:this.ruleModel?.revision}:this.selected?{runId:this.selected.run.id,source:this.selected.run.source,state:this.selected.run.state}:{}}});
  }
  consume(result,fromHost=false){
    const content=result.structuredContent||{},entrypoint=content.entrypoint||result._meta?.entrypoint;
    if(['global','thread'].includes(entrypoint)){
      this.entrypoint=entrypoint;
      if(fromHost){this.clearSelection();this.conversationRuns.clear();this.modal=null;}
    }
    if(fromHost&&this.entrypoint==='thread'&&content.run)this.conversationRuns.add(content.run.id);
    if(content.reviews)this.reviews=content.reviews;
    if(content.run){this.page='reviews';if(!this.selected||fromHost)this.readingReview=true;this.selected={...content,report:result._meta?.report||content.report,request:result._meta?.request,publishing:result._meta?.publishing,autoApproval:result._meta?.autoApproval};}
    if(this.selected?.report){
      const {run,report,publishing}=this.selected;
      const execution=reviewExecution(report,{runState:run.state}),verdict=reviewVerdict(report.results,{report,runState:run.state});
      this.reviews=this.reviews.map(row=>row.id===run.id?{...row,state:run.state,execution,verdict,decision:reviewDecision(report,{execution,verdict,publishing})}:row);
      const session=this.session();
      for(const suggestion of result._meta?.draftSuggestions||[]){
        if(suggestion.runId!==this.selected.run.id||suggestion.snapshotId!==this.selected.report.snapshot.id)continue;
        if(session.pendingRewrite?.findingId===suggestion.findingId&&session.pendingRewrite.requestId!==suggestion.requestId)continue;
        session.suggestions[suggestion.findingId]=suggestion;
        if(session.pendingRewrite?.requestId===suggestion.requestId)delete session.pendingRewrite;
      }
      if(session.pendingRewrite?.until<=Date.now()){session.rewriteError='The rewrite is taking longer than expected. Refresh to check for its proposal, or edit your draft here.';delete session.pendingRewrite;}
    }
    this.publish();
    if(this.connected){this.context().catch(error=>{this.error=error.message;this.publish();});this.schedule();}
  }
  schedule(){
    clearTimeout(this.timer);if(this.page==='rules'||!this.connected)return;
    const selectedPending=this.selected&&(['preparing','awaiting_review'].includes(this.selected.run.state)||this.selected.report&&this.session().pendingRewrite);
    const history=this.entrypoint==='global';if(!selectedPending&&!history)return;
    const id=this.selected?.run.id,generation=this.generation;
    const delay=selectedPending||this.reviews.some(run=>['preparing','awaiting_review'].includes(run.state))?3000:15000;
    this.timer=setTimeout(async()=>{
      if(generation!==this.generation)return;
      if(document.hidden||this.busy){this.schedule();return;}
      try{
        if(history){await this.loadHistory();if(generation!==this.generation)return;this.publish();}
        if(selectedPending&&this.selected?.run.id===id)await this.loadRun(id,{open:false});
      }catch(error){this.error=error.message;this.publish();}
      finally{if(generation===this.generation||this.selected?.run.id===id)this.schedule();}
    },delay);
  }
  hostContext(value){applyContext(document,value,this.themeHelpers);const id=reviewRoute(value);if(this.connected&&id&&id!==this.selected?.run.id)this.action(()=>this.loadRun(id));}
  async connect(){
    await this.app.connect();this.connected=true;this.hostContext(this.app.getHostContext());
    try{this.runtime=JSON.parse(document.getElementById('shelob-runtime')?.textContent||'null');}catch{this.connectionError='Reopen Shelob to verify this window’s connection.';}
    if(this.runtime){this.connectionId=crypto.randomUUID();document.addEventListener('visibilitychange',this.visibilityChanged);await this.refreshConnection();}
    if(!this.reviews.length)await this.loadHistory();this.publish();await this.context();this.schedule();
  }
}
