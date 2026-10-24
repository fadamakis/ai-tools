import { z } from 'zod';
import type { ReplyDraft } from './replies.js';

export const sourceKinds = ['manual', 'slack', 'jira', 'github', 'calendar', 'meeting'] as const;
const taskIdSchema = z.union([
  z.string().regex(/^(?:synthetic:[a-z0-9-]{1,80}|(?:slack|granola|jira|github|calendar):[a-f0-9]{64})$/),
  z.string().startsWith('personal:').refine(value=>z.string().uuid().safeParse(value.slice(9)).success),
]);
const syntheticSchema = z.strictObject({
  obligationKey: z.string().regex(/^synthetic:[a-z0-9-]{1,80}$/),
  sourceVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  provider: z.literal('manual'),
  sourceKind: z.enum(sourceKinds).optional(),
  title: z.string().trim().min(1).max(160),
  nextAction: z.string().trim().min(1).max(400),
  sourceState: z.enum(['needs_you', 'waiting']),
  sourceUrl: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'example.invalid'
      && !url.username && !url.password && !url.port;
  }, 'Only synthetic example.invalid source links are accepted'),
  lastCheckedAt: z.string().datetime().transform(v => new Date(v).toISOString()),
});

export const liveProviders = ['slack', 'granola', 'jira', 'github', 'calendar'] as const;
export type LiveProvider = typeof liveProviders[number];
export const providerKind = {slack:'slack',granola:'meeting',jira:'jira',github:'github',calendar:'calendar'} as const;
const provenanceSchema = z.strictObject({reader:z.enum(['dot','local_agent']), evidence:z.string().trim().min(1).max(1000)});
export const liveSourceSchema = z.strictObject({
  provider: z.enum(liveProviders),
  sourceUrl: z.string().url(),
  actionKey: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  nextAction: z.string().trim().min(1).max(400),
  sourceState: z.enum(['needs_you', 'waiting']),
  resolved: z.boolean(),
  provenance: provenanceSchema.optional(),
}).superRefine((value, ctx) => {
  if (!validSourceUrl(value.provider, value.sourceUrl))
    ctx.addIssue({code:'custom', message:'Use a direct supported source link for this provider.'});
});
export function validSourceUrl(provider: LiveProvider, value: string): boolean {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
    switch(provider) {
      case 'slack':return /^[a-z0-9-]+\.slack\.com$/.test(url.hostname)&&/^\/archives\/[A-Z0-9]+\/p\d{16}$/.test(url.pathname);
      case 'granola':return ['notes.granola.ai','app.granola.ai'].includes(url.hostname)&&/^\/d\/[a-f0-9-]{36}$/.test(url.pathname);
      case 'jira':return /^[a-z0-9-]+\.atlassian\.net$/.test(url.hostname)&&/^\/browse\/[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(url.pathname);
      case 'github':return url.hostname==='github.com'&&/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(issues|pull)\/[1-9]\d*$/.test(url.pathname);
      case 'calendar':return ['calendar.google.com','www.google.com'].includes(url.hostname)&&
        ((/^\/calendar(?:\/u\/\d+)?\/event$/.test(url.pathname)&&/^[A-Za-z0-9_=-]+$/.test(url.searchParams.get('eid')??''))||
        (url.hostname==='calendar.google.com'&&/^\/calendar\/u\/\d+\/r\/eventedit\/[A-Za-z0-9_=-]+$/.test(url.pathname)));
    }
  }catch{return false;}
}
export function canonicalSourceUrl(provider:LiveProvider,value:string):string {
  const url=new URL(value);url.hash='';
  // Google Calendar's eid is its event identity; stripping it would merge events.
  const eid=provider==='calendar'?url.searchParams.get('eid'):null;
  url.search='';if(eid){url.hostname='calendar.google.com';url.pathname='/calendar/event';url.searchParams.set('eid',eid);}
  if(provider==='calendar')url.pathname=url.pathname.replace(/^\/calendar\/u\/\d+\/r\/eventedit\//,'/calendar/u/0/r/eventedit/');
  if(provider==='granola')url.hostname='notes.granola.ai';
  return url.href;
}
const liveObservationSchema = z.strictObject({
  ...liveSourceSchema.shape,
  obligationKey:z.string().regex(/^(slack|granola|jira|github|calendar):[a-f0-9]{64}$/),
  sourceVersion:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sourceKind:z.enum(sourceKinds).optional(),
  lastCheckedAt:z.string().datetime(),
}).superRefine((value, ctx)=>{
  if(!validSourceUrl(value.provider,value.sourceUrl)||!value.obligationKey.startsWith(value.provider+':')||
    (value.sourceKind!==undefined&&value.sourceKind!==providerKind[value.provider])||
    (['jira','github','calendar'].includes(value.provider)&&!value.provenance))
    ctx.addIssue({code:'custom',message:'Source identity and direct link must match the provider.'});
});
export const observationSchema = z.union([syntheticSchema,liveObservationSchema]);
const coverageSchema=z.strictObject({status:z.enum(['checked','failed']),detail:z.string().max(400)});
export const scanOutputSchema=z.strictObject({
  sources:z.strictObject({slack:coverageSchema,granola:coverageSchema}),
  items:z.array(liveSourceSchema.safeExtend({provider:z.enum(['slack','granola'])})).max(100),
});
// Structured Outputs accepts a narrower JSON Schema format set than Zod.
// URL validation remains mandatory when the worker result enters the store.
export const scanOutputJsonSchema=()=>z.toJSONSchema(scanOutputSchema,{override:ctx=>{
  if(ctx.jsonSchema.format==='uri')delete ctx.jsonSchema.format;
}});
export type ScanOutput=z.infer<typeof scanOutputSchema>;
export type ScanRun={id:string;status:'running'|'completed'|'partial'|'failed';startedAt:string;finishedAt:string|null;
  sources:ScanOutput['sources']|null;error:string|null;itemCount:number;sourceVersions?:Record<string,number>};

const syncCoverageSchema=z.strictObject({status:z.enum(['checked','failed','skipped']),detail:z.string().trim().min(1).max(400)});
export const syncSourcesSchema=z.strictObject({slack:syncCoverageSchema,granola:syncCoverageSchema,jira:syncCoverageSchema,github:syncCoverageSchema,calendar:syncCoverageSchema});
export const sourceProgressSchema=z.strictObject({
  from:z.string().datetime(),through:z.string().datetime(),target:z.string().datetime(),
  identity:z.string().min(1).max(200),complete:z.boolean(),cursor:z.string().max(2000).nullable(),scopeKey:z.string().min(1).max(300),
});
export const syncProgressSchema=z.strictObject({slack:sourceProgressSchema,granola:sourceProgressSchema,jira:sourceProgressSchema,github:sourceProgressSchema,calendar:sourceProgressSchema});
export type SourceProgress=z.infer<typeof sourceProgressSchema>;
export type SyncProgress=z.infer<typeof syncProgressSchema>;
const syncIdentity={expectedStoreId:z.string().uuid(),runId:z.string().uuid(),writer:z.enum(['dot','local']).optional(),epoch:z.number().int().nonnegative().optional()};
const syncRequestSchema=z.discriminatedUnion('phase',[
  z.strictObject({...syncIdentity,phase:z.literal('start'),targetThrough:z.string().datetime().optional()}),
  z.strictObject({...syncIdentity,phase:z.literal('finish'),checkedAt:z.string().datetime().transform(v=>new Date(v).toISOString()),
    progress:syncProgressSchema.optional(),sources:syncSourcesSchema,items:z.array(liveSourceSchema.safeExtend({provenance:provenanceSchema})).max(100)}),
  z.strictObject({...syncIdentity,phase:z.literal('fail'),error:z.string().trim().min(1).max(400)}),
]);
export const syncSchema=z.strictObject({request:syncRequestSchema});
export const syncModes=['independent','dot_managed','local_managed'] as const;
export const configureSyncSchema=z.strictObject({expectedStoreId:z.string().uuid(),operationId:z.string().uuid(),mode:z.enum(syncModes),expectedMode:z.enum(syncModes).optional(),expectedEpoch:z.number().int().nonnegative().optional()});
export type SyncMode=typeof syncModes[number];
export type SyncCoordination={mode:SyncMode;changedAt:string|null;epoch?:number;freshness:{status:'never'|'running'|'fresh'|'stale'|'partial'|'failed';
  lastAttemptAt:string|null;lastSuccessAt:string|null;ageMinutes:number|null;staleAfterMinutes:number;businessHoursActive:boolean;timeZone:string}};
export type SyncRun={writer?:'dot'|'local';epoch?:number;targetThrough?:string;sourceVersions?:Record<string,number>;progress?:SyncProgress;id:string;status:'running'|'completed'|'partial'|'failed';startedAt:string;finishedAt:string|null;
  lastSuccessAt:string|null;sources:z.infer<typeof syncSourcesSchema>|null;error:string|null;itemCount:number};

export const localOutputSchema=z.strictObject({
  sources:syncSourcesSchema,progress:syncProgressSchema,
  items:z.array(liveSourceSchema.safeExtend({provenance:z.strictObject({reader:z.literal('local_agent'),evidence:z.string().trim().min(1).max(1000)})})).max(100),
});
export const localOutputJsonSchema=()=>z.toJSONSchema(localOutputSchema,{override:ctx=>{if(ctx.jsonSchema.format==='uri')delete ctx.jsonSchema.format;}});
export const localTriggerSchema=z.strictObject({expectedStoreId:z.string().uuid(),reason:z.enum(['timer','connect','reconnect','manual']).default('timer')});
export type LocalState={runtime?:{policyDigest:string;verifiedAt:string;cliVersion:string};lastTickAt?:string;lastAttemptAt?:string;nextAttemptAt?:string;lastAvailableAt?:string;failures?:number;reason?:string;blocked?:string;checkpoints?:Partial<Record<LiveProvider,SourceProgress>>};
export type SyncReceipt={runId:string;digest:string;status:SyncRun['status'];finishedAt:string|null;itemVersions:Record<string,number>;progress?:SyncProgress};

export const upsertSchema = z.strictObject({
  batchId: z.string().min(1).max(120),
  items: z.array(observationSchema).min(1).max(20),
});
export const decisionSchema = z.strictObject({
  operationId: z.string().min(1).max(120),
  id: taskIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  action: z.enum(['complete', 'snooze', 'dismiss', 'reopen']),
  snoozedUntil: z.string().datetime().transform(v => new Date(v).toISOString()).optional(),
}).superRefine((v, ctx) => {
  if ((v.action === 'snooze') !== (v.snoozedUntil !== undefined))
    ctx.addIssue({code:'custom', message:'Only snooze requires snoozedUntil'});
});

export const personalTaskSchema = z.strictObject({
  operationId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  nextAction: z.string().trim().max(400).default(''),
  sourceState: z.enum(['needs_you', 'waiting']).default('needs_you'),
});

export type Observation = z.infer<typeof observationSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type PersonalTaskInput = z.infer<typeof personalTaskSchema>;
export type SourceKind = typeof sourceKinds[number];
export type TaskState = 'needs_you' | 'waiting' | 'done' | 'snoozed' | 'dismissed';
type PersonalTask = Omit<Observation, 'provider' | 'sourceUrl' | 'lastCheckedAt'> & {
  provider: 'personal'; sourceUrl: null; lastCheckedAt: null;
};
export type Task = (Observation | PersonalTask) & {
  id: string;
  version: number;
  userDecision: 'complete' | 'snooze' | 'dismiss' | null;
  decidedAt: string | null;
  snoozedUntil: string | null;
  updatedAt: string;
  createdAt?: string;
  state: TaskState;
};
export function canonicalDiscussionUrl(value:string):string {
  const url=new URL(value),id=url.pathname.split('/').at(-1)!;
  if(url.username||url.password||url.port||!z.uuid().safeParse(id).success)throw Error('Paste a ChatGPT or Codex conversation link.');
  if(url.protocol==='https:'&&url.hostname==='chatgpt.com'&&url.pathname===`/c/${id}`)return `https://chatgpt.com/c/${id.toLowerCase()}`;
  if(url.protocol==='codex:'&&url.hostname==='threads'&&url.pathname===`/${id}`)return `codex://threads/${id.toLowerCase()}`;
  throw Error('Paste a ChatGPT or Codex conversation link.');
}
export const linkDiscussionSchema=z.strictObject({expectedStoreId:z.uuid(),taskId:taskIdSchema});
export const saveDiscussionSchema=linkDiscussionSchema.extend({url:z.string().max(500).transform((value,ctx)=>{
  try{return canonicalDiscussionUrl(value.trim());}catch{ctx.addIssue({code:'custom',message:'Paste a ChatGPT or Codex conversation link.'});return z.NEVER;}
})});
export type DiscussionLink={taskId:string;url:string;createdAt:string};
export type View = { items: Task[]; readAt: string; syntheticOnly: boolean; storeId: string; scan?:ScanRun|null; sync?:SyncRun|null; coordination?:SyncCoordination; local?:LocalState;discussions?:DiscussionLink[] };
export type Result = View & { receipt?: { id: string; duplicate: boolean }; error?: string; reply?: ReplyDraft|null;syncReceipt?:SyncReceipt|null;discussion?:DiscussionLink };

export const syntheticObservation = (version = 1): Observation => ({
  obligationKey: 'synthetic:review-proof', sourceVersion: version, provider: 'manual',
  title: 'Review the synthetic launch note',
  nextAction: version === 1 ? 'Check the sample note and mark it complete.' : 'A repeated check still asks for review.',
  sourceState: 'needs_you', sourceUrl: 'https://example.invalid/attention/review-proof',
  lastCheckedAt: new Date().toISOString(),
});
