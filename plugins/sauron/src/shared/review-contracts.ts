import {z} from 'zod';

export const proposalChangeSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('create'),key:z.string().min(1).max(100),title:z.string().trim().min(1).max(160),reason:z.string().min(1).max(600),evidenceIds:z.array(z.string()).max(30)}),
  z.strictObject({kind:z.literal('track'),key:z.string().min(1).max(100),threadId:z.string().uuid(),title:z.string().trim().min(1).max(160),parentRef:z.string().nullable(),reason:z.string().min(1).max(600),evidenceIds:z.array(z.string()).max(30)}),
  z.strictObject({kind:z.literal('move'),key:z.string().min(1).max(100),taskRef:z.string(),parentRef:z.string().nullable(),reason:z.string().min(1).max(600),evidenceIds:z.array(z.string()).max(30)}),
  z.strictObject({kind:z.literal('topics'),key:z.string().min(1).max(100),taskRef:z.string(),topics:z.array(z.string().trim().min(1).max(60)).max(30),reason:z.string().min(1).max(600),evidenceIds:z.array(z.string()).max(30)}),
  z.strictObject({kind:z.literal('close'),key:z.string().min(1).max(100),taskRef:z.string(),reason:z.string().min(1).max(600),evidenceIds:z.array(z.string()).max(30)}),
]);
export type ProposalChange=z.infer<typeof proposalChangeSchema>;
export const proposalOutputSchema=z.strictObject({changes:z.array(proposalChangeSchema).max(100)});
export type ChatHeader={id:string;title:string;updatedAt:number;createdAt:number};
export type ChatEvidence={threadId:string;title:string;fingerprint:string;messages:{id:string;text:string;role:'user'|'assistant'}[];latestAssistant:string|null;latestAssistantAt?:number|null;observedUpdatedAt?:number};
export type ReviewOrigin='fixture'|'local_history';
export type ReviewProposal={origin?:ReviewOrigin;id:string;revision:number;taskViewRevision:number;changes:ProposalChange[];closureScopes:Record<string,string[]>;coverage:string[];status:'pending'|'accepted'|'dismissed'};
export type ReviewRun={origin?:ReviewOrigin;id:string;leaseId:string;kind:'probe'|'bootstrap'|'daily';status:'running'|'partial'|'completed'|'failed';from:string;through:string;startedAt:string;heartbeatAt:string;stage:'active'|'archived'|'propose';cursor:string|null;pageComplete:boolean;pending:ChatHeader[];seen:Record<string,string>;seenActivity:Record<string,number>;chats:ChatEvidence[];changes:ProposalChange[];basisRevision:number|null;errors:string[];retryChats:ChatHeader[]};
export type ReviewState={revision:number;enabled:boolean;capability:{status:'unknown'|'verified'|'unavailable';checkedAt:string|null;detail:string;runtime:string|null};lastCompleteThrough:string|null;lastDailyDate:string|null;nextAttemptAt:string|null;run:ReviewRun|null;proposal:ReviewProposal|null};
export const defaultReviewState=():ReviewState=>({revision:0,enabled:false,capability:{status:'unknown',checkedAt:null,detail:'Check local chat access before enabling organisation assistance.',runtime:null},lastCompleteThrough:null,lastDailyDate:null,nextAttemptAt:null,run:null,proposal:null});
export const reviewTriggerSchema=z.strictObject({expectedStoreId:z.string().uuid(),kind:z.enum(['probe','bootstrap','daily']),reason:z.enum(['manual','timer']).default('manual')});
export const configureReviewSchema=z.strictObject({operationId:z.string().uuid(),expectedStoreId:z.string().uuid(),expectedReviewRevision:z.number().int().nonnegative(),enabled:z.boolean()});
export const acceptProposalSchema=z.strictObject({operationId:z.string().uuid(),expectedStoreId:z.string().uuid(),proposalId:z.string().uuid(),expectedProposalRevision:z.number().int().nonnegative(),expectedRevision:z.number().int().nonnegative(),changes:z.array(proposalChangeSchema).max(100)});
export const reviewDate=(now:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function dailyReviewDue(state:ReviewState,now:Date){
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',hourCycle:'h23'}).format(now));
  return state.enabled&&hour>=7&&state.lastDailyDate!==reviewDate(now);
}
export const proposalOutputJsonSchema=()=>z.toJSONSchema(proposalOutputSchema,{override:context=>{
  if(context.jsonSchema.oneOf){context.jsonSchema.anyOf=context.jsonSchema.oneOf;delete context.jsonSchema.oneOf;}
}});
