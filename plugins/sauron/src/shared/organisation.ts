import {z} from 'zod';

const identity={operationId:z.string().uuid(),expectedStoreId:z.string().uuid(),expectedRevision:z.number().int().nonnegative()};
export const organiseTaskSchema=z.discriminatedUnion('action',[
  z.strictObject({...identity,action:z.literal('move'),id:z.string().min(1),parentId:z.string().min(1).nullable()}),
  z.strictObject({...identity,action:z.literal('topics'),id:z.string().min(1),topics:z.array(z.string().trim().min(1).max(60)).max(30)}),
  z.strictObject({...identity,action:z.literal('attention'),id:z.string().min(1),needsAttention:z.boolean()}),
]);
export type OrganiseTaskInput=z.infer<typeof organiseTaskSchema>;
export type Topic={id:string;name:string};
export type TaskOrganisation={parentId:string|null;directTopicIds:string[];attention:boolean;handledEvidence:string|null;evidence:string;reopenSuggested:boolean;sourceClosed:boolean;chatEvidence?:string|null;handledAt?:string|null;closedAt?:string|null};

export const organiseTaskToolSchema=z.strictObject({request:organiseTaskSchema});
