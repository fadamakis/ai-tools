import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync,chmodSync,existsSync } from 'node:fs';
import { dirname } from 'node:path';
import {localPolicyDigest} from './local-policy.js';
import { ReplyStore } from './reply-store.js';
import {saveDiscussionSchema,type DiscussionLink} from '../shared/contracts.js';
import { decisionSchema, personalTaskSchema, trackCodexThreadsSchema, planTaskSchema, orderTasksSchema, proposeCodexFollowupsSchema, upsertSchema, type Result, type Task, type TaskState, type View, type Observation, type ScanRun, scanOutputSchema, syncSchema, canonicalSourceUrl, providerKind, planningTimeZone, type SyncRun, configureSyncSchema, type SyncCoordination, type LocalState, type SyncReceipt, type TrackedCodexThread, type WorkflowState, type WorkArea, liveProviders, type SyncProgress } from '../shared/contracts.js';

export class StoreError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const facts = ({lastCheckedAt: _, ...rest}: Record<string, unknown>) => rest;
type TaskPlan={workflowState:WorkflowState;area:WorkArea;userTitle:string|null;plannedAction:string|null;dueDate:string|null;reviewDate:string|null;order:number|null;focusOrder:number|null;acceptedAt:string|null};

export class SauronStore {
  private db: DatabaseSync;
  readonly storeId: string;
  readonly replies: ReplyStore;
  constructor(readonly path: string, private now: () => Date = () => new Date(), readonly timeZone: string = process.env.ATTENTION_TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone) {
    new Intl.DateTimeFormat('en',{timeZone}).format(new Date(0));
    mkdirSync(dirname(path), {recursive: true,mode:0o700});
    this.db = new DatabaseSync(path);
    if (Number(this.db.prepare('PRAGMA user_version').get()!.user_version) > 3) { this.db.close(); throw new StoreError('unsupported_schema', 'This database needs a newer Sauron version.'); }
    // Source-backed tasks remain private to the local account, including WAL sidecars.
    for(const file of [path,path+'-wal',path+'-shm'])if(existsSync(file))chmodSync(file,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history (
        seq INTEGER PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL,
        operation_id TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=3;`);
    this.db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('store_id',randomUUID());
    this.storeId = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('store_id')!.value as string;
    this.replies = new ReplyStore(this.db,this.now);
    // Retire the presentation preference without changing tasks or decisions.
    this.db.prepare("DELETE FROM metadata WHERE key='ui_layout'").run();
    if(!this.metadata('planning_initialized_v1',false)){
      this.db.exec('BEGIN IMMEDIATE');
      try{
        for(const task of this.all())this.setMetadata('task-plan:'+task.id,this.defaultPlan(task,true));
        this.setMetadata('planning_initialized_v1',true);
        this.db.exec('COMMIT');
      }catch(error){this.db.exec('ROLLBACK');throw error;}
    }
    const staleFocus=this.all().filter(task=>{const plan=this.plan(task);return plan.focusOrder!==null&&!this.actionable(task,plan);});
    if(staleFocus.length){
      this.db.exec('BEGIN IMMEDIATE');
      try{
        for(const stale of staleFocus){
          const task=this.get(stale.id);
          if(!task)continue;
          const plan=this.plan(task);
          if(plan.focusOrder!==null&&!this.actionable(task,plan))this.savePlan(task,{...plan,focusOrder:null});
        }
        this.db.exec('COMMIT');
      }catch(error){this.db.exec('ROLLBACK');throw error;}
    }
  }
  close() { this.db.close(); }
  private all(): Task[] {
    return this.db.prepare('SELECT data FROM tasks ORDER BY id').all().map(row => JSON.parse(row.data as string) as Task);
  }
  private get(id: string): Task | undefined {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id);
    return row ? JSON.parse(row.data as string) as Task : undefined;
  }
  private sourceKey(item:{provider:Exclude<Observation['provider'],'manual'>;sourceUrl:string;actionKey:string}):string {
    const canonical=canonicalSourceUrl(item.provider,item.sourceUrl);
    const key=item.provider+':'+hash([canonical,item.actionKey]);
    if(this.get(key))return key;
    // Older releases accepted equivalent Calendar account slots and Granola
    // hosts as separate URL spellings. Reuse an existing identity; never rekey
    // its decisions/history or silently merge pre-existing duplicate records.
    const aliases=this.all().filter(task=>task.provider===item.provider&&'actionKey' in task&&task.actionKey===item.actionKey&&
      canonicalSourceUrl(item.provider,task.sourceUrl!)===canonical);
    if(aliases.length>1)throw new StoreError('ambiguous_identity','Multiple saved tasks match this source action. No tasks or decisions were merged.');
    return aliases[0]?.id??key;
  }
  private save(task: Task, kind: string, operation: string) {
    this.db.prepare('INSERT INTO tasks VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(task.id, JSON.stringify(task));
    this.db.prepare('INSERT INTO history(task_id,kind,operation_id,at) VALUES (?,?,?,?)')
      .run(task.id, kind, operation, this.now().toISOString());
  }
  private defaultPlan(task:Task,accepted:boolean):TaskPlan {
    return {workflowState:accepted?(task.sourceState==='waiting'?'waiting':'ready'):'inbox',area:task.provider==='personal'?'personal':'unassigned',
      userTitle:null,plannedAction:null,dueDate:null,reviewDate:null,order:accepted?this.nextOrder():null,focusOrder:null,acceptedAt:accepted?(task.createdAt??task.updatedAt):null};
  }
  private plan(task:Task):TaskPlan {
    const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get('task-plan:'+task.id);
    return row?JSON.parse(row.value as string) as TaskPlan:this.defaultPlan(task,true);
  }
  private savePlan(task:Task,plan:TaskPlan){this.setMetadata('task-plan:'+task.id,plan);}
  private nextOrder():number {
    const plans=this.db.prepare("SELECT value FROM metadata WHERE key LIKE 'task-plan:%'").all().map(row=>JSON.parse(row.value as string) as TaskPlan);
    return Math.max(0,...plans.map(plan=>plan.order??0))+1;
  }
  private taskState(task:Task,plan:TaskPlan,now=this.now()):TaskState {
    return task.userDecision==='complete'?'done':task.userDecision==='dismiss'?'dismissed':
      task.userDecision==='snooze'&&task.snoozedUntil!>now.toISOString()?'snoozed':
      'resolved' in task&&task.resolved?'done':plan.workflowState;
  }
  private actionable(task:Task,plan:TaskPlan):boolean {
    const state=this.taskState(task,plan);
    return state==='ready'||state==='in_progress';
  }
  view(): View {
    const now = this.now();
    const tasks=this.all();
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:planningTimeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    return {items: tasks.map(task => {const plan=this.plan(task),state=this.taskState(task,plan,now);
      const priorityReason=['done','dismissed','snoozed'].includes(state)?null:plan.dueDate&&plan.dueDate<=today?(plan.dueDate<today?'Past due':'Due today'):
        plan.workflowState==='waiting'&&plan.reviewDate&&plan.reviewDate<=today?'Review waiting item':
        task.provider!=='personal'&&task.sourceState==='needs_you'?'Source asks for action':null;
      return {...task,...plan,sourceTitle:task.title,sourceNextAction:task.nextAction,title:plan.userTitle??task.title,nextAction:plan.plannedAction??task.nextAction,
        priorityReason,suggestedFocus:!!plan.dueDate&&plan.dueDate<=today&&(state==='ready'||state==='in_progress'),state};}), readAt: now.toISOString(), syntheticOnly: tasks.every(t=>t.provider==='manual'), storeId: this.storeId, scan:this.scan(),sync:this.sync(),coordination:this.coordination(),local:this.localState(),discussions:this.discussions()};
  }
  private discussions():DiscussionLink[] {
    return this.db.prepare("SELECT value FROM metadata WHERE key LIKE 'discussion-link:%'").all()
      .map(row=>JSON.parse(row.value as string) as DiscussionLink)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.url.localeCompare(b.url));
  }
  saveDiscussion(input:unknown):Result {
    const request=saveDiscussionSchema.parse(input);
    if(request.expectedStoreId!==this.storeId)throw new StoreError('wrong_store','Store ID does not match.');
    if(!this.get(request.taskId))throw new StoreError('not_found','This Sauron item no longer exists.');
    const key='discussion-link:'+hash([request.taskId,request.url]);
    const result=this.transaction(key,request,()=>this.setMetadata(key,{taskId:request.taskId,url:request.url,createdAt:this.now().toISOString()}));
    const discussion=this.metadata<DiscussionLink|null>(key,null);
    if(!discussion)throw new StoreError('discussion_unconfirmed','The saved chat link could not be read back. Reopen the item to check.');
    return {...result,discussion};
  }
  private transaction(id: string, payload: unknown, change: () => void): Result {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const receipt = this.db.prepare('SELECT hash FROM receipts WHERE id=?').get(id);
      if (receipt && receipt.hash !== hash(payload)) throw new StoreError('id_reuse', 'Operation ID was already used for different input.');
      if (!receipt) {
        change();
        this.db.prepare('INSERT INTO receipts VALUES (?,?)').run(id, hash(payload));
      }
      const view = this.view();
      this.db.exec('COMMIT');
      return {...view, receipt:{id, duplicate:!!receipt}};
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  upsert(input: unknown): Result {
    const batch = upsertSchema.parse(input);
    for(const item of batch.items)if(item.provider!=='manual'){
      // Accept the previous URL spelling for explicit observations of records
      // created before alias normalization. The transaction resolves it safely.
      const legacy=new URL(item.sourceUrl);legacy.hash='';
      const eid=item.provider==='calendar'?legacy.searchParams.get('eid'):null;
      legacy.search='';if(eid){legacy.hostname='calendar.google.com';legacy.pathname='/calendar/event';legacy.searchParams.set('eid',eid);}
      const existing=this.get(item.obligationKey);
      const savedIdentity=existing?.provider===item.provider&&'actionKey' in existing&&existing.actionKey===item.actionKey&&
        canonicalSourceUrl(item.provider,existing.sourceUrl!)===canonicalSourceUrl(item.provider,item.sourceUrl);
      if(!savedIdentity&&![canonicalSourceUrl(item.provider,item.sourceUrl),legacy.href].some(url=>item.obligationKey===item.provider+':'+hash([url,item.actionKey])))
        throw new StoreError('source_identity','Source key must match the canonical provider link and stable actionKey.');
    }
    if (new Set(batch.items.map(v => v.obligationKey)).size !== batch.items.length)
      throw new StoreError('duplicate_key', 'A batch must contain distinct obligation keys.');
    return this.transaction('batch:'+batch.batchId, batch, () => {
      const items=batch.items.map(item=>item.provider==='manual'||this.get(item.obligationKey)?item:{...item,obligationKey:this.sourceKey(item)});
      if(new Set(items.map(item=>item.obligationKey)).size!==items.length)throw new StoreError('duplicate_key','A batch must contain distinct obligation keys.');
      this.observe(items,batch.batchId);
    });
  }
  private observe(items:Observation[],batchId:string) {
      for (const observation of items) {
        if (Date.parse(observation.lastCheckedAt) > this.now().getTime() + 60_000)
          throw new StoreError('future_check', 'Last checked time cannot be in the future.');
        const old = this.get(observation.obligationKey);
        if(old?.provider==='personal')throw new StoreError('personal_task', 'Source observations cannot overwrite personal tasks.');
        if(old&&!this.db.prepare('SELECT 1 FROM metadata WHERE key=?').get('task-plan:'+old.id))this.savePlan(old,this.defaultPlan(old,true));
        if (old && observation.sourceVersion < old.sourceVersion) continue;
        if (old && observation.sourceVersion === old.sourceVersion) {
          const oldObservation = upsertSchema.shape.items.element.parse({
            obligationKey:old.obligationKey, sourceVersion:old.sourceVersion, provider:old.provider,
            title:old.title, nextAction:old.nextAction, sourceState:old.sourceState,
            sourceUrl:old.sourceUrl, lastCheckedAt:old.lastCheckedAt,
            ...(old.sourceKind ? {sourceKind:old.sourceKind} : {}),
            ...('actionKey' in old?{actionKey:old.actionKey,resolved:old.resolved}:{}),
            ...('provenance' in old&&old.provenance?{provenance:old.provenance}:{}),
          });
          if (hash(facts(oldObservation)) !== hash(facts(observation)))
            throw new StoreError('source_conflict', 'Changed source facts require a newer sourceVersion.');
          if (Date.parse(observation.lastCheckedAt) <= Date.parse(old.lastCheckedAt!)) continue;
        }
        const time = this.now().toISOString();
        const task: Task = {...observation, id:observation.obligationKey,
          lastCheckedAt: old && Date.parse(old.lastCheckedAt!) > Date.parse(observation.lastCheckedAt) ? old.lastCheckedAt : observation.lastCheckedAt,
          version:(old?.version ?? 0)+1, userDecision:old?.userDecision ?? null,
          decidedAt:old?.decidedAt ?? null, snoozedUntil:old?.snoozedUntil ?? null,
          updatedAt:time, state:old?.state ?? observation.sourceState};
        this.save(task, 'observation', batchId);
        if(!old)this.savePlan(task,this.defaultPlan(task,false));
        else{const plan=this.plan(task);if(plan.focusOrder!==null&&!this.actionable(task,plan))this.savePlan(task,{...plan,focusOrder:null});}
      }
  }
  coordination():SyncCoordination {
    const row=this.db.prepare("SELECT value FROM metadata WHERE key='sync_coordination'").get();
    const setting=row?JSON.parse(row.value as string):{mode:'independent',changedAt:null};
    const sync=this.sync();const now=this.now();
    const ageMinutes=sync?.lastSuccessAt?Math.max(0,Math.floor((now.getTime()-Date.parse(sync.lastSuccessAt))/60_000)):null;
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:this.timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
    const value=(type:string)=>parts.find(part=>part.type===type)?.value??'';
    const minute=Number(value('hour'))*60+Number(value('minute'));
    const businessHoursActive=['Mon','Tue','Wed','Thu','Fri'].includes(value('weekday'))&&minute>=9*60&&minute<=18*60;
    const status=sync?.status==='running'?'running':sync?.status==='partial'?'partial':sync?.status==='failed'?'failed':
      ageMinutes===null?'never':ageMinutes>90?'stale':'fresh';
    return {...setting,epoch:setting.epoch??0,freshness:{status,lastAttemptAt:sync?.finishedAt??sync?.startedAt??null,lastSuccessAt:sync?.lastSuccessAt??null,
      ageMinutes,staleAfterMinutes:90,businessHoursActive,timeZone:this.timeZone}};
  }
  configureSync(input:unknown):Result {
    const request=configureSyncSchema.parse(input);
    if(request.expectedStoreId!==this.storeId)throw new StoreError('wrong_store','Store ID does not match. No setting was written.');
    return this.transaction('sync-mode:'+request.operationId,request,()=>{
      const current=this.coordination();
      if(request.expectedMode!==undefined&&request.expectedMode!==current.mode || request.expectedEpoch!==undefined&&request.expectedEpoch!==(current.epoch??0))
        throw new StoreError('owner_changed','Automatic-update ownership changed. Read current settings before retrying.');
      const localTransition=request.mode==='local_managed'||current.mode==='local_managed';
      if(localTransition&&(request.expectedMode===undefined||request.expectedEpoch===undefined))
        throw new StoreError('owner_required','Local ownership changes require expectedMode and expectedEpoch.');
      if((request.mode!=='independent'||localTransition)&&this.scan()?.status==='running')
        throw new StoreError('scan_running','A source scan is running. Wait for it to finish before changing ownership.');
      if(request.mode==='local_managed'&&this.localState().runtime?.policyDigest!==localPolicyDigest)
        throw new StoreError('runtime_unverified','Verify all five read-only source connections with this local runtime before enabling local ownership.');
      if(localTransition&&(this.sync()?.status==='running'||this.pendingLocalSync()))
        throw new StoreError('sync_running','A source sync or uncertain write needs reconciliation before changing ownership.');
      this.setMetadata('sync_coordination',{mode:request.mode,changedAt:this.now().toISOString(),epoch:(current.epoch??0)+(current.mode===request.mode?0:1)});
    });
  }
  sync():SyncRun|null {
    const row=this.db.prepare("SELECT value FROM metadata WHERE key='dot_sync'").get();
    if(!row)return null;
    const run=JSON.parse(row.value as string) as SyncRun;
    if(run.status==='running'&&this.now().getTime()-Date.parse(run.startedAt)>30*60_000) {
      run.status='failed';run.finishedAt=this.now().toISOString();run.error='Dot sync was interrupted or timed out. Earlier tasks are still saved.';
      const saved=this.db.prepare("UPDATE metadata SET value=? WHERE key='dot_sync' AND value=?").run(JSON.stringify(run),row.value as string);
      if(!saved.changes)return this.sync();
    }
    return run;
  }
  private saveSync(run:SyncRun) {
    this.db.prepare("INSERT INTO metadata VALUES ('dot_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(run));
  }
  syncAttention(input:unknown):Result {
    const request=syncSchema.parse(input).request;
    if(request.expectedStoreId!==this.storeId)throw new StoreError('wrong_store','Store ID does not match. No sync was written.');
    if(request.phase==='start') {
      return this.transaction('sync-start:'+request.runId,request,()=>{
        this.assertSyncOwner(request);
        if(request.writer==='local'&&this.scan()?.status==='running')throw new StoreError('scan_running','A manual source scan is already running.');
        if(this.pendingLocalSync())throw new StoreError('pending_sync','Reconcile the pending source sync before starting another.');
        const old=this.sync();
        if(old?.status==='running')throw new StoreError('sync_busy','A dot sync is already running. Read its status before retrying.');
        this.saveSync({id:request.runId,status:'running',startedAt:this.now().toISOString(),finishedAt:null,
          lastSuccessAt:old?.lastSuccessAt??null,sources:null,error:null,itemCount:0,
          ...(request.writer==='local'?{writer:'local' as const,epoch:request.epoch,targetThrough:request.targetThrough,
            sourceVersions:Object.fromEntries(this.all().map(task=>[task.id,task.sourceVersion]))}:{})});
      });
    }
    return this.transaction('sync-finish:'+request.runId,request,()=>{
      const run=this.sync();
      if(!run||run.id!==request.runId||run.status!=='running')throw new StoreError('expired_sync','This dot sync is no longer active.');
      this.assertSyncOwner(request,run);
      const finishedAt=this.now().toISOString();
      if(request.phase==='fail') {
        this.saveSync({...run,status:'failed',finishedAt,error:request.error});this.saveSyncReceipt(request,this.sync()!,{});return;
      }
      if(Date.parse(request.checkedAt)>this.now().getTime()+60_000||Date.parse(request.checkedAt)<Date.parse(run.startedAt)-60_000)
        throw new StoreError('invalid_check_time','Use the actual check time from this sync, without a future timestamp.');
      if(request.items.some(item=>request.sources[item.provider].status!=='checked'))
        throw new StoreError('unverified_source','Unchecked or failed sources cannot produce observations.');
      const items=request.items.map(item=>{
        const sourceUrl=canonicalSourceUrl(item.provider,item.sourceUrl);
        const obligationKey=this.sourceKey(item);
        return {...item,sourceUrl,obligationKey,sourceVersion:(this.get(obligationKey)?.sourceVersion??0)+1,
          sourceKind:providerKind[item.provider],lastCheckedAt:request.checkedAt};
      });
      if(new Set(items.map(item=>item.obligationKey)).size!==items.length)throw new StoreError('duplicate_key','Sync returned the same obligation twice.');
      if(run.writer==='local')this.validateLocalProgress(request,run);
      const accepted=items.filter(item=>{
        const old=this.get(item.obligationKey);
        return !old||(run.writer==='local'?run.sourceVersions?.[item.obligationKey]===old.sourceVersion:Date.parse(old.lastCheckedAt!)<=Date.parse(item.lastCheckedAt));
      });
      this.observe(accepted,request.runId);
      const checked=Object.values(request.sources).filter(source=>source.status==='checked').length;
      const caughtUp=run.writer!=='local'||liveProviders.every(provider=>request.progress?.[provider].complete&&request.progress[provider].through===run.targetThrough);
      const status=checked===5&&caughtUp?'completed':checked>0?'partial':'failed';
      this.saveSync({...run,status,finishedAt,sources:request.sources,itemCount:accepted.length,...(request.progress?{progress:request.progress}:{}),
        lastSuccessAt:status==='completed'?finishedAt:run.lastSuccessAt,
        error:status==='completed'?null:status==='partial'?(run.writer==='local'?'Source coverage is incomplete or catching up. Earlier tasks are still saved.':'Some sources were not checked. Earlier tasks are still saved.'):'No sources were checked. Earlier tasks are still saved.'});
      if(run.writer==='local'&&request.progress){
        const state=this.localState();const checkpoints={...state.checkpoints};
        for(const provider of liveProviders)if(request.sources[provider].status==='checked')checkpoints[provider]=request.progress[provider];
        this.setMetadata('local_state',{...state,checkpoints});
      }
      this.saveSyncReceipt(request,this.sync()!,Object.fromEntries(accepted.map(item=>[item.obligationKey,this.get(item.obligationKey)!.version])));
    });
  }
  private metadata<T>(key:string,fallback:T):T {
    const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
    return row?JSON.parse(row.value as string) as T:fallback;
  }
  private setMetadata(key:string,value:unknown) {
    this.db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
  }
  localState():LocalState {return this.metadata<LocalState>('local_state',{});}
  updateLocalState(patch:Partial<LocalState>) {
    this.db.exec('BEGIN IMMEDIATE');
    try{this.setMetadata('local_state',{...this.localState(),...patch});this.db.exec('COMMIT');}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  recordLocalRuntimeVerification(proof:{providers:Record<string,boolean>;observedTools:string[];cliVersion:string}) {
    const tools=proof.observedTools.join(' ').toLowerCase();
    if(!liveProviders.every(provider=>proof.providers[provider]&&tools.includes(provider==='jira'?'atlassian':provider==='calendar'?'google_calendar':provider)))
      throw new StoreError('runtime_unverified','All five providers need successful observed reads. No verification was saved.');
    this.updateLocalState({runtime:{policyDigest:localPolicyDigest,verifiedAt:this.now().toISOString(),cliVersion:proof.cliVersion}});
  }
  private assertSyncOwner(request:{writer?:'local'|'dot';epoch?:number;targetThrough?:string},run?:SyncRun) {
    const setting=this.coordination();
    if(request.writer==='local') {
      if(setting.mode!=='local_managed'||request.epoch!==(setting.epoch??0)||run&&run.epoch!==request.epoch)
        throw new StoreError('wrong_owner','The local worker no longer owns automatic updates.');
      if(!run&&!request.targetThrough)throw new StoreError('missing_target','A local run needs a bounded target time.');
      if(request.targetThrough&&Date.parse(request.targetThrough)>this.now().getTime()+60_000)throw new StoreError('future_target','The source target cannot be in the future.');
    }else if(setting.mode==='local_managed'||run?.writer==='local')throw new StoreError('wrong_owner','Automatic updates belong to the local coordinator.');
  }
  private validateLocalProgress(request:any,run:SyncRun) {
    if(!request.progress||request.items.some((item:any)=>item.provenance.reader!=='local_agent'))throw new StoreError('local_evidence','Local sync requires local evidence and provider checkpoints.');
    const prior=this.localState().checkpoints??{};
    for(const provider of liveProviders){
      const progress=request.progress[provider];const old=prior[provider];
      if(progress.target!==run.targetThrough||Date.parse(progress.from)>Date.parse(progress.through)||Date.parse(progress.through)>Date.parse(progress.target)||
        !old&&progress.from!==new Date(Date.parse(run.targetThrough!)-7*24*60*60_000).toISOString()||
        old&&(progress.scopeKey!==old.scopeKey||progress.identity!==old.identity||progress.from!==old.through||Date.parse(progress.through)<Date.parse(old.through)))
        throw new StoreError('invalid_checkpoint','Provider checkpoint does not match the verified window and scope.');
      if(progress.complete&&(progress.cursor!==null||progress.through!==progress.target))throw new StoreError('incomplete_checkpoint','A complete source must reach its target without pending pages.');
      if(request.sources[provider].status!=='checked'&&progress.through!==progress.from)throw new StoreError('unverified_checkpoint','An unchecked source cannot advance its checkpoint.');
    }
  }
  private saveSyncReceipt(request:{runId:string},run:SyncRun,itemVersions:Record<string,number>) {
    this.setMetadata('sync_receipt:'+run.id,{runId:run.id,digest:hash(request),status:run.status,finishedAt:run.finishedAt,itemVersions,...(run.progress?{progress:run.progress}:{})});
    const pending=this.pendingLocalSync();
    if(pending?.request.runId===run.id)this.db.prepare("DELETE FROM metadata WHERE key='local_pending_sync'").run();
  }
  syncReceipt(runId:string):SyncReceipt|null {return this.metadata<SyncReceipt|null>('sync_receipt:'+runId,null);}
  pendingLocalSync():ReturnType<typeof syncSchema.parse>|null {return this.metadata('local_pending_sync',null);}
  stageLocalSync(input:unknown) {
    const envelope=syncSchema.parse(input);const request=envelope.request;
    if(request.expectedStoreId!==this.storeId||request.phase==='start'||request.writer!=='local')throw new StoreError('invalid_stage','Stage a local finish or fail for this store.');
    return this.transaction('sync-stage:'+request.runId,request,()=>{
      const run=this.sync();
      if(!run||run.id!==request.runId||run.status!=='running')throw new StoreError('expired_sync','This local sync is no longer active.');
      this.assertSyncOwner(request,run);
      if(request.phase==='finish'){
        if(Date.parse(request.checkedAt)>this.now().getTime()+60_000||Date.parse(request.checkedAt)<Date.parse(run.startedAt)-60_000)
          throw new StoreError('invalid_check_time','Use the actual check time from this sync.');
        if(request.items.some(item=>request.sources[item.provider].status!=='checked'))throw new StoreError('unverified_source','Unchecked sources cannot produce observations.');
        const keys=request.items.map(item=>this.sourceKey(item));
        if(new Set(keys).size!==keys.length)throw new StoreError('duplicate_key','Sync returned the same obligation twice.');
        this.validateLocalProgress(request,run);
      }
      this.setMetadata('local_pending_sync',envelope);
    });
  }
  discardExpiredLocalSync() {
    const pending=this.pendingLocalSync();if(!pending)return;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const run=this.sync();
      if(run?.id===pending.request.runId&&run.status==='running')throw new StoreError('sync_running','A pending sync is still active.');
      this.db.prepare("DELETE FROM metadata WHERE key='local_pending_sync'").run();this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  scan(): ScanRun|null {
    const row=this.db.prepare("SELECT value FROM metadata WHERE key='scan_run'").get();
    if(!row)return null;
    const run=JSON.parse(row.value as string) as ScanRun;
    if(run.status==='running' && this.now().getTime()-Date.parse(run.startedAt)>12*60_000) {
      run.status='failed';run.finishedAt=this.now().toISOString();
      run.error='The source check was interrupted or timed out. Refresh to try again.';
      const result=this.db.prepare("UPDATE metadata SET value=? WHERE key='scan_run' AND value=?").run(JSON.stringify(run),row.value as string);
      if(!result.changes)return this.scan();
    }
    return run;
  }
  private saveScan(run:ScanRun) {
    this.db.prepare("INSERT INTO metadata VALUES ('scan_run',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(run));
  }
  beginScan(automatic=false): {run:ScanRun;started:boolean} {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(automatic&&this.coordination().mode!=='independent')throw new StoreError('dot_managed','Automatic source scanning is disabled in dot-managed mode.');
      if(this.coordination().mode==='local_managed'&&this.sync()?.status==='running')throw new StoreError('sync_busy','A local source sync is already running.');
      const existing=this.scan();
      if(existing?.status==='running'){this.db.exec('COMMIT');return {run:existing,started:false};}
      const sourceVersions=Object.fromEntries(this.all().filter(task=>task.provider==='slack'||task.provider==='granola').map(task=>[task.id,task.sourceVersion]));
      const run:ScanRun={id:randomUUID(),status:'running',startedAt:this.now().toISOString(),finishedAt:null,sources:null,error:null,itemCount:0,sourceVersions};
      this.saveScan(run);this.db.exec('COMMIT');return {run,started:true};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  finishScan(id:string,input:unknown):Result {
    const output=scanOutputSchema.parse(input);
    if(output.items.some(item=>output.sources[item.provider].status!=='checked'))
      throw new StoreError('unverified_source','A failed source cannot produce verified observations.');
    return this.transaction('scan:'+id,output,()=>{
      const run=this.scan();
      if(!run||run.id!==id||run.status!=='running')throw new StoreError('expired_scan','This scan is no longer active.');
      // Derive versions under the write lock, shared with dot sync and explicit
      // observations. A scan can take minutes; retain facts checked by another
      // writer after it began instead of applying its potentially older snapshot.
      const items=output.items.map(item=>{
        const sourceUrl=canonicalSourceUrl(item.provider,item.sourceUrl);
        const obligationKey=this.sourceKey(item);
        return {...item,sourceUrl,obligationKey,sourceVersion:(this.get(obligationKey)?.sourceVersion??0)+1,
          sourceKind:providerKind[item.provider],lastCheckedAt:this.now().toISOString()};
      });
      if(new Set(items.map(item=>item.obligationKey)).size!==items.length)
        throw new StoreError('duplicate_key','Scan returned the same obligation twice.');
      this.observe(items.filter(item=>{
        const old=this.get(item.obligationKey);
        return !old||(run.sourceVersions?run.sourceVersions[item.obligationKey]===old.sourceVersion:
          Date.parse(old.lastCheckedAt!)<=Date.parse(run.startedAt));
      }),id);
      const checked=Object.values(output.sources).filter(source=>source.status==='checked').length;
      this.saveScan({...run,status:checked===2?'completed':checked===1?'partial':'failed',
        finishedAt:this.now().toISOString(),sources:output.sources,itemCount:items.length,
        error:checked===2?null:checked===1?'One source could not be checked. Earlier tasks are still saved.':'Slack and Granola could not be checked. Earlier tasks are still saved.'});
    });
  }
  failScan(id:string,message:string):void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const run=this.scan();
      if(run?.id===id&&run.status==='running')this.saveScan({...run,status:'failed',finishedAt:this.now().toISOString(),error:message});
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  createPersonal(input: unknown): Result {
    const task = personalTaskSchema.parse(input);
    return this.transaction('personal:'+task.operationId, task, () => {
      const id = 'personal:'+task.operationId;
      const time = this.now().toISOString();
      this.save({id, obligationKey:id, sourceVersion:1, provider:'personal',
        title:task.title, nextAction:task.nextAction, sourceState:task.sourceState,
        sourceUrl:null, lastCheckedAt:null, version:1, userDecision:null,
        decidedAt:null, snoozedUntil:null, updatedAt:time, createdAt:time, state:task.sourceState},
      'personal',task.operationId);
      this.savePlan(this.get(id)!,this.defaultPlan(this.get(id)!,true));
    });
  }
  trackCodexThreads(input:unknown):Result {
    const request=trackCodexThreadsSchema.parse(input);
    if(request.expectedStoreId!==this.storeId)throw new StoreError('wrong_store','Store ID does not match.');
    const ids=request.threads.map(thread=>thread.threadId.toLowerCase());
    if(new Set(ids).size!==ids.length)throw new StoreError('duplicate_thread','A batch must contain distinct Codex chats.');
    const trackedThreads:TrackedCodexThread[]=[];
    for(const thread of request.threads){
      const threadId=thread.threadId.toLowerCase(),url=`codex://threads/${threadId}`;
      let begun=false;
      try{
        this.db.exec('BEGIN IMMEDIATE');
        begun=true;
        const links=this.discussions().filter(link=>link.url===url);
        const matches=new Set(links.filter(link=>!this.db.prepare("SELECT 1 FROM history WHERE task_id=? AND kind='proposal' LIMIT 1").get(link.taskId)).map(link=>link.taskId));
        if(matches.size>1)throw new StoreError('ambiguous_chat','Several Sauron items already link to this chat.');
        const linkedId=[...matches][0];
        let result:TrackedCodexThread;
        if(linkedId){
          if(!this.get(linkedId))throw new StoreError('missing_task','The linked Sauron item no longer exists.');
          result={threadId,taskId:linkedId,url,status:'already_tracked'};
        }else{
          const id=`personal:${threadId}`;
          if(this.get(id))throw new StoreError('task_collision','A personal task already uses this chat ID.');
          const time=this.now().toISOString();
          this.save({id,obligationKey:id,sourceVersion:1,provider:'personal',
            title:thread.title,nextAction:thread.nextAction,sourceState:'needs_you',
            sourceUrl:null,lastCheckedAt:null,version:1,userDecision:null,
            decidedAt:null,snoozedUntil:null,updatedAt:time,createdAt:time,state:'needs_you'},
          'personal',threadId);
          this.savePlan(this.get(id)!,this.defaultPlan(this.get(id)!,true));
          this.setMetadata('discussion-link:'+hash([id,url]),{taskId:id,url,createdAt:time});
          result={threadId,taskId:id,url,status:'created'};
        }
        this.db.exec('COMMIT');
        begun=false;
        trackedThreads.push(result);
      }catch(error){
        if(begun)this.db.exec('ROLLBACK');
        trackedThreads.push({threadId,taskId:null,url,status:'failed',error:error instanceof Error?error.message:'Could not track this chat.'});
      }
    }
    return {...this.view(),trackedThreads};
  }
  proposeCodexFollowups(input:unknown):Result {
    const request=proposeCodexFollowupsSchema.parse(input);
    if(request.expectedStoreId!==this.storeId)throw new StoreError('wrong_store','Store ID does not match.');
    if(new Set(request.proposals.map(item=>item.actionKey)).size!==request.proposals.length)throw new StoreError('duplicate_action','Use a distinct action key for each follow-up.');
    const threadId=request.threadId.toLowerCase(),url=`codex://threads/${threadId}`;
    const proposedFollowups:{id:string;status:'created'|'already_proposed'}[]=[];
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const proposal of request.proposals){
        const digest=hash([threadId,proposal.actionKey]);
        const uuid=`${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
        const id=`personal:${uuid}`;
        if(this.get(id)){proposedFollowups.push({id,status:'already_proposed'});continue;}
        const time=this.now().toISOString();
        this.save({id,obligationKey:id,sourceVersion:1,provider:'personal',title:proposal.title,nextAction:proposal.nextAction,
          sourceState:'needs_you',sourceUrl:null,lastCheckedAt:null,version:1,userDecision:null,decidedAt:null,snoozedUntil:null,
          updatedAt:time,createdAt:time,state:'inbox'},'proposal',proposal.actionKey);
        this.savePlan(this.get(id)!,this.defaultPlan(this.get(id)!,false));
        this.setMetadata('discussion-link:'+hash([id,url]),{taskId:id,url,createdAt:time});
        proposedFollowups.push({id,status:'created'});
      }
      const view=this.view();this.db.exec('COMMIT');return {...view,proposedFollowups};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  planTask(input:unknown):Result {
    const request=planTaskSchema.parse(input);
    return this.transaction('plan:'+request.operationId,request,()=>{
      const task=this.get(request.id);
      if(!task)throw new StoreError('not_found','Task no longer exists. Refresh the list.');
      if(task.version!==request.expectedVersion)throw new StoreError('conflict','Task changed in another view. Refresh before saving.');
      if(task.userDecision==='complete'||task.userDecision==='dismiss')throw new StoreError('terminal','Reopen this task before editing its plan.');
      const current=this.plan(task),next={...current};
      if(request.workflowState){
        next.workflowState=request.workflowState;
        if(current.workflowState==='inbox'&&request.workflowState!=='inbox'){
          next.acceptedAt??=this.now().toISOString();next.order??=this.nextOrder();
        }
        if(request.workflowState==='inbox'){next.acceptedAt=null;next.focusOrder=null;}
      }
      if(!this.actionable(task,next))next.focusOrder=null;
      if(request.area)next.area=request.area;
      if(request.title!==undefined)next.userTitle=request.title;
      if(request.nextAction!==undefined)next.plannedAction=request.nextAction;
      if(request.dueDate!==undefined)next.dueDate=request.dueDate;
      if(request.reviewDate!==undefined)next.reviewDate=request.reviewDate;
      this.savePlan(task,next);
      this.save({...task,version:task.version+1,updatedAt:this.now().toISOString()},'plan',request.operationId);
    });
  }
  orderTasks(input:unknown):Result {
    const request=orderTasksSchema.parse(input);
    if(request.expectedStoreId!==this.storeId)throw new StoreError('wrong_store','Store ID does not match.');
    if(new Set(request.orderedIds).size!==request.orderedIds.length||new Set(request.focusIds).size!==request.focusIds.length||
      request.focusIds.some(id=>!request.orderedIds.includes(id)))throw new StoreError('invalid_order','Order and focus must contain distinct actionable tasks.');
    return this.transaction('order:'+request.operationId,request,()=>{
      const actionable=this.view().items.filter(task=>task.state==='ready'||task.state==='in_progress');
      const actual=actionable.map(task=>task.id).sort(),expected=[...request.orderedIds].sort();
      if(JSON.stringify(actual)!==JSON.stringify(expected))throw new StoreError('conflict','The task list changed. Refresh before reordering.');
      const versions=new Map(request.expectedVersions.map(item=>[item.id,item.version]));
      if(versions.size!==actual.length||actual.some(id=>this.get(id)?.version!==versions.get(id)))throw new StoreError('conflict','Tasks changed in another view. Refresh before reordering.');
      for(const [index,id] of request.orderedIds.entries()){
        const task=this.get(id)!,plan=this.plan(task);
        const next={...plan,order:index+1,focusOrder:request.focusIds.includes(id)?request.focusIds.indexOf(id)+1:null};
        if(plan.order===next.order&&plan.focusOrder===next.focusOrder)continue;
        this.savePlan(task,next);
        this.save({...task,version:task.version+1,updatedAt:this.now().toISOString()},'order',request.operationId);
      }
    });
  }
  decide(input: unknown): Result {
    const operation = decisionSchema.parse(input);
    return this.transaction('decision:'+operation.operationId, operation, () => {
      const old = this.get(operation.id);
      if (!old) throw new StoreError('not_found', 'Task no longer exists. Refresh the list.');
      if (old.version !== operation.expectedVersion)
        throw new StoreError('conflict', 'Task changed in another view. Refresh before choosing again.');
      if (operation.snoozedUntil && Date.parse(operation.snoozedUntil) <= this.now().getTime())
        throw new StoreError('invalid_snooze', 'Choose a future snooze time.');
      if (operation.action !== 'reopen' && (old.userDecision === 'complete' || old.userDecision === 'dismiss'))
        throw new StoreError('terminal', 'This task already has a final decision.');
      const updated={...old, userDecision:operation.action === 'reopen' ? null : operation.action,
        decidedAt:operation.action === 'reopen' ? null : this.now().toISOString(),
        snoozedUntil:operation.snoozedUntil ?? null, updatedAt:this.now().toISOString(),
        version:old.version+1};
      this.save(updated, operation.action, operation.operationId);
      const plan=this.plan(updated);
      if(plan.focusOrder!==null&&!this.actionable(updated,plan))this.savePlan(updated,{...plan,focusOrder:null});
    });
  }
}
