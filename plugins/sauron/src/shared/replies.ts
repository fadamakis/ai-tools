import { z } from 'zod';

const taskId=z.string().regex(/^slack:[a-f0-9]{64}$/);
export const replyTaskSchema=z.strictObject({taskId});
export const prepareReplySchema=z.strictObject({taskId,operationId:z.string().uuid()});
export const replyText=z.string().min(1).max(4000).refine(value=>!!value.trim(),'Write a reply first.');
export const saveReplySchema=z.strictObject({draftId:z.string().uuid(),expectedRevision:z.number().int().positive(),text:replyText});
export const sendReplySchema=saveReplySchema.extend({operationId:z.string().uuid()});
export const draftOutputSchema=z.strictObject({
  channelId:z.string().regex(/^[CDG][A-Z0-9]+$/),threadTs:z.string().regex(/^\d{10}\.\d{6}$/),
  destination:z.string().min(1).max(160),text:replyText,
});
export const sentOutputSchema=z.strictObject({
  status:z.enum(['sent','not_sent','unknown']),channelId:z.string(),threadTs:z.string(),
  text:z.string(),messageUrl:z.string().nullable(),detail:z.string().max(400),verified:z.boolean(),
});
export type ReplyDraft={
  id:string;taskId:string;sourceUrl:string;status:'preparing'|'ready'|'failed'|'sending'|'sent'|'uncertain';
  text:string;revision:number;channelId:string|null;threadTs:string|null;destination:string|null;
  startedAt:string;updatedAt:string;sendOperationId:string|null;messageUrl:string|null;error:string|null;
};
export type DraftOutput=z.infer<typeof draftOutputSchema>;
export type SentOutput=z.infer<typeof sentOutputSchema>;
export function slackSource(url:string){
  const source=new URL(url);const match=/^\/archives\/([CDG][A-Z0-9]+)\/p(\d{10})(\d{6})$/.exec(source.pathname);
  if(source.protocol!=='https:'||source.username||source.password||source.port||!(/^[a-z0-9-]+\.slack\.com$/).test(source.hostname)||!match)
    throw Error('This task needs a valid Slack discussion link.');
  return {channelId:match[1],messageTs:match[2]+'.'+match[3],host:source.hostname};
}
